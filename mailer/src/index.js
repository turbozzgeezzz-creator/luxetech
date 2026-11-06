import { trackOrder } from './shopify.js';
import { syncParcels, scansFor } from './parcels.js';
// LuxeMail entry point: HTTP routes and the 30-minute scheduler.
import { json, now, hmacHex, cleanEmail, esc, sendingReady, getKV } from './util.js';
import { layout, sendViaResend, unsubscribeUrl, sentTodayCount } from './email.js';
import {
  recordEvent, recordPixel, unsubscribe, welcomeCodeFor, subscriber, rateLimited, scanAbandonment, scanDaily,
  scanFortnightly, scanWeeklyJournal, drainOutbox, checkDeliveries, weeklyReport, builders, syncShopifySubscribers, syncShopifyCheckouts, syncShopifyOrders,
} from './flows.js';

function cors(env, request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = [env.STORE_URL, env.STORE_URL.replace('https://', 'https://www.'), `https://${env.SHOP_DOMAIN}`];
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : env.STORE_URL,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

const page = (title, message) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;background:#F7FBFF;font-family:Arial,sans-serif;color:#0B1F4D;display:grid;place-items:center;min-height:100vh}
.c{max-width:440px;margin:16px;padding:32px;border-radius:20px;background:#fff;text-align:center}h1{font-weight:800}
button,a.b{display:inline-block;margin-top:14px;padding:14px 26px;border:0;border-radius:999px;background:#0066FF;color:#fff;font-weight:700;font-size:15px;text-decoration:none;cursor:pointer}</style></head>
<body><div class="c">${message}</div></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

async function validUnsub(env, email, sig) {
  return email && sig && (await hmacHex(env.UNSUB_SECRET, email)) === sig;
}

/** Daily counters (no personal data) so /health shows the pixel and the theme are reporting. */
async function countHit(env, name) {
  const key = `count:${name}:${new Date().toISOString().slice(0, 10)}`;
  await env.DB.prepare(`INSERT INTO kv (k, v, expires_at) VALUES (?, '1', ?) ON CONFLICT(k) DO UPDATE SET v = CAST(v AS INTEGER) + 1`)
    .bind(key, now() + 8 * 86400).run();
}

/** Beacons are small JSON bodies sent as text/plain (so browsers don't need a CORS preflight). */
async function readBeacon(request) {
  if (Number(request.headers.get('Content-Length') || 0) > 16000) return null;
  const text = await request.text();
  if (text.length > 16000) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}

/** The first time sending goes live, email one test of every email to ADMIN_EMAIL (placeholder codes, nothing real). */
async function sendTestsOnce(env) {
  if (!(await sendingReady(env))) return;
  // Sent 5 per run (Cloudflare limits outbound requests per run); kv 'tests_next' remembers where it got to.
  if (await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('tests_sent').first()) return;
  if (await sentTodayCount(env) + 5 > Number(env.DAILY_SEND_LIMIT || 95)) return; // wait for room in the daily limit
  const next = Number((await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('tests_next').first())?.v || 0);
  const until = new Date(Date.now() + 7 * 86400000).toISOString();
  const items = [{ handle: 'smart-ring-health-tracker', qty: 1 }];
  const samples = [
    ['welcome1', { firstName: 'Sam' }], ['welcome2', { firstName: 'Sam' }], ['welcome3', { firstName: 'Sam' }],
    ['checkout1', { token: 'preview', items, firstName: 'Sam' }], ['checkout2', { token: 'preview', items, firstName: 'Sam' }],
    ['cart1', { handles: ['smart-ring-health-tracker'] }], ['cart2', { handles: ['smart-ring-health-tracker'] }],
    ['browse', { handle: 'smart-ring-health-tracker' }], ['wishlist', { handles: ['smart-ring-health-tracker'] }],
    ['postpurchase', { firstName: 'Sam', handles: ['smart-ring-health-tracker'] }], ['nextreminder', { firstName: 'Sam', code: 'NEXT10-PREVIEW', endsAt: until, since: 0 }],
    ['vip', { firstName: 'Sam' }], ['winback', { firstName: 'Sam' }],
    ['fortnight', { theme: 'new', firstName: 'Sam', offer: { code: 'NEWIN10-PREVIEW', endsAt: until } }], ['fortnight', { theme: 'deals', firstName: 'Sam' }], ['fortnight', { theme: 'picks', firstName: 'Sam' }], ['fortnight', { theme: 'best', firstName: 'Sam' }],
    ['journal', { firstName: 'Sam', since: new Date(Date.now() - 14 * 86400000).toISOString() }],
  ];
  const unsubUrl = await unsubscribeUrl(env, 'preview@example.com');
  const save = (k, v) => env.DB.prepare('INSERT OR REPLACE INTO kv (k, v, expires_at) VALUES (?, ?, NULL)').bind(k, String(v)).run();
  const end = Math.min(next + 5, samples.length);
  await save(end >= samples.length ? 'tests_sent' : 'tests_next', end >= samples.length ? now() : end);
  for (const [flow, sample] of samples.slice(next, end)) {
    try {
      const email = await builders[flow]({ ...env, PREVIEW: '1' }, 'preview@example.com', sample);
      if (!email) continue;
      await sendViaResend(env, { to: env.ADMIN_EMAIL, subject: `[Test] ${email.subject}`, html: layout(env, { ...email, unsubUrl }), unsubUrl });
      // Count tests against the daily limit like any other send, so they never push customer emails over it.
      await env.DB.prepare(`INSERT INTO sends (email, flow, dedupe, status, created_at, sent_at) VALUES (?, 'test', ?, 'sent', ?, ?)`)
        .bind(env.ADMIN_EMAIL, `test:${flow}:${sample.theme || ''}:${now()}`, now(), now()).run();
    } catch (e) { console.error('test send', flow, e); }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env, request) });

    // Theme beacon: browsing activity and newsletter sign-ups (with the consent box ticked).
    if (url.pathname === '/t' && request.method === 'POST') {
      const body = await readBeacon(request);
      // Crawlers (Google, shopping and ad scanners, SEO tools) run the page script too; their views would drown out real shoppers.
      const bot = /bot|crawl|spider|slurp|headless|lighthouse|preview|google|facebookexternalhit|ahrefs|semrush|pingdom|python|curl|wget/i.test(request.headers.get('User-Agent') || '');
      if (body && !bot) {
        ctx.waitUntil(countHit(env, 'theme_beacons').catch(() => {}));
        ctx.waitUntil(recordEvent(env, body, request.headers.get('CF-Connecting-IP'))
          .then((jobId) => (jobId ? drainOutbox(env, { id: jobId }) : null))
          .catch((e) => console.error('beacon', e)));
      }
      return new Response(null, { status: 204, headers: cors(env, request) });
    }

    // The subscriber's own welcome code, shown on the site right after they sign up.
    // Only for addresses on the list; same code every time; limited per IP.
    if (url.pathname === '/welcome-code' && request.method === 'POST') {
      const headers = { ...cors(env, request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
      const body = await readBeacon(request);
      const email = cleanEmail(body && body.e);
      if (!email) return new Response(JSON.stringify({ error: 'email' }), { status: 400, headers });
      const s = await subscriber(env, email);
      if (!s || s.status !== 'subscribed') return new Response(JSON.stringify({ error: 'not_subscribed' }), { status: 404, headers });
      if (await rateLimited(env, 'wc:' + (request.headers.get('CF-Connecting-IP') || ''), 10)) return new Response(JSON.stringify({ error: 'busy' }), { status: 429, headers });
      try {
        const { code, endsAt } = await welcomeCodeFor(env, email);
        return new Response(JSON.stringify({ code, endsAt }), { headers });
      } catch (e) {
        if (e.returning) return new Response(JSON.stringify({ error: 'returning' }), { status: 409, headers });
        console.error('welcome-code', e);
        return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers });
      }
    }

    // Track your order page: order number + email in, shipping progress out (only when both match).
    if (url.pathname === '/track' && request.method === 'POST') {
      const headers = { ...cors(env, request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
      const body = await readBeacon(request);
      // Lookups without an email are limited harder (they only ever show progress, never personal details).
      const ip = request.headers.get('CF-Connecting-IP') || '';
      if (await rateLimited(env, (body && body.e ? 'trk:' : 'trkn:') + ip, body && body.e ? 20 : 10)) return new Response(JSON.stringify({ error: 'busy' }), { status: 429, headers });
      try {
        const result = body ? await trackOrder(env, body.o, body.e) : null;
        if (result && env.TRACK17_KEY) {
          // Scans from the parcel sync. Without the email only the place-free progress is shared.
          const nums = (result.shipments || []).flatMap((x) => (x.tracking || []).map((t) => t.number).concat(x.numbers || [])).concat(result.trackingNumbers || []);
          const sc = await scansFor(env, [...new Set(nums.map((n) => n.replace(/\s+/g, '').toUpperCase()))]).catch(() => ({}));
          for (const sh of result.shipments || []) {
            const n = ((sh.tracking || [])[0] || {}).number || (sh.numbers || [])[0];
            const p = n && sc[n.replace(/\s+/g, '').toUpperCase()];
            if (p) { sh.parcel = p.status; sh.scans = result.limited ? [] : p.scans; }
          }
        }
        for (const sh of (result && result.shipments) || []) delete sh.numbers;
        if (!result) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers });
        return new Response(JSON.stringify(result), { headers });
      } catch (e) {
        console.error('track', e);
        return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers });
      }
    }

    // Shopify custom pixel (mailer/pixel.js): checkouts started and completed.
    if (url.pathname === '/p' && request.method === 'POST') {
      const body = await readBeacon(request);
      if (body) {
        ctx.waitUntil(recordPixel(env, body).catch((e) => console.error('pixel', e)));
        ctx.waitUntil(countHit(env, `pixel_${body.t === 'order' ? 'orders' : 'checkouts'}`).catch(() => {}));
      }
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    // Unsubscribe: GET shows a confirm button; POST (also used by Gmail/Apple one-click) unsubscribes.
    if (url.pathname === '/u') {
      const email = cleanEmail(url.searchParams.get('e'));
      const sig = url.searchParams.get('s');
      if (!(await validUnsub(env, email, sig))) return page('Link expired', '<h1>Hmm.</h1><p>This unsubscribe link isn\'t valid. Email ' + env.REPLY_TO + ' and we\'ll remove you straight away.</p>');
      if (request.method === 'POST') {
        await unsubscribe(env, email);
        return page('Unsubscribed', `<h1>You're unsubscribed</h1><p>${esc(email)} won't get marketing emails from ${esc(env.BRAND)} any more. Order and shipping emails still arrive as normal.</p><a class="b" href="${env.STORE_URL}">Back to the store</a>`);
      }
      return page('Unsubscribe', `<h1>Unsubscribe?</h1><p>Stop marketing emails to <strong>${esc(email)}</strong>.</p><form method="post"><button type="submit">Yes, unsubscribe me</button></form>`);
    }

    // Owner-only preview of any email with sample data: /preview?flow=welcome1&key=UNSUB_SECRET
    if (url.pathname === '/preview' && url.searchParams.get('key') === env.UNSUB_SECRET) {
      const flow = url.searchParams.get('flow') || 'welcome1';
      const items = [{ handle: url.searchParams.get('h') || 'smart-ring-health-tracker', qty: 1 }];
      const sample = {
        welcome3: { firstName: 'Sam' }, checkout2: { token: 'preview', items, firstName: 'Sam' }, cart2: { handles: items.map((i) => i.handle) },
        postpurchase: { firstName: 'Sam', handles: items.map((i) => i.handle) }, winback: { firstName: 'Sam' },
        nextreminder: { firstName: 'Sam', code: 'NEXT10-PREVIEW', endsAt: new Date(Date.now() + 7 * 86400000).toISOString(), since: 0 },
        checkout1: { token: 'preview', items, firstName: 'Sam' },
        welcome1: { firstName: 'Sam' }, welcome2: { firstName: 'Sam' }, vip: { firstName: 'Sam' },
        browse: { handle: url.searchParams.get('h') || 'smart-ring-health-tracker' },
        cart1: { handles: ['smart-ring-health-tracker'] }, wishlist: { handles: ['smart-ring-health-tracker'] },
        fortnight: { theme: url.searchParams.get('theme') || 'new', firstName: 'Sam' },
        journal: { firstName: 'Sam', since: new Date(Date.now() - 14 * 86400000).toISOString() },
      }[flow];
      if (!sample) return new Response('Preview supports: journal, welcome1, welcome2, welcome3, checkout1, checkout2, cart1, cart2, browse, wishlist, postpurchase, nextreminder, vip, winback, fortnight (theme=new|deals|picks|best|blog)', { status: 400 });
      if (flow === 'fortnight' && ['new', 'blog'].includes(sample.theme)) {
        sample.offer = { code: sample.theme === 'new' ? 'NEWIN10-PREVIEW' : 'INSIDER10-PREVIEW', endsAt: new Date(Date.now() + 7 * 86400000).toISOString() };
      }
      // Previews use placeholder codes and never create real discounts in Shopify.
      const email = await builders[flow]({ ...env, PREVIEW: '1' }, 'preview@example.com', sample);
      if (!email) return new Response(`Nothing to send for ${flow} with this sample (product unavailable?)`, { status: 422 });
      const unsubUrl = await unsubscribeUrl(env, 'preview@example.com');
      const html = layout(env, { ...email, unsubUrl });
      if (url.searchParams.get('send') === '1') {
        const to = cleanEmail(url.searchParams.get('to')) || env.ADMIN_EMAIL;
        // Tests share Resend's daily quota with customer emails: never send one past the daily limit.
        if (await sentTodayCount(env) >= Number(env.DAILY_SEND_LIMIT || 95)) return new Response('Daily send limit reached: try again tomorrow', { status: 429 });
        await sendViaResend(env, { to, subject: '[Test] ' + email.subject, html, unsubUrl });
        // Counts against the daily limit like any other send.
        await env.DB.prepare(`INSERT INTO sends (email, flow, dedupe, status, created_at, sent_at) VALUES (?, 'test', ?, 'sent', ?, ?)`)
          .bind(to, `test:${flow}:${url.searchParams.get('theme') || ''}:${to}:${Date.now()}`, now(), now()).run();
        return new Response(`Test sent to ${to}`);
      }
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (url.pathname === '/health') {
      const row = await env.DB.prepare(`SELECT
          (SELECT COUNT(*) FROM sends WHERE status = 'queued') AS queued,
          (SELECT COUNT(*) FROM sends WHERE status = 'sent' AND sent_at > ?) AS sent_24h,
          (SELECT COUNT(*) FROM sends WHERE status = 'error' AND sent_at > ?) AS errors_24h,
          (SELECT COUNT(*) FROM events WHERE at > ?) AS events_24h,
          (SELECT COUNT(*) FROM subscribers WHERE status = 'subscribed') AS subscribers,
          (SELECT COUNT(*) FROM suppressions WHERE reason IN ('bounced', 'marked as spam', 'invalid address')) AS blocked_addresses`).bind(now() - 86400, now() - 86400, now() - 86400).first();
      const today = new Date().toISOString().slice(0, 10);
      const { results: counts } = await env.DB.prepare(`SELECT k, v FROM kv WHERE k LIKE ?`).bind(`count:%:${today}`).all();
      const todayCounts = Object.fromEntries(counts.map((c) => [c.k.split(':')[1] + '_today_utc', Number(c.v)]));
      return json({ ok: true, sending: await sendingReady(env), switch_on: env.SENDING_ENABLED === '1', shopify_subscriber_sync: await getKV(env, 'customer_sync'), bounce_check: await getKV(env, 'bounce_check'), ...row, ...todayCounts });
    }

    return new Response('LuxeMail', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    const steps = [syncParcels, syncShopifySubscribers, syncShopifyOrders, syncShopifyCheckouts, scanAbandonment, scanDaily, scanFortnightly, scanWeeklyJournal, weeklyReport, drainOutbox, checkDeliveries, sendTestsOnce];
    for (const step of steps) {
      try { await step(env); } catch (e) { console.error(step.name, e); }
    }
  },
};
