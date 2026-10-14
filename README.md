# Telegram Deriv Account Bot

This project replaces the old dashboard demo with a Telegram-only bot for securely connecting a user's Deriv account. It does not include a web app or dashboard. Live trading and all trading commands are intentionally disabled until a strategy and risk limits are separately specified and reviewed.

## What it does

- Starts a Deriv OAuth 2.0 authorization-code flow with PKCE and a fresh, single-use `state` bound to the Telegram user.
- Uses the official Deriv OAuth endpoints:
  - Authorization: `https://auth.deriv.com/oauth2/auth`
  - Token exchange: `https://auth.deriv.com/oauth2/token`
- Handles the fixed callback `https://g-squad.buzz/oauth/callback`.
- Stores access and (when returned by Deriv) refresh tokens encrypted with AES-256-GCM in SQLite. The encryption key is supplied separately through the environment.
- Offers `/connect`, `/status`, `/disconnect`, and `/help` in Telegram.
- Runs a Telegram webhook and the OAuth callback on the same minimal HTTP backend, protected by a webhook secret, rate limits, and HTTPS enforcement.

The bot never asks for a Deriv password and never sends tokens or authorization codes through Telegram. The callback page contains only a generic result.

## Configure Deriv and Telegram

1. Register an OAuth application with Deriv. Register this redirect URI **exactly**:

   `https://g-squad.buzz/oauth/callback`

2. Use only the scopes configured for that application. Set `DERIV_OAUTH_SCOPES` to those exact scopes; the bot does not guess permissions.
3. Create a Telegram bot with BotFather and obtain its bot token.
4. Configure DNS for `g-squad.buzz` and terminate HTTPS with a trusted reverse proxy (for example, Caddy or Nginx). Proxy these paths to the bot:
   - `/oauth/callback`
   - `/telegram/webhook`
5. Keep the Node process bound to localhost behind that proxy. The proxy must overwrite `X-Forwarded-Proto` with `https` and `X-Forwarded-For` with the client IP; do not expose the backend port publicly.
6. Redact query strings from reverse-proxy access logs for `/oauth/callback`. The callback immediately redirects to a clean URL, but OAuth providers return the one-time authorization code in the callback query.

## Install and run

Use Node.js 22.13 or later (the project uses Node's built-in SQLite module).

```sh
npm install
cp .env.example .env
```

Set the following in `.env`:

- `TELEGRAM_BOT_TOKEN`: BotFather token.
- `TELEGRAM_WEBHOOK_SECRET`: random value using only letters, digits, `_` or `-` (for example, generate one with `openssl rand -hex 32`).
- `DERIV_CLIENT_ID`: client ID from the Deriv OAuth application.
- `DERIV_OAUTH_SCOPES`: exact, space-separated scopes registered for the app.
- `TOKEN_ENCRYPTION_KEY`: a fresh 32-byte key encoded as base64; generate it with `openssl rand -base64 32`.
- `PUBLIC_BASE_URL`: must remain `https://g-squad.buzz`.
- `TRUST_PROXY=true`: only when the process is reachable exclusively through the trusted HTTPS reverse proxy.

Start the bot:

```sh
npm start
```

At startup, the bot verifies that the public HTTPS callback and webhook routes actually reach this backend before registering `https://g-squad.buzz/telegram/webhook` with Telegram using `TELEGRAM_WEBHOOK_SECRET`. A default hosting placeholder or an incorrectly routed proxy will fail startup rather than silently acknowledge and drop Telegram updates. `PORT`, `BIND_HOST`, and `DATABASE_PATH` may be adjusted for deployment; keep the database directory private and backed up securely. Losing `TOKEN_ENCRYPTION_KEY` makes stored credentials unusable.

## Account disconnect and revocation

`/disconnect` deletes the bot's encrypted local credentials. The current Deriv OAuth documentation describes delegated tokens and account-level revocation but does not document a token-revocation endpoint or request parameters. To avoid inventing an endpoint, this bot does not claim to revoke the Deriv grant remotely; users should revoke the connected app in their Deriv account settings as well.

Refresh-token grant requests are made only if Deriv returns a refresh token. An invalid/expired refresh grant requires the user to connect again. An expired or rejected authorization code, a declined authorization, invalid state, and token-exchange failures do not link an account.

## Tests

```sh
npm test
```

OAuth references:

- [Deriv OAuth 2.0 guide](https://developers.deriv.com/docs/intro/oauth/)
- [Deriv authentication overview](https://developers.deriv.com/docs/intro/authentication/)
