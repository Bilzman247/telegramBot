const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');

const MAX_REQUEST_BYTES = 1024 * 1024;

function constantTimeStringEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual || '');
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer);
}

function createRateLimiter({ limit, windowMs }) {
  const entries = new Map();

  return (key, now = Date.now()) => {
    const entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
      if (entries.size >= 10000) {
        for (const [entryKey, item] of entries) {
          if (item.resetAt <= now) entries.delete(entryKey);
        }
        if (entries.size >= 10000) return false;
      }
      entries.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (entry.count >= limit) return false;
    entry.count += 1;
    return true;
  };
}

function setSecurityHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

function respond(response, status, message) {
  setSecurityHeaders(response);
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(message);
}

function redirectToCompletion(response) {
  setSecurityHeaders(response);
  response.writeHead(303, { location: '/oauth/complete' });
  response.end();
}

async function verifyPublicRoutes(publicBaseUrl, fetchImpl = fetch) {
  let callbackResponse;
  let webhookResponse;
  try {
    callbackResponse = await fetchImpl(`${publicBaseUrl}/oauth/callback`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (
      callbackResponse.status !== 303 ||
      callbackResponse.headers.get('location') !== '/oauth/complete' ||
      callbackResponse.headers.get('cache-control') !== 'no-store'
    ) {
      throw new Error('OAuth callback route is not reaching this backend.');
    }

    webhookResponse = await fetchImpl(`${publicBaseUrl}/telegram/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (webhookResponse.status !== 403) {
      throw new Error('Telegram webhook route is not reaching this backend.');
    }
  } catch (error) {
    throw new Error('Public HTTPS routes are not connected to this backend. Configure the reverse proxy before starting the bot.');
  }
}

function createHttpServer({ config, oauth, bot }) {
  const callbackLimit = createRateLimiter({ limit: 30, windowMs: 60_000 });
  const webhookLimit = createRateLimiter({ limit: 120, windowMs: 60_000 });

  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, config.publicBaseUrl);
    const forwardedAddress = request.headers['x-forwarded-for'];
    const clientAddress = config.trustProxy && typeof forwardedAddress === 'string'
      ? forwardedAddress.split(',')[0].trim()
      : request.socket.remoteAddress || 'unknown';

    const isHttps = request.socket.encrypted ||
      (config.trustProxy && request.headers['x-forwarded-proto'] === 'https');
    if (!isHttps) {
      respond(response, 426, 'HTTPS is required.');
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/oauth/callback') {
      if (!callbackLimit(clientAddress)) {
        respond(response, 429, 'Too many requests. Try again later.');
        return;
      }

      try {
        await oauth.completeAuthorization({
          state: requestUrl.searchParams.get('state'),
          code: requestUrl.searchParams.get('code'),
          providerError: requestUrl.searchParams.get('error'),
        });
      } catch (error) {
        const code = ['denied', 'invalid_state', 'expired_state', 'expired_code', 'exchange_failed']
          .includes(error.code)
          ? error.code
          : 'exchange_failed';
        console.warn(`[oauth] Callback completed with ${code}.`);
      }
      redirectToCompletion(response);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/oauth/complete') {
      respond(response, 200, 'Check Telegram for the Deriv connection status. You may close this page.');
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/telegram/webhook') {
      if (!webhookLimit(clientAddress)) {
        respond(response, 429, 'Too many requests.');
        return;
      }
      if (!constantTimeStringEqual(
        request.headers['x-telegram-bot-api-secret-token'],
        config.telegramWebhookSecret
      )) {
        respond(response, 403, 'Forbidden.');
        return;
      }

      const chunks = [];
      let size = 0;
      request.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_REQUEST_BYTES) {
          if (!response.writableEnded) respond(response, 413, 'Request too large.');
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', async () => {
        if (response.writableEnded) return;
        try {
          const update = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          await bot.handleUpdate(update);
          respond(response, 200, 'OK');
        } catch (error) {
          console.error('[webhook] Telegram update could not be processed.');
          respond(response, 400, 'Invalid update.');
        }
      });
      request.on('error', () => {
        if (!response.writableEnded) respond(response, 400, 'Invalid request.');
      });
      return;
    }

    respond(response, 404, 'Not found.');
  });
}

module.exports = { createHttpServer, createRateLimiter, verifyPublicRoutes };
