# Telegram Inline Buttons Demo Bot (Node.js)

This repository contains a small demo Telegram bot built with Node.js and Telegraf that showcases advanced inline buttons and callback editing. It displays a simple fake profile and balance, and edits the same message in-place when buttons are pressed.

Important: Do NOT commit your real bot token to the repository. Use environment variables.

Setup

1. Clone the repo:
   git clone https://github.com/Bilzman247/telegramBot.git
   cd telegramBot

2. Install dependencies:
   npm install

3. Create a .env file in the project root (you can copy the example):

   cp .env.example .env
   # then open .env and set TELEGRAM_BOT_TOKEN

   TELEGRAM_BOT_TOKEN=put_your_token_here

4. Start the bot:
   npm start

Usage

- Send /start to the bot or any message to see the main menu.
- Use inline buttons to view Profile, Balance, or Help.
- The bot edits messages in-place using callback queries, so the chat remains tidy.

Notes

- This bot is a demo: balances and profile data are fake and for illustration only.
- For production, secure your token (use secrets management) and consider deploying to a server with process managers (PM2, systemd) or container platforms.

Development

- Code lives in index.js. Add commands and handlers as needed.

License

MIT
