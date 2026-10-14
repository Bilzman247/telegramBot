require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');
const { loadConfig } = require('./src/config');
const { createStore } = require('./src/store');
const { createOAuthService } = require('./src/oauth');
const {
  createHttpServer,
  createRateLimiter,
  verifyPublicRoutes,
} = require('./src/server');

const TRADING_DISABLED_MESSAGE =
  'Trading is disabled. This bot currently supports secure Deriv account connection only.';

function createBot({ token, oauth, store }) {
  if (!token) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN.');
  }

  const bot = new Telegraf(token, { handlerTimeout: 10000 });
  const allowOAuthStart = createRateLimiter({ limit: 5, windowMs: 60_000 });
  const connectButton = (url) =>
    Markup.inlineKeyboard([[Markup.button.url('Connect Deriv', url)]]);

  const sendHome = async (ctx) => {
    const linked = store.hasAccount(String(ctx.from.id));
    const text = linked
      ? 'Your Deriv account is connected. Account tokens stay on the server and are never sent in Telegram.\n\nAutomated trading is disabled.'
      : 'Connect your Deriv account securely. You will approve access on Deriv; this bot never asks for your Deriv password.\n\nAutomated trading is disabled.';
    const buttons = linked
      ? Markup.inlineKeyboard([
          [Markup.button.callback('Disconnect Deriv', 'disconnect')],
        ])
      : Markup.inlineKeyboard([
          [Markup.button.callback('Connect Deriv', 'connect')],
        ]);
    await ctx.reply(text, buttons);
  };

  bot.start(sendHome);
  bot.command('menu', sendHome);

  bot.command('connect', async (ctx) => {
    await beginConnection(ctx);
  });

  bot.action('connect', async (ctx) => {
    await ctx.answerCbQuery();
    await beginConnection(ctx);
  });

  async function beginConnection(ctx) {
    const telegramUserId = String(ctx.from.id);
    if (!allowOAuthStart(telegramUserId)) {
      await ctx.reply('Too many connection attempts. Please wait a minute before trying again.');
      return;
    }
    if (store.hasAccount(telegramUserId)) {
      await ctx.reply('A Deriv account is already connected. Use /disconnect before connecting again.');
      return;
    }

    try {
      const authorizationUrl = oauth.createAuthorizationUrl(telegramUserId);
      await ctx.reply(
        'Continue to Deriv to sign in and approve the requested permissions. Trading remains disabled.',
        connectButton(authorizationUrl)
      );
    } catch (error) {
      console.error('[bot] Could not start Deriv authorization.');
      await ctx.reply('Could not start the Deriv connection. Please try again later.');
    }
  }

  bot.command('disconnect', async (ctx) => {
    const removed = store.removeAccount(String(ctx.from.id));
    await ctx.reply(
      removed
        ? 'Your Deriv credentials have been removed from this bot. To revoke the grant with Deriv, use the connected-apps or security settings in your Deriv account.'
        : 'No Deriv account is connected.'
    );
  });

  bot.action('disconnect', async (ctx) => {
    await ctx.answerCbQuery();
    const removed = store.removeAccount(String(ctx.from.id));
    await ctx.reply(
      removed
        ? 'Your Deriv credentials have been removed from this bot. To revoke the grant with Deriv, use the connected-apps or security settings in your Deriv account.'
        : 'No Deriv account is connected.'
    );
  });

  bot.command('status', async (ctx) => {
    await ctx.reply(
      store.hasAccount(String(ctx.from.id))
        ? 'Deriv account: connected. Automated trading: disabled.'
        : 'Deriv account: not connected. Automated trading: disabled.'
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      'Commands:\n/connect — connect a Deriv account\n/status — check connection status\n/disconnect — remove stored credentials\n\nAll trading commands are disabled.'
    );
  });

  bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) {
      await ctx.reply(TRADING_DISABLED_MESSAGE);
    } else {
      await ctx.reply('Use /connect to link Deriv, or /help to see available commands.');
    }
  });

  bot.on('callback_query', async (ctx) => {
    await ctx.answerCbQuery('This action is not available.');
  });

  return bot;
}

async function start() {
  const config = loadConfig(process.env);
  const store = createStore(config.databasePath, config.encryptionKey);
  const oauth = createOAuthService({
    store,
    clientId: config.derivClientId,
    scopes: config.derivOAuthScopes,
    onAuthorized: async (telegramUserId) => {
      try {
        await bot.telegram.sendMessage(
          telegramUserId,
          'Your Deriv account is connected successfully. Trading remains disabled.'
        );
      } catch (error) {
        console.error('[oauth] Connection succeeded, but Telegram confirmation could not be delivered.');
      }
    },
    onAuthorizationError: async (telegramUserId, reason) => {
      const messages = {
        denied: 'Deriv authorization was declined. No account was connected.',
        expired_code: 'The Deriv authorization expired. Please start again with /connect.',
        exchange_failed: 'Deriv authorization could not be completed. Please try /connect again.',
      };
      try {
        await bot.telegram.sendMessage(telegramUserId, messages[reason]);
      } catch (error) {
        console.error('[oauth] Authorization outcome could not be delivered to Telegram.');
      }
    },
  });
  const bot = createBot({ token: config.telegramBotToken, oauth, store });
  const server = createHttpServer({ config, oauth, bot });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.bindHost, resolve);
  });

  try {
    await verifyPublicRoutes(config.publicBaseUrl);
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Open the Deriv connection menu' },
      { command: 'connect', description: 'Connect a Deriv account' },
      { command: 'status', description: 'Check Deriv connection status' },
      { command: 'disconnect', description: 'Remove stored Deriv credentials' },
      { command: 'help', description: 'Show available commands' },
    ]);
    await bot.telegram.setWebhook(`${config.publicBaseUrl}/telegram/webhook`, {
      secret_token: config.telegramWebhookSecret,
      allowed_updates: ['message', 'callback_query'],
    });
  } catch (error) {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    if (error.message.startsWith('Public HTTPS routes are not connected')) {
      throw error;
    }
    throw new Error('Could not configure the Telegram webhook.');
  }

  console.log(`Telegram bot and OAuth callback server listening on ${config.bindHost}:${config.port}.`);

  const stop = async (signal) => {
    console.log(`Received ${signal}; shutting down.`);
    await bot.telegram.deleteWebhook().catch(() => {
      console.error('[shutdown] Could not remove the Telegram webhook.');
    });
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    store.close();
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
}

if (require.main === module) {
  start().catch((error) => {
    console.error(`[startup] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createBot, start, TRADING_DISABLED_MESSAGE };
