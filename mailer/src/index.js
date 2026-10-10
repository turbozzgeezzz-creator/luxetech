// LuxeMail entry point: HTTP routes and the 30-minute scheduler.
import { json, now, hmacHex, cleanEmail, esc } from './util.js';
import { unsubscribeInShopify } from './shopify.js';
import { layout, sendViaResend, unsubscribeUrl } from './email.js';
import {
  recordEvent, recordPixel, confirmSubscription, unsubscribe, scanAbandonment, scanDaily,
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

async function validConfirm(env, email, sig) {
  return email && sig && (await hmacHex(env.UNSUB_SECRET, 'confirm:' + email)) === sig;
}

/** Beacons are small JSON bodies sent as text/plain (so browsers don't need a CORS preflight). */
async function readBeacon(request) {
  if (Number(request.headers.get('Content-Length') || 0) > 16000) return null;
  const text = await request.text();
  if (text.length > 16000) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env, request) });

    // Theme beacon: browsing activity and newsletter sign-ups (with the consent box ticked).
    if (url.pathname === '/t' && request.method === 'POST') {
      const body = await readBeacon(request);
      if (body) {
        ctx.waitUntil(recordEvent(env, body, request.headers.get('CF-Connecting-IP'))
          .then((jobId) => (jobId ? drainOutbox(env, { id: jobId }) : null))
          .catch((e) => console.error('beacon', e)));
      }
      return new Response(null, { status: 204, headers: cors(env, request) });
    }

    // Shopify custom pixel (mailer/pixel.js): checkouts started and completed.
    if (url.pathname === '/p' && request.method === 'POST') {
      const body = await readBeacon(request);
      if (body) ctx.waitUntil(recordPixel(env, body).catch((e) => console.error('pixel', e)));
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    // Confirm a subscription. GET shows a button and POST confirms, so email link scanners can't confirm for people.
    if (url.pathname === '/c') {
      const email = cleanEmail(url.searchParams.get('e'));
      if (!(await validConfirm(env, email, url.searchParams.get('s')))) return page('Link expired', '<h1>Hmm.</h1><p>This confirmation link isn\'t valid. Please sign up again on the store.</p>');
      if (request.method === 'POST') {
        const ok = await confirmSubscription(env, email);
        if (!ok) return page('Sign up again', `<h1>Hmm.</h1><p>We couldn't find that sign-up. Please sign up again on the store.</p><a class="b" href="${env.STORE_URL}">Back to the store</a>`);
        ctx.waitUntil(drainOutbox(env).catch((e) => console.error('drain', e)));
        return page('Subscribed', `<h1>You're in!</h1><p>Thanks for confirming. Your welcome email with your 10% code is on its way to ${esc(email)}.</p><a class="b" href="${env.STORE_URL}">Back to the store</a>`);
      }
      return page('Confirm', `<h1>Confirm your email</h1><p>Get deals and new arrivals from ${esc(env.BRAND)} at <strong>${esc(email)}</strong>. Unsubscribe any time.</p><form method="post"><button type="submit">Yes, subscribe me</button></form>`);
    }

    // Unsubscribe: GET shows a confirm button; POST (also used by Gmail/Apple one-click) unsubscribes.
    if (url.pathname === '/u') {
      const email = cleanEmail(url.searchParams.get('e'));
      const sig = url.searchParams.get('s');
      if (!(await validUnsub(env, email, sig))) return page('Link expired', '<h1>Hmm.</h1><p>This unsubscribe link isn\'t valid. Email support@luxedealers.com and we\'ll remove you straight away.</p>');
      if (request.method === 'POST') {
        await unsubscribe(env, email);
        // Also try to unsubscribe them in Shopify; this may not work without protected customer data access.
        ctx.waitUntil(unsubscribeInShopify(env, email).catch((e) => console.error('unsub', e)));
        return page('Unsubscribed', `<h1>You're unsubscribed</h1><p>${esc(email)} won't get marketing emails from ${esc(env.BRAND)} any more. Order and shipping emails still arrive as normal.</p><a class="b" href="${env.STORE_URL}">Back to the store</a>`);
      }
      return page('Unsubscribe', `<h1>Unsubscribe?</h1><p>Stop marketing emails to <strong>${esc(email)}</strong>.</p><form method="post"><button type="submit">Yes, unsubscribe me</button></form>`);
    }

    // Owner-only preview of any email with sample data: /preview?flow=welcome1&key=UNSUB_SECRET
    if (url.pathname === '/preview' && url.searchParams.get('key') === env.UNSUB_SECRET) {
      const flow = url.searchParams.get('flow') || 'welcome1';
      const items = [{ handle: url.searchParams.get('h') || 'high-tech-supersonic-hair-dryer', qty: 1 }];
      const sample = {
        confirm: { firstName: 'Sam' }, checkout1: { token: 'preview', items, firstName: 'Sam' },
        welcome1: { firstName: 'Sam' }, welcome2: { firstName: 'Sam' }, vip: { firstName: 'Sam' },
        browse: { handle: url.searchParams.get('h') || 'high-tech-supersonic-hair-dryer' },
        cart1: { handles: ['high-tech-supersonic-hair-dryer'] }, wishlist: { handles: ['high-tech-supersonic-hair-dryer'] },
        fortnight: { theme: url.searchParams.get('theme') || 'new', firstName: 'Sam' },
      }[flow];
      if (!sample) return new Response('Preview supports: confirm, welcome1, welcome2, checkout1, vip, browse, cart1, wishlist, fortnight', { status: 400 });
      const email = await builders[flow](env, 'preview@example.com', sample);
      if (!email) return new Response(`Nothing to send for ${flow} with this sample (product unavailable?)`, { status: 422 });
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
          (SELECT COUNT(*) FROM events WHERE at > ?) AS events_24h,
          (SELECT COUNT(*) FROM subscribers WHERE status = 'subscribed') AS subscribers,
          (SELECT COUNT(*) FROM subscribers WHERE status = 'pending') AS pending`).bind(now() - 86400, now() - 86400, now() - 86400).first();
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
