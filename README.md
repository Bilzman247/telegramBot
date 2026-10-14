require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Missing TELEGRAM_BOT_TOKEN in your environment.\nCreate a .env file and add: TELEGRAM_BOT_TOKEN=your_token_here');
  process.exit(1);
}

const bot = new Telegraf(token, {
  handlerTimeout: 10000,
});

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const getDisplayName = (user = {}) => {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return fullName || user.username || 'User';
};

const balanceValue = () => {
  const base = 1250 + Math.random() * 800;
  return (base + Math.random() * 100).toFixed(2);
};

const statValue = () => {
  const base = 32 + Math.random() * 50;
  return Math.round(base).toString();
};

const mainMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('👤 Profile', 'profile'), Markup.button.callback('💳 Balance', 'balance')],
    [Markup.button.callback('📊 Stats', 'stats'), Markup.button.callback('❓ Help', 'help')],
  ]);

const homeCard = (user) => {
  const name = escapeHtml(getDisplayName(user));
  return `
✨ <b>Welcome back, ${name}</b>

Your digital dashboard is ready. Select an action below to continue.
  `.trim();
};

const profileCard = (user) => {
  const name = escapeHtml(getDisplayName(user));
  const username = user.username ? `@${escapeHtml(user.username)}` : 'Not set';
  const id = user.id || 'Unknown';

  return `
👤 <b>Profile</b>

<b>Name:</b> ${name}
<b>Username:</b> ${username}
<b>User ID:</b> <code>${id}</code>
<b>Status:</b> Premium Access
<b>Member:</b> ${new Date().toLocaleDateString()}
  `.trim();
};

const balanceCard = () => {
  const amount = balanceValue();
  const pending = (Math.random() * 80 + 25).toFixed(2);

  return `
💳 <b>Wallet</b>

<b>Available:</b> <code>$${amount}</code>
<b>Pending:</b> <code>$${pending}</code>
<b>Currency:</b> USD

<i>Demo balance for UI preview only.</i>
  `.trim();
};

const statsCard = () => {
  const streak = statValue();
  const rewards = statValue();
  const tasks = statValue();

  return `
📊 <b>Performance</b>

<b>Daily streak:</b> ${streak} days
<b>Rewards:</b> ${rewards} pts
<b>Tasks done:</b> ${tasks}
<b>Rank:</b> Gold Tier
  `.trim();
};

const helpCard = () => `
❓ <b>Help</b>

Use the buttons below to explore your profile, wallet, and stats.
All data is a demo for styling and callback interaction.
`.trim();

const profileButtons = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Refresh', 'refresh_profile'), Markup.button.callback('⬅️ Back', 'home')],
  ]);

const balanceButtons = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Refresh', 'refresh_balance'), Markup.button.callback('⬅️ Back', 'home')],
    [Markup.button.callback('💸 Withdraw', 'withdraw')],
  ]);

const statsButtons = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Back', 'home')],
  ]);

const helpButtons = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Back', 'home')],
  ]);

const homeButtons = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('👤 Profile', 'profile'), Markup.button.callback('💳 Balance', 'balance')],
    [Markup.button.callback('📊 Stats', 'stats'), Markup.button.callback('❓ Help', 'help')],
  ]);

bot.telegram.setMyCommands([
  { command: 'start', description: 'Open dashboard' },
  { command: 'menu', description: 'Show main menu' },
]);

bot.command('start', async (ctx) => {
  await ctx.replyWithHTML(homeCard(ctx.from), homeButtons());
});

bot.command('menu', async (ctx) => {
  await ctx.replyWithHTML(homeCard(ctx.from), homeButtons());
});

bot.action('home', async (ctx) => {
  try {
    await ctx.answerCbQuery('Dashboard opened');
    await ctx.editMessageText(homeCard(ctx.from), {
      parse_mode: 'HTML',
      reply_markup: homeButtons(),
    });
  } catch (err) {
    console.error('home action error:', err);
  }
});

bot.action('profile', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.editMessageText(profileCard(ctx.from), {
      parse_mode: 'HTML',
      reply_markup: profileButtons(),
    });
  } catch (err) {
    console.error('profile action error:', err);
  }
});

bot.action('refresh_profile', async (ctx) => {
  try {
    await ctx.answerCbQuery('Profile refreshed');
    await ctx.editMessageText(profileCard(ctx.from), {
      parse_mode: 'HTML',
      reply_markup: profileButtons(),
    });
  } catch (err) {
    console.error('refresh_profile action error:', err);
  }
});

bot.action('balance', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.editMessageText(balanceCard(), {
      parse_mode: 'HTML',
      reply_markup: balanceButtons(),
    });
  } catch (err) {
    console.error('balance action error:', err);
  }
});

bot.action('refresh_balance', async (ctx) => {
  try {
    await ctx.answerCbQuery('Balance updated');
    await ctx.editMessageText(balanceCard(), {
      parse_mode: 'HTML',
      reply_markup: balanceButtons(),
    });
  } catch (err) {
    console.error('refresh_balance action error:', err);
  }
});

bot.action('stats', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.editMessageText(statsCard(), {
      parse_mode: 'HTML',
      reply_markup: statsButtons(),
    });
  } catch (err) {
    console.error('stats action error:', err);
  }
});

bot.action('help', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.editMessageText(helpCard(), {
      parse_mode: 'HTML',
      reply_markup: helpButtons(),
    });
  } catch (err) {
    console.error('help action error:', err);
  }
});

bot.action('withdraw', async (ctx) => {
  try {
    await ctx.answerCbQuery('Demo action only');
    await ctx.editMessageText(
      '💸 <b>Withdraw</b>\n\nThis is a design demo only. No real funds are transferred.',
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back', 'home')],
        ]),
      }
    );
  } catch (err) {
    console.error('withdraw action error:', err);
  }
});

bot.on('callback_query', async (ctx) => {
  try {
    await ctx.answerCbQuery('Processing...');
  } catch (err) {
    console.error('callback fallback error:', err);
  }
});

bot.on('message', async (ctx) => {
  if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
    return;
  }

  await ctx.replyWithHTML(homeCard(ctx.from), homeButtons());
});

bot.launch().then(() => {
  console.log('Telegram bot is running successfully.');
}).catch((err) => {
  console.error('Bot failed to start:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
