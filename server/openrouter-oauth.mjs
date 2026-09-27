// OpenRouter browser authorization (official PKCE flow, per https://openrouter.ai/docs/guides/overview/auth/oauth).
//
// OpenRouter's flow is a simplified PKCE exchange, not standard OAuth 2.0:
// - Authorization: GET https://openrouter.ai/auth?callback_url=<uri>&code_challenge=<s256>&code_challenge_method=S256
//   (no client_id, client_secret, scope, response_type, or documented state parameter)
// - Exchange: POST https://openrouter.ai/api/v1/auth/keys { code, code_verifier, code_challenge_method } -> { key }
// - Authorization codes are single-use and expire 10 minutes after issuance.
// - Localhost callbacks are supported on any port without app registration.
//
// Because OpenRouter does not echo a state parameter back, replay protection
// binds the transaction to the browser with a random HttpOnly cookie (sent
// only on this origin's callback) plus a server-side one-time transaction
// store. No OAuth secret exists to hardcode; nothing is stored client-side.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
export const OPENROUTER_EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';
export const TRANSACTION_COOKIE = 'or_oauth_tx';
/** Auth codes from OpenRouter expire after 10 minutes; the transaction expires sooner. */
export const TRANSACTION_TTL_MS = 5 * 60 * 1000;

export class OAuthFlowError extends Error {
  constructor(message, redirect = '/?view=providers&openrouter=error') {
    super(message);
    this.redirect = redirect;
  }
}

function base64url(buffer) {
  return buffer.toString('base64url');
}

/** Generates a fresh transaction; only `challenge` and the cookie value ever leave the server. */
export function createTransaction(now = Date.now()) {
  const verifier = base64url(randomBytes(48)); // 64 chars, within the 43–128 unreserved-char range
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const transaction = {
    id: randomUUID(),
    verifier,
    challenge,
    cookie: base64url(randomBytes(32)),
    expiresAt: now + TRANSACTION_TTL_MS,
  };
  return {
    transaction,
    authorizationUrl: `${OPENROUTER_AUTH_URL}?callback_url=${encodeURIComponent('__CALLBACK__')}&code_challenge=${challenge}&code_challenge_method=S256&key_label=${encodeURIComponent('Relay Office')}`,
    cookie: { name: TRANSACTION_COOKIE, value: transaction.cookie, httpOnly: true, maxAgeSeconds: TRANSACTION_TTL_MS / 1000 },
  };
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Validates and consumes a transaction. Unknown, expired, or replayed cookies all fail closed. */
export function consumeTransaction(store, cookieValue, now = Date.now()) {
  const message = 'OpenRouter authorization could not be verified. Start the connection again.';
  if (!cookieValue || typeof cookieValue !== 'string') throw new OAuthFlowError(message);
  const transaction = store.get(cookieValue);
  if (!transaction) throw new OAuthFlowError(message); // unknown or already used (one-time)
  store.delete(cookieValue);
  if (now > transaction.expiresAt) throw new OAuthFlowError(message);
  return transaction;
}

/** Exchanges the authorization code for a user-controlled API key. Never logs the code or key. */
export async function exchangeCode(code, verifier, fetchImpl = fetch) {
  if (typeof code !== 'string' || !code.trim() || code.length > 200) throw new OAuthFlowError('OpenRouter did not return an authorization code. Start the connection again.');
  let response;
  try {
    response = await fetchImpl(OPENROUTER_EXCHANGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code: code.trim(), code_verifier: verifier, code_challenge_method: 'S256' }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
  } catch {
    throw new OAuthFlowError('Could not reach OpenRouter to finish the connection. Try again.');
  }
  if (!response.ok) {
    // Deliberately sanitized: raw provider bodies are never surfaced or logged.
    throw new OAuthFlowError(response.status === 400 || response.status === 403
      ? 'OpenRouter rejected the authorization. Codes are single-use and expire after 10 minutes; start the connection again.'
      : `OpenRouter authorization exchange failed (HTTP ${response.status}). Try again.`);
  }
  let payload;
  try { payload = await response.json(); }
  catch { throw new OAuthFlowError('OpenRouter returned an invalid response during the exchange. Try again.'); }
  const key = payload?.key;
  if (typeof key !== 'string' || !key.trim() || key.length > 500) throw new OAuthFlowError('OpenRouter did not return a usable key. Try again.');
  return key.trim();
}
