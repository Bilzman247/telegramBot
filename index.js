const { Telegraf, Markup } = require('telegraf');

const token = '8819641089:AAHbttHKDYAXakHng_XubDowKZJHo6jTAHE';
if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN') {
  console.error('Error: Telegram bot token is missing. Please add your token in index.js.');
  process.exit(1);
}

const bot = new Telegraf(token);

const mainMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('👤 Profile', 'profile'), Markup.button.callback('💳 Balance', 'balance')],
  [Markup.button.callback('❓ Help', 'help')],
]);

function fakeBalance() {
  // deterministic-ish fake balance for demo (based on user id when available)
  return (Math.abs((Date.now() % 100000) / 100) + (Math.random() * 50)).toFixed(2);
}

bot.start((ctx) => {
  const name = ctx.from && (ctx.from.username ? `@${ctx.from.username}` : `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim()) || 'there';
  ctx.reply(`Welcome, ${name}!\nChoose an option:`, mainMenu());
});

bot.action('profile', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const user = ctx.from || {};
    const profileText = `👤 Profile\n\nName: ${user.first_name || 'John'} ${user.last_name || ''}\nUsername: ${user.username ? '@' + user.username : 'N/A'}\nID: ${user.id || 'N/A'}\nStatus: Premium Demo User\nRole: Telegram Bot User`;
    await ctx.editMessageText(profileText, Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh', 'refresh_profile'), Markup.button.callback('⬅️ Back', 'back')]
    ]));
  } catch (err) {
    console.error('profile action error', err);
  }
});

bot.action('refresh_profile', async (ctx) => {
  try {
    await ctx.answerCbQuery('Profile refreshed');
    // simple refresh behavior: re-run profile handler
    const user = ctx.from || {};
    const profileText = `👤 Profile\n\nName: ${user.first_name || 'John'} ${user.last_name || ''}\nUsername: ${user.username ? '@' + user.username : 'N/A'}\nID: ${user.id || 'N/A'}\nStatus: Premium Demo User\nRole: Telegram Bot User`;
    await ctx.editMessageText(profileText, Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh', 'refresh_profile'), Markup.button.callback('⬅️ Back', 'back')]
    ]));
  } catch (err) {
    console.error('refresh_profile error', err);
  }
});

bot.action('balance', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const balance = fakeBalance();
    const balanceText = `💳 Balance\n\nAvailable: $${balance}\n\nThis is a demo balance (not real).`;
    await ctx.editMessageText(balanceText, Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh', 'refresh_balance'), Markup.button.callback('⬅️ Back', 'back')],
      [Markup.button.callback('💸 Withdraw (demo)', 'withdraw')]
    ]));
  } catch (err) {
    console.error('balance action error', err);
  }
});

bot.action('refresh_balance', async (ctx) => {
  try {
    await ctx.answerCbQuery('Balance updated');
    const balance = fakeBalance();
    const balanceText = `💳 Balance\n\nAvailable: $${balance}\n\nLast refreshed: ${new Date().toLocaleString()}`;
    await ctx.editMessageText(balanceText, Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh', 'refresh_balance'), Markup.button.callback('⬅️ Back', 'back')],
      [Markup.button.callback('💸 Withdraw (demo)', 'withdraw')]
    ]));
  } catch (err) {
    console.error('refresh_balance error', err);
  }
});

bot.action('withdraw', async (ctx) => {
  try {
    await ctx.answerCbQuery('Withdraw is a demo action');
    await ctx.editMessageText('💸 Withdraw\n\nThis is only a demo — no real funds are moved.\n\nChoose another action:', Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Back', 'back')]
    ]));
  } catch (err) {
    console.error('withdraw action error', err);
  }
});

bot.action('help', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const helpText = `❓ Help\n\nUse the inline buttons to view your profile or balance. This bot demonstrates advanced inline button handling and editing messages in place via callbacks.`;
    await ctx.editMessageText(helpText, Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Back', 'back')]
    ]));
  } catch (err) {
    console.error('help action error', err);
  }
});

bot.action('back', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.editMessageText('Choose an option:', mainMenu());
  } catch (err) {
    console.error('back action error', err);
  }
});

// fallback for unknown callback queries
bot.on('callback_query', async (ctx) => {
  try {
    // if a callback wasn't handled above, acknowledge it
    await ctx.answerCbQuery('Action received');
  } catch (err) {
    console.error('generic callback_query handler', err);
  }
});

// simple text handler to show main menu
bot.on('message', (ctx) => {
  ctx.reply('Use the menu:', mainMenu());
});

bot.launch().then(() => console.log('Bot started')).catch((err) => {
  console.error('Failed to launch bot', err);
});

// graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
