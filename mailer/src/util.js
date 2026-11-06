// Small helpers shared across LuxeMail.

export const now = () => Math.floor(Date.now() / 1000);
export const HOUR = 3600;
export const DAY = 86400;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode(len) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function hmacHex(secret, data) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const money = (cents) => (cents == null ? '' : '$' + (cents / 100).toFixed(2));

// Shopify hides real addresses (shows name@example.com) until the app has protected customer data access: never use those.
export const cleanEmail = (e) => (typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim()) && !/@example\.com$/i.test(e.trim()) ? e.trim().toLowerCase() : null);

/** Local (Sydney) time parts using a fixed offset; good enough for scheduling sends. */
export function localParts(env, date = new Date()) {
  const offset = Number(env.TIMEZONE_OFFSET_HOURS || 10);
  const d = new Date(date.getTime() + offset * 3600000);
  return { day: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), ymd: d.toISOString().slice(0, 10) };
}

export async function getKV(env, k) {
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first();
  return row ? row.v : null;
}

export async function setKV(env, k, v) {
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v, expires_at) VALUES (?, ?, NULL)').bind(k, String(v)).run();
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

/**
 * Sending is live only when SENDING_ENABLED = "1" AND Resend reports the sending domain as verified.
 * The domain status is checked at most every 20 minutes and cached, so mail starts by itself once DNS is in.
 */
export async function sendingReady(env) {
  if (env.SENDING_ENABLED !== '1') return false;
  if (!env.RESEND_DOMAIN_ID) return true;
  const row = await env.DB.prepare('SELECT v, expires_at FROM kv WHERE k = ?').bind('resend_domain_status').first();
  if (row && row.expires_at > now()) return row.v === 'verified';
  let status = 'unknown';
  try {
    const r = await fetch(`https://api.resend.com/domains/${env.RESEND_DOMAIN_ID}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
    if (r.ok) status = (await r.json()).status || 'unknown';
  } catch (_) {}
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v, expires_at) VALUES (?, ?, ?)').bind('resend_domain_status', status, now() + (status === 'verified' ? 6 * 3600 : 1200)).run();
  return status === 'verified';
}
