// LuxeMail entry point: HTTP routes and the 30-minute scheduler.
import { json, now, hmacHex, cleanEmail, esc } from './util.js';
import { verifyWebhook, unsubscribeInShopify } from './shopify.js';
import { layout, sendViaResend, unsubscribeUrl } from './email.js';
import {
  recordEvent, onCustomerWebhook, onCheckoutWebhook, onOrderWebhook, scanAbandonment, scanDaily,
  scanFortnightly, drainOutbox, weeklyReport, builders,
} from './flows.js';

function cors(env, request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = [env.STORE_URL, `https://${env.SHOP_DOMAIN}`];
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : env.STORE_URL,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

const page = (title, message) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;background:#F2F3F5;font-family:Arial,sans-serif;color:#0B1220;display:grid;place-items:center;min-height:100vh}
.c{max-width:440px;margin:16px;padding:32px;border-radius:20px;background:#fff;text-align:center}h1{font-style:italic}
button,a.b{display:inline-block;margin-top:14px;padding:14px 26px;border:0;border-radius:999px;background:#7D03FC;color:#fff;font-weight:800;font-size:15px;text-decoration:none;cursor:pointer}</style></head>
<body><div class="c">${message}</div></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

async function validUnsub(env, email, sig) {
  return email && sig && (await hmacHex(env.UNSUB_SECRET, email)) === sig;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env, request) });

    // Theme tracking beacon.
    if (url.pathname === '/t' && request.method === 'POST') {
      try {
        const body = await request.json();
        ctx.waitUntil(recordEvent(env, body));
      } catch (_) { /* ignore malformed beacons */ }
      return new Response(null, { status: 204, headers: cors(env, request) });
    }

    // Shopify webhooks.
    if (url.pathname === '/webhooks' && request.method === 'POST') {
      const raw = await request.arrayBuffer();
      if (!(await verifyWebhook(env, raw, request.headers.get('X-Shopify-Hmac-Sha256')))) return new Response('bad signature', { status: 401 });
      const topic = request.headers.get('X-Shopify-Topic') || '';
      const payload = JSON.parse(new TextDecoder().decode(raw));
      const work = topic.startsWith('customers/') ? onCustomerWebhook(env, payload)
        : topic.startsWith('checkouts/') ? onCheckoutWebhook(env, payload)
        : topic === 'orders/create' ? onOrderWebhook(env, payload)
        : Promise.resolve();
      ctx.waitUntil(work.catch((e) => console.error('webhook', topic, e)));
      return new Response('ok');
    }

    // Unsubscribe: GET shows a confirm button; POST (also used by Gmail/Apple one-click) unsubscribes.
    if (url.pathname === '/u') {
      const email = cleanEmail(url.searchParams.get('e'));
      const sig = url.searchParams.get('s');
      if (!(await validUnsub(env, email, sig))) return page('Link expired', '<h1>Hmm.</h1><p>This unsubscribe link isn\'t valid. Email support@luxedealers.com and we\'ll remove you straight away.</p>');
      if (request.method === 'POST') {
        await env.DB.prepare('INSERT OR REPLACE INTO suppressions (email, reason, at) VALUES (?, ?, ?)').bind(email, 'unsubscribed', now()).run();
        await env.DB.prepare(`UPDATE sends SET status = 'skipped', error = 'unsubscribed' WHERE email = ? AND status = 'queued'`).bind(email).run();
        ctx.waitUntil(unsubscribeInShopify(env, email).catch((e) => console.error('unsub', e)));
        return page('Unsubscribed', `<h1>You're unsubscribed</h1><p>${esc(email)} won't get marketing emails from ${esc(env.BRAND)} any more. Order and shipping emails still arrive as normal.</p><a class="b" href="${env.STORE_URL}">Back to the store</a>`);
      }
      return page('Unsubscribe', `<h1>Unsubscribe?</h1><p>Stop marketing emails to <strong>${esc(email)}</strong>.</p><form method="post"><button type="submit">Yes, unsubscribe me</button></form>`);
    }

    // Owner-only preview of any email with sample data: /preview?flow=welcome1&key=UNSUB_SECRET
    if (url.pathname === '/preview' && url.searchParams.get('key') === env.UNSUB_SECRET) {
      const flow = url.searchParams.get('flow') || 'welcome1';
      const sample = {
        welcome1: { firstName: 'Sam' }, welcome2: { firstName: 'Sam' }, vip: { firstName: 'Sam' },
        browse: { handle: url.searchParams.get('h') || 'high-tech-supersonic-hair-dryer' },
        cart1: { handles: ['high-tech-supersonic-hair-dryer'] }, wishlist: { handles: ['high-tech-supersonic-hair-dryer'] },
        fortnight: { theme: url.searchParams.get('theme') || 'new', firstName: 'Sam' },
      }[flow];
      if (!sample) return new Response('Preview supports: welcome1, welcome2, vip, browse, cart1, wishlist, fortnight', { status: 400 });
      const email = await builders[flow](env, 'preview@example.com', sample);
      const unsubUrl = await unsubscribeUrl(env, 'preview@example.com');
      const html = layout(env, { ...email, unsubUrl });
      if (url.searchParams.get('send') === '1') {
        await sendViaResend(env, { to: env.ADMIN_EMAIL, subject: '[Test] ' + email.subject, html, unsubUrl });
        return new Response(`Test sent to ${env.ADMIN_EMAIL}`);
      }
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (url.pathname === '/health') {
      const row = await env.DB.prepare(`SELECT
          (SELECT COUNT(*) FROM sends WHERE status = 'queued') AS queued,
          (SELECT COUNT(*) FROM sends WHERE status = 'sent' AND sent_at > ?) AS sent_24h,
          (SELECT COUNT(*) FROM sends WHERE status = 'error' AND sent_at > ?) AS errors_24h,
          (SELECT COUNT(*) FROM events WHERE at > ?) AS events_24h`).bind(now() - 86400, now() - 86400, now() - 86400).first();
      return json({ ok: true, ...row });
    }

    return new Response('LuxeMail', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    const steps = [scanAbandonment, scanDaily, scanFortnightly, weeklyReport, drainOutbox];
    for (const step of steps) {
      try { await step(env); } catch (e) { console.error(step.name, e); }
    }
  },
};
