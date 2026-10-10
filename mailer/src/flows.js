// Every automated email: what triggers it (theme tracking, the Shopify custom pixel, schedule) and how it's built.
// LuxeMail keeps its own mailing list and doesn't rely on Shopify showing customer emails. Marketing email
// only goes to addresses that ticked the consent box (or opted in on their Shopify account), checked again
// right before every send.
import { now, HOUR, DAY, cleanEmail, localParts, getKV, setKV, money, esc, hmacHex } from './util.js';
import {
  verifyOrder, createPersonalCode, createSharedCode, gql, productByHandle, recommendations, collectionProducts, latestArticles,
} from './shopify.js';
import {
  enqueue, layout, heading, para, button, offerCard, tierCard, tierNudge, productGrid, articleList, sendViaResend,
  unsubscribeUrl, sentTodayCount,
} from './email.js';

export const CONSENT_TEXT = 'Signed up to the email list (form says: By signing up you agree to get our emails)';
const str = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));

/* ======================= Mailing list ======================= */

export async function subscriber(env, email) {
  return env.DB.prepare('SELECT * FROM subscribers WHERE email = ?').bind(email).first();
}

/** Simple per-IP limit so nobody can use the sign-up beacon to sign up lists of strangers. */
export async function rateLimited(env, ip, max) {
  if (!ip) return false;
  const key = `rl:${await hmacHex(env.UNSUB_SECRET, ip)}:${Math.floor(now() / HOUR)}`;
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first();
  const n = row ? Number(row.v) : 0;
  if (n >= max) return true;
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v, expires_at) VALUES (?, ?, ?)').bind(key, String(n + 1), now() + 2 * HOUR).run();
  return false;
}

/**
 * Someone joined: they ticked "Email me deals and new arrivals" on a form, or are signed in with
 * "accepts marketing" on their Shopify account. That's express consent (Spam Act), so they're subscribed
 * straight away and the welcome series starts. Returns the welcome email's job id, to send it right away.
 */
export async function subscribe(env, { email, firstName, source, page, ip }) {
  const existing = await subscriber(env, email);
  if (existing && existing.status === 'subscribed') {
    if (firstName && !existing.first_name) await env.DB.prepare('UPDATE subscribers SET first_name = ? WHERE email = ?').bind(firstName, email).run();
    return null;
  }
  // Signed-in customers are only added once automatically: if they unsubscribed, that stands even though
  // their Shopify account may still say "accepts marketing". Only ticking the box on a form adds them again.
  if (existing && source === 'account') return null;
  if (await rateLimited(env, ip, 5)) return null;
  await env.DB.prepare(`INSERT INTO subscribers (email, first_name, status, source, consent_text, consent_page, requested_at, confirmed_at)
      VALUES (?, ?, 'subscribed', ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET status = 'subscribed', first_name = COALESCE(excluded.first_name, subscribers.first_name),
        source = excluded.source, consent_text = excluded.consent_text, consent_page = excluded.consent_page,
        requested_at = excluded.requested_at, confirmed_at = excluded.confirmed_at, unsubscribed_at = NULL`)
    .bind(email, firstName, source, source === 'account' ? 'Accepts marketing on their store account' : CONSENT_TEXT, page, now(), now()).run();
  await env.DB.prepare('DELETE FROM suppressions WHERE email = ?').bind(email).run();
  // A returning subscriber gets a fresh welcome series (the dedupe keys include the sign-up day).
  const day = new Date(now() * 1000).toISOString().slice(0, 10);
  const data = { firstName };
  const id = await enqueue(env, { email, flow: 'welcome1', dedupe: `welcome1:${email}:${day}`, priority: 1, data });
  await enqueue(env, { email, flow: 'welcome2', dedupe: `welcome2:${email}:${day}`, priority: 4, data, sendAfter: now() + 3 * DAY });
  // The 15% last-call code goes to an address once ever, so re-subscribing can't farm new codes.
  await enqueue(env, { email, flow: 'welcome3', dedupe: `welcome3:${email}`, priority: 4, data, sendAfter: now() + 7 * DAY });
  return id;
}

/**
 * The subscriber's own welcome code (unique, 10%, single use, 30 days), created once per address ever.
 * The site's sign-up message and the welcome emails both use it. If two requests arrive together,
 * only the one that claims the row creates the code; the other waits for it.
 */
export async function welcomeCodeFor(env, email) {
  if (env.PREVIEW) return createPersonalCode(env, { prefix: 'WELCOME10', percent: 10, days: 30, title: 'Welcome 10%' });
  const read = () => env.DB.prepare('SELECT code, ends_at FROM welcome_codes WHERE email = ?').bind(email).first();
  let row = await read();
  if (row && row.code) return { code: row.code, endsAt: row.ends_at };
  const claim = await env.DB.prepare('INSERT OR IGNORE INTO welcome_codes (email, code, ends_at, created_at) VALUES (?, NULL, NULL, ?)').bind(email, now()).run();
  if (claim.meta && claim.meta.changes) {
    try {
      const { code, endsAt } = await createPersonalCode(env, { prefix: 'WELCOME10', percent: 10, days: 30, title: 'Welcome 10%' });
      await env.DB.prepare('UPDATE welcome_codes SET code = ?, ends_at = ? WHERE email = ?').bind(code, endsAt, email).run();
      return { code, endsAt };
    } catch (e) {
      await env.DB.prepare('DELETE FROM welcome_codes WHERE email = ? AND code IS NULL').bind(email).run(); // let a later try make it
      throw e;
    }
  }
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500));
    row = await read();
    if (row && row.code) return { code: row.code, endsAt: row.ends_at };
  }
  throw new Error('welcome code still being created');
}

export async function unsubscribe(env, email, reason = 'unsubscribed') {
  await env.DB.prepare('INSERT OR REPLACE INTO suppressions (email, reason, at) VALUES (?, ?, ?)').bind(email, reason, now()).run();
  await env.DB.prepare(`UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE email = ?`).bind(now(), email).run();
  await env.DB.prepare(`UPDATE sends SET status = 'skipped', error = ? WHERE email = ? AND status = 'queued'`).bind(reason, email).run();
}

/** The consent check before every send: our own list, never Shopify's marketing status. */
export async function mayEmail(env, email, flow) {
  const suppressed = await env.DB.prepare('SELECT email FROM suppressions WHERE email = ?').bind(email).first();
  const s = await subscriber(env, email);
  return !!s && s.status === 'subscribed' && !suppressed;
}

/* ======================= Inputs ======================= */

/**
 * Theme beacon. Body: { cid, t?, h?, p?, ti?, e?, fn?, c?, src?, pg? }
 *  - t = view | cart | wishlist | unwishlist: browsing activity for this browser.
 *  - e with c = 1: newsletter form with the consent box ticked (src = footer/popup/...), or a signed-in
 *    customer whose Shopify account accepts marketing (src = account). Subscribes them.
 */
export async function recordEvent(env, body, ip = null) {
  const cid = typeof body.cid === 'string' ? body.cid.slice(0, 64) : null;
  if (!cid) return null;
  const email = cleanEmail(body.e);
  const firstName = str(body.fn, 60);
  let job = null;
  if (email && Number(body.c) === 1) {
    const source = ['account', 'footer', 'popup', 'homepage', 'password', 'newsletter'].includes(body.src) ? body.src : 'newsletter';
    job = await subscribe(env, { email, firstName, source, page: str(body.pg, 300), ip });
    // Only browsers that gave consent are linked to an email, so their activity can personalise emails.
    await env.DB.prepare(`INSERT INTO clients (client_id, email, first_name, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(client_id) DO UPDATE SET email = excluded.email, first_name = COALESCE(excluded.first_name, clients.first_name), updated_at = excluded.updated_at`)
      .bind(cid, email, firstName, now()).run();
    await env.DB.prepare('UPDATE events SET email = ? WHERE client_id = ? AND email IS NULL').bind(email, cid).run();
  }
  const type = ['view', 'cart', 'wishlist', 'unwishlist'].includes(body.t) ? body.t : null;
  if (!type || !body.h) return job;
  const known = (await env.DB.prepare('SELECT email FROM clients WHERE client_id = ?').bind(cid).first())?.email || null;
  await env.DB.prepare('INSERT INTO events (client_id, email, type, handle, product_id, title, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(cid, known, type, String(body.h).slice(0, 200), str(body.p, 40), str(body.ti, 200), now()).run();
  return job;
}

function pixelItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, 20).map((l) => ({
    variantId: str(l && l.variantId, 40) && String(l.variantId).replace(/\D/g, ''),
    qty: Math.max(1, Math.min(99, Number(l && l.qty) || 1)),
    handle: str(l && l.handle, 200),
    title: str(l && l.title, 200),
  })).filter((l) => l.variantId || l.handle);
}

/**
 * Shopify custom pixel (mailer/pixel.js). Body: { t: 'checkout' | 'order', token, e, fn, total, items, order }
 * Checkouts are only stored for subscribers. A completed checkout always stops its reminders.
 */
export async function recordPixel(env, body) {
  const token = str(body.token, 100);
  const email = cleanEmail(body.e);
  if (!token) return;
  const items = pixelItems(body.items);
  const member = email ? await subscriber(env, email) : null;
  const isMember = member && member.status === 'subscribed';

  if (body.t === 'checkout') {
    if (!isMember) return;
    await env.DB.prepare(`INSERT INTO checkouts (token, email, first_name, total, items, started_at, updated_at, completed)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(token) DO UPDATE SET email = excluded.email, first_name = COALESCE(excluded.first_name, checkouts.first_name),
          total = excluded.total, items = CASE WHEN excluded.items = '[]' THEN checkouts.items ELSE excluded.items END, updated_at = excluded.updated_at`)
      .bind(token, email, str(body.fn, 60) || member.first_name, str(body.total, 20), JSON.stringify(items), now(), now()).run();
    return;
  }

  if (body.t !== 'order') return;
  await env.DB.prepare('UPDATE checkouts SET completed = 1 WHERE token = ?').bind(token).run();
  if (!isMember || !body.order) return;
  await env.DB.prepare('UPDATE checkouts SET completed = 1 WHERE email = ? AND updated_at > ?').bind(email, now() - 7 * DAY).run();
  const orderId = String(body.order).replace(/\D/g, '').slice(0, 30);
  if (!orderId) return;
  // Pixel data can be forged, so the order (and its total, which drives VIP) is checked in Shopify.
  // An order Shopify can't confirm is kept as unverified: it still stops reminders but doesn't count towards VIP.
  let verified = null;
  try { verified = await verifyOrder(env, orderId); } catch (e) { console.error('verifyOrder', e); }
  const handles = items.map((i) => i.handle).filter(Boolean);
  await env.DB.prepare(`INSERT OR IGNORE INTO orders (id, email, first_name, total_cents, handles, verified, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(orderId, email, str(body.fn, 60) || member.first_name, verified ? verified.totalCents : null, JSON.stringify(handles), verified ? 1 : 0, now()).run();
  await enqueue(env, { email, flow: 'postpurchase', dedupe: `postpurchase:${orderId}`, priority: 3,
    data: { firstName: str(body.fn, 60) || member.first_name, handles }, sendAfter: now() + 7 * DAY });
}

/* ======================= Scheduled scans ======================= */

async function orderedSince(env, email, since) {
  const row = await env.DB.prepare('SELECT id FROM orders WHERE email = ? AND created_at >= ? LIMIT 1').bind(email, since).first();
  return !!row;
}

async function sentRecently(env, email, flow, seconds) {
  const row = await env.DB.prepare(`SELECT id FROM sends WHERE email = ? AND flow = ? AND created_at > ? LIMIT 1`).bind(email, flow, now() - seconds).first();
  return !!row;
}

export async function scanAbandonment(env) {
  const t = now();
  // Abandoned checkout (from the pixel): a reminder after 4 hours, then a 5% code after 2 days.
  const { results: checkouts } = await env.DB.prepare(
    `SELECT * FROM checkouts WHERE completed = 0 AND updated_at < ? AND updated_at > ?`).bind(t - 4 * HOUR, t - 6 * DAY).all();
  for (const ck of checkouts) {
    if (await orderedSince(env, ck.email, ck.started_at - HOUR)) continue;
    const items = JSON.parse(ck.items || '[]');
    if (!items.length) continue;
    const data = { token: ck.token, items, firstName: ck.first_name, subtotal: ck.total };
    if (t - ck.updated_at < 2 * DAY) {
      await enqueue(env, { email: ck.email, flow: 'checkout1', dedupe: `checkout1:${ck.token}`, priority: 1, data });
    } else {
      await enqueue(env, { email: ck.email, flow: 'checkout2', dedupe: `checkout2:${ck.token}`, priority: 1, data });
    }
  }

  // Added to cart, never checked out: reminder after 4 hours, then a 5% code a day later.
  const { results: carts } = await env.DB.prepare(
    `SELECT email, MIN(at) AS first_at, MAX(at) AS last_at, GROUP_CONCAT(DISTINCT handle) AS handles
       FROM events WHERE type = 'cart' AND email IS NOT NULL AND at > ? GROUP BY email`).bind(t - 3 * DAY).all();
  for (const c of carts) {
    if (await orderedSince(env, c.email, c.first_at)) continue;
    const startedCheckout = await env.DB.prepare('SELECT token FROM checkouts WHERE email = ? AND updated_at >= ? LIMIT 1').bind(c.email, c.first_at).first();
    if (startedCheckout) continue; // the checkout flow covers them
    const handles = (c.handles || '').split(',').slice(0, 4);
    const day = new Date(c.first_at * 1000).toISOString().slice(0, 10);
    if (t - c.last_at > 4 * HOUR) {
      await enqueue(env, { email: c.email, flow: 'cart1', dedupe: `cart1:${c.email}:${day}`, priority: 2, data: { handles } });
    }
    const cart1 = await env.DB.prepare(`SELECT sent_at FROM sends WHERE dedupe = ? AND status = 'sent'`).bind(`cart1:${c.email}:${day}`).first();
    if (cart1 && t - cart1.sent_at > 20 * HOUR) {
      await enqueue(env, { email: c.email, flow: 'cart2', dedupe: `cart2:${c.email}:${day}`, priority: 2, data: { handles } });
    }
  }

  // Viewed products but didn't add to cart or buy: one email, at most once a week.
  const { results: views } = await env.DB.prepare(
    `SELECT email, MAX(at) AS last_at, MIN(at) AS first_at FROM events
       WHERE type = 'view' AND email IS NOT NULL AND at BETWEEN ? AND ? GROUP BY email`).bind(t - 3 * DAY, t - DAY).all();
  for (const v of views) {
    if (await orderedSince(env, v.email, v.first_at)) continue;
    const carted = await env.DB.prepare(`SELECT id FROM events WHERE email = ? AND type = 'cart' AND at >= ? LIMIT 1`).bind(v.email, v.first_at).first();
    if (carted || await sentRecently(env, v.email, 'browse', 7 * DAY)) continue;
    const top = await env.DB.prepare(`SELECT handle, COUNT(*) AS n, MAX(at) AS last FROM events WHERE email = ? AND type = 'view' AND at >= ?
        GROUP BY handle ORDER BY n DESC, last DESC LIMIT 1`).bind(v.email, v.first_at).first();
    if (!top) continue;
    const week = Math.floor(t / (7 * DAY));
    await enqueue(env, { email: v.email, flow: 'browse', dedupe: `browse:${v.email}:${week}`, priority: 3, data: { handle: top.handle } });
  }

  // Wishlist: items saved 3+ days ago and still not bought; at most every 14 days.
  const { results: wishers } = await env.DB.prepare(
    `SELECT DISTINCT email FROM events WHERE type = 'wishlist' AND email IS NOT NULL AND at < ?`).bind(t - 3 * DAY).all();
  for (const w of wishers) {
    if (await sentRecently(env, w.email, 'wishlist', 14 * DAY)) continue;
    const handles = await currentWishlist(env, w.email);
    if (!handles.length) continue;
    const fortnight = Math.floor(t / (14 * DAY));
    await enqueue(env, { email: w.email, flow: 'wishlist', dedupe: `wishlist:${w.email}:${fortnight}`, priority: 4, data: { handles: handles.slice(0, 4) } });
  }
}

async function currentWishlist(env, email) {
  const { results } = await env.DB.prepare(
    `SELECT handle, type, MAX(at) AS at FROM events WHERE email = ? AND type IN ('wishlist','unwishlist') GROUP BY handle, type`).bind(email).all();
  const latest = {};
  for (const r of results) if (!latest[r.handle] || latest[r.handle].at < r.at) latest[r.handle] = r;
  return Object.values(latest).filter((r) => r.type === 'wishlist').map((r) => r.handle);
}

/** Once a day: VIP welcome and win-back, from our own (verified) order history. */
export async function scanDaily(env) {
  const { ymd, hour } = localParts(env);
  if (hour < 10 || (await getKV(env, 'daily_ran')) === ymd) return;
  await setKV(env, 'daily_ran', ymd);
  await env.DB.prepare(`DELETE FROM kv WHERE k LIKE 'rl:%' AND expires_at < ?`).bind(now()).run();
  const vipCents = Number(env.VIP_SPEND_CENTS || 25000);
  const { results: vips } = await env.DB.prepare(
    `SELECT s.email, s.first_name FROM subscribers s JOIN orders o ON o.email = s.email AND o.verified = 1
      WHERE s.status = 'subscribed' GROUP BY s.email HAVING SUM(o.total_cents) >= ?`).bind(vipCents).all();
  for (const m of vips) {
    await enqueue(env, { email: m.email, flow: 'vip', dedupe: `vip:${m.email}`, priority: 3, data: { firstName: m.first_name } });
  }
  const quarter = `${new Date().getUTCFullYear()}Q${Math.floor(new Date().getUTCMonth() / 3) + 1}`;
  const { results: lapsed } = await env.DB.prepare(
    `SELECT s.email, s.first_name FROM subscribers s JOIN orders o ON o.email = s.email
      WHERE s.status = 'subscribed' GROUP BY s.email HAVING MAX(o.created_at) < ?`).bind(now() - Number(env.LAPSED_DAYS || 60) * DAY).all();
  for (const m of lapsed) {
    await enqueue(env, { email: m.email, flow: 'winback', dedupe: `winback:${m.email}:${quarter}`, priority: 4, data: { firstName: m.first_name } });
  }
}

const THEMES = ['new', 'picks', 'best', 'blog'];

/** Every second Tuesday from 6:30 pm Sydney time: the fortnightly email to the whole list, rotating 4 themes. */
export async function scanFortnightly(env) {
  const { day, hour, minute, ymd } = localParts(env);
  if (day !== 2 || hour < 18 || (hour === 18 && minute < 30)) return;
  const last = await getKV(env, 'fortnight_last');
  if (last && (Date.parse(ymd) - Date.parse(last)) < 13 * DAY * 1000) return;
  await setKV(env, 'fortnight_last', ymd);
  const index = Number((await getKV(env, 'fortnight_index')) || 0);
  await setKV(env, 'fortnight_index', (index + 1) % THEMES.length);
  const theme = THEMES[index % THEMES.length];
  const { results } = await env.DB.prepare(`SELECT email, first_name FROM subscribers WHERE status = 'subscribed'`).all();
  if (!results.length) return;
  // New arrivals and blog fortnights carry a subscriber code (one shared code, 7 days, once per customer).
  let offer = null;
  if (theme === 'new' || theme === 'blog') {
    try {
      offer = await createSharedCode(env, theme === 'new'
        ? { prefix: 'NEWIN10', percent: 10, days: 7, title: 'Subscribers 10% off New arrivals', collection: 'new-arrivals' }
        : { prefix: 'INSIDER10', percent: 10, days: 7, title: 'Subscribers 10% off everything' });
    } catch (e) { console.error('fortnight code', e); } // the email falls back to spend-and-save
  }
  for (const m of results) {
    await enqueue(env, { email: m.email, flow: 'fortnight', dedupe: `fortnight:${ymd}:${m.email}`, priority: 6,
      data: { theme, firstName: m.first_name, offer } });
  }
}

/* ======================= Building each email ======================= */

const hi = (name) => (name ? `Hi ${esc(name)},` : 'Hi there,');

async function productsForHandles(env, handles) {
  const out = [];
  for (const h of handles || []) { const p = await productByHandle(env, h); if (p && p.available) out.push(p); }
  return out;
}

/** The product a subscriber cares about most recently: last viewed, else first item of their last order. */
async function seedProductId(env, email) {
  const lastView = await env.DB.prepare(`SELECT product_id FROM events WHERE email = ? AND product_id IS NOT NULL ORDER BY at DESC LIMIT 1`).bind(email).first();
  if (lastView) return lastView.product_id;
  const lastOrder = await env.DB.prepare('SELECT handles FROM orders WHERE email = ? ORDER BY created_at DESC LIMIT 1').bind(email).first();
  const handle = lastOrder ? JSON.parse(lastOrder.handles || '[]')[0] : null;
  const product = handle ? await productByHandle(env, handle) : null;
  return product ? product.id : null;
}

async function personalPicks(env, email, limit = 4) {
  const seed = await seedProductId(env, email);
  if (seed) {
    const recs = await recommendations(env, seed, limit);
    if (recs.length >= 2) return recs;
  }
  return collectionProducts(env, 'best-sellers', limit);
}

// Department banners for the "Picked for you" email, matched to what the subscriber has been looking at.
const INTEREST_BANNERS = {
  audio: ['banner-picks-audio.jpg', 'Audio picks for you'],
  charging: ['banner-picks-charging.jpg', 'Charging picks you\'ll love'],
  'smart-home': ['banner-picks-home.jpg', 'Kitchen picks for you'],
  accessories: ['banner-picks-accessories.jpg', 'Accessories for you'],
};

async function interestBanner(env, email) {
  const seed = await seedProductId(env, email);
  if (seed) {
    const data = await gql(env, `query($id: ID!){ product(id: $id){ collections(first: 10){ nodes{ handle } } } }`,
      { id: `gid://shopify/Product/${String(seed).replace(/\D/g, '')}` });
    const handles = data.product ? data.product.collections.nodes.map((c) => c.handle) : [];
    const match = handles.find((h) => INTEREST_BANNERS[h]);
    if (match) return INTEREST_BANNERS[match];
  }
  return ['banner-picks-everyone.jpg', 'Picked for you this fortnight'];
}

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', timeZone: 'Australia/Sydney' });

/** Rebuilds the checkout as a cart link (/cart/variant:qty,...), which also takes a discount code. */
function cartLink(env, items, code) {
  const lines = (items || []).filter((i) => i.variantId).map((i) => `${i.variantId}:${i.qty || 1}`);
  if (!lines.length) return code ? `${env.STORE_URL}/discount/${code}?redirect=/cart` : `${env.STORE_URL}/cart`;
  return `${env.STORE_URL}/cart/${lines.join(',')}${code ? `?discount=${encodeURIComponent(code)}` : ''}`;
}

export const builders = {
  async welcome1(env, email, d) {
    const { code, endsAt } = await welcomeCodeFor(env, email);
    const picks = await collectionProducts(env, 'best-sellers', 4);
    return {
      subject: `Welcome to ${env.BRAND}: here's 10% off`,
      preheader: `Your code ${code} is inside, plus a few of our most-loved picks.`,
      banner: 'banner-welcome.jpg', bannerAlt: 'Welcome, here is 10% off your first order',
      body: heading('Welcome to the crew!') + para(`${hi(d.firstName)} thanks for joining. We hand-pick everyday tech, home and lifestyle gear, and every order is dispatched within 3-4 business days with tracking.`)
        + offerCard(env, { theme: 'welcome', big: '10%', unit: 'off', title: 'Your welcome gift: 10% off your order', code,
          fine: `Your own code: single use, valid until ${fmtDate(endsAt)}. Can't be combined with other discounts. The button applies it for you.` })
        + button('Start shopping', `${env.STORE_URL}/discount/${code}?redirect=/collections/all`)
        + productGrid(picks, { heading: 'Most loved right now' }),
    };
  },
  async welcome2(env, email, d) {
    if (await orderedSince(env, email, 0)) return null;
    const { code, endsAt } = await welcomeCodeFor(env, email);
    if (Date.parse(endsAt) < Date.now() + DAY * 1000) return null;
    const picks = await collectionProducts(env, 'new-arrivals', 4);
    return {
      subject: 'Still deciding? Your 10% is waiting',
      preheader: `${code} still takes 10% off, until ${fmtDate(endsAt)}.`,
      banner: 'banner-picks-everyone.jpg', bannerAlt: 'Fresh picks for you',
      body: heading('Your 10% is still here') + para(`${hi(d.firstName)} in case you missed it, your welcome code is ready whenever you are.`)
        + offerCard(env, { theme: 'reminder', big: '10%', unit: 'still yours', title: 'Your welcome code hasn\'t been used yet', code,
          fine: `Single use, valid until ${fmtDate(endsAt)}. Can't be combined with other discounts.` })
        + productGrid(picks, { heading: 'Just landed' })
        + button('Use my 10%', `${env.STORE_URL}/discount/${code}?redirect=/collections/all`),
    };
  },
  async welcome3(env, email, d) {
    if (await orderedSince(env, email, 0)) return null;
    const { code, endsAt } = await createPersonalCode(env, { prefix: 'WELCOME15', percent: 15, days: 3, title: 'Welcome last call 15%' });
    const picks = await collectionProducts(env, 'best-sellers', 4);
    return {
      subject: 'Last call: 15% off, for 3 days',
      preheader: `${code} takes 15% off until ${fmtDate(endsAt)}.`,
      banner: 'banner-last-call.jpg', bannerAlt: 'Last call: 15% off, ends in 3 days',
      body: heading('Last call: 15% off') + para(`${hi(d.firstName)} you've been with us a week, so here's our best new-member offer: 15% off your order, for the next 3 days.`)
        + offerCard(env, { theme: 'lastcall', big: '15%', unit: '3 days only', title: 'Your new-member offer', code,
          fine: `Single use, valid until ${fmtDate(endsAt)}. Can't be combined with other discounts. The button applies it for you.` })
        + button('Use my 15%', `${env.STORE_URL}/discount/${code}?redirect=/collections/all`)
        + productGrid(picks, { heading: 'Most loved right now' }),
    };
  },
  async checkout1(env, email, d) {
    const ck = await env.DB.prepare('SELECT completed FROM checkouts WHERE token = ?').bind(d.token).first();
    if (ck && ck.completed) return null;
    const products = await productsForHandles(env, (d.items || []).map((i) => i.handle));
    if (!products.length) return null;
    return {
      subject: 'You left something at checkout',
      preheader: 'Your items are still available.',
      banner: 'banner-checkout.jpg', bannerAlt: 'Your checkout is waiting',
      body: heading('Ready when you are') + para(`${hi(d.firstName)} you started a checkout but didn't quite finish. Your items are below, and the button puts them straight back in your cart.`)
        + productGrid(products, { heading: 'Still in your checkout' })
        + tierNudge(env, d.subtotal != null ? Math.round(parseFloat(d.subtotal) * 100) : null)
        + button('Complete my order', cartLink(env, d.items)),
    };
  },
  async checkout2(env, email, d) {
    const ck = await env.DB.prepare('SELECT completed FROM checkouts WHERE token = ?').bind(d.token).first();
    if (ck && ck.completed) return null;
    const products = await productsForHandles(env, (d.items || []).map((i) => i.handle));
    if (!products.length) return null;
    const { code, endsAt } = await createPersonalCode(env, { prefix: 'BACK5', percent: 5, days: 7, title: 'Abandoned checkout 5%' });
    return {
      subject: 'Here\'s 5% off to finish your order',
      preheader: `Your items are still available, and ${code} takes 5% off.`,
      banner: 'banner-reminder.jpg', bannerAlt: 'Here is 5% off to finish up',
      body: heading('A little nudge, with 5% off') + para(`${hi(d.firstName)} your items are still available. Here's 5% off to help you decide.`)
        + offerCard(env, { theme: 'personal', big: '5%', unit: 'off', title: 'A code just for you, to finish your order', code,
          fine: `Single use, valid until ${fmtDate(endsAt)}. Can't be combined with other discounts. The button applies it for you.` })
        + button('Complete my order', cartLink(env, d.items, code)) + productGrid(products, { heading: 'Still in your checkout' }),
    };
  },
  async cart1(env, email, d) {
    const products = await productsForHandles(env, d.handles);
    if (!products.length) return null;
    return {
      subject: 'Your cart is waiting',
      preheader: 'The things you added are still available.',
      banner: 'banner-checkout.jpg', bannerAlt: 'Your cart is waiting',
      body: heading('Forgot something?') + para('You added these to your cart. They\'re still in stock, and your cart is saved on the device you used.')
        + productGrid(products) + button('Back to my cart', `${env.STORE_URL}/cart`),
    };
  },
  async cart2(env, email, d) {
    const products = await productsForHandles(env, d.handles);
    if (!products.length) return null;
    const { code, endsAt } = await createPersonalCode(env, { prefix: 'BACK5', percent: 5, days: 7, title: 'Abandoned cart 5%' });
    return {
      subject: '5% off to finish up',
      preheader: `${code} takes 5% off your cart.`,
      banner: 'banner-reminder.jpg', bannerAlt: 'Here is 5% off to finish up',
      body: heading('Here\'s 5% off your cart') + para('Still thinking it over? Here\'s a little something to help.')
        + offerCard(env, { theme: 'personal', big: '5%', unit: 'off', title: 'A code just for you, for what\'s in your cart', code,
          fine: `Single use, valid until ${fmtDate(endsAt)}. Can't be combined with other discounts. The button applies it for you.` })
        + productGrid(products)
        + button('Use my 5%', `${env.STORE_URL}/discount/${code}?redirect=/cart`),
    };
  },
  async browse(env, email, d) {
    const product = await productByHandle(env, d.handle);
    if (!product || !product.available) return null;
    const recs = (await recommendations(env, product.id, 4)).filter((p) => p.handle !== product.handle).slice(0, 2);
    return {
      subject: `Still thinking about the ${product.title.split(/[,|(]/)[0].trim()}?`,
      preheader: 'The one you were looking at is still in stock.',
      banner: 'banner-browse.jpg', bannerAlt: 'You looked, we noticed',
      body: heading('Still thinking it over?') + para('You were checking this out. Here it is again, in case you want another look.')
        + productGrid([product]) + productGrid(recs, { heading: 'You might also like' }),
    };
  },
  async wishlist(env, email, d) {
    const products = await productsForHandles(env, d.handles);
    if (!products.length) return null;
    return {
      subject: 'Your wishlist misses you',
      preheader: 'The things you saved are still in stock.',
      banner: 'banner-wishlist.jpg', bannerAlt: 'Your saved picks',
      body: heading('Your saved picks') + para('You saved these to your wishlist. Good news: they\'re still in stock.')
        + productGrid(products) + button('View my wishlist', `${env.STORE_URL}/pages/wishlist`),
    };
  },
  async postpurchase(env, email, d) {
    const bought = (d.handles || [])[0] ? await productByHandle(env, d.handles[0]) : null;
    const recs = bought ? (await recommendations(env, bought.id, 5)).filter((p) => !(d.handles || []).includes(p.handle)).slice(0, 4) : [];
    const picks = recs.length ? recs : await collectionProducts(env, 'best-sellers', 4);
    const { code, endsAt } = await createPersonalCode(env, { prefix: 'NEXT10', percent: 10, days: 30, title: 'Thank-you 10% next order' });
    return {
      subject: 'A thank-you: 10% off your next order',
      preheader: `${code} takes 10% off your next order, until ${fmtDate(endsAt)}.`,
      banner: 'banner-next-order.jpg', bannerAlt: 'A thank-you gift: 10% off your next order',
      body: heading('Thanks for shopping with us!') + para(`${hi(d.firstName)} we hope you're enjoying your order. As a thank-you, here's 10% off your next one.`)
        + offerCard(env, { theme: 'thanks', big: '10%', unit: 'next order', title: 'A thank-you gift for your next order', code,
          fine: `Single use, valid until ${fmtDate(endsAt)}. Can't be combined with other discounts. The button applies it for you.` })
        + button('Use my 10%', `${env.STORE_URL}/discount/${code}?redirect=/collections/all`)
        + productGrid(picks, { heading: recs.length ? 'Goes great with your order' : 'Most loved right now' })
        + para('Anything not right with your order? Just reply to this email and we\'ll sort it out.'),
      // A week before the code ends, remind them (skipped if they've ordered again by then).
      afterSend: () => enqueue(env, { email, flow: 'nextreminder', dedupe: `nextreminder:${code}`, priority: 4,
        data: { firstName: d.firstName, code, endsAt, since: now() }, sendAfter: Math.floor(Date.parse(endsAt) / 1000) - 7 * DAY }),
    };
  },
  async nextreminder(env, email, d) {
    if (await orderedSince(env, email, d.since)) return null;
    if (Date.parse(d.endsAt) < Date.now() + DAY * 1000) return null;
    const picks = await personalPicks(env, email, 4);
    return {
      subject: `Your 10% ends ${fmtDate(d.endsAt)}`,
      preheader: `${d.code} still takes 10% off your next order.`,
      banner: 'banner-next-reminder.jpg', bannerAlt: 'Your 10% is still waiting',
      body: heading('Your 10% is still waiting') + para(`${hi(d.firstName)} a quick reminder: your thank-you code still takes 10% off your next order, until ${fmtDate(d.endsAt)}.`)
        + offerCard(env, { theme: 'thanks', big: '10%', unit: 'next order', title: 'Your thank-you code', code: d.code,
          fine: `Single use, valid until ${fmtDate(d.endsAt)}. Can't be combined with other discounts. The button applies it for you.` })
        + button('Use my 10%', `${env.STORE_URL}/discount/${d.code}?redirect=/collections/all`)
        + productGrid(picks, { heading: 'Picked for you' }),
    };
  },

  async vip(env, email, d) {
    const picks = await collectionProducts(env, 'new-arrivals', 4);
    return {
      subject: 'You\'re a VIP. Here\'s 10% off every order',
      preheader: 'Thanks for being one of our best customers.',
      banner: 'banner-vip.jpg', bannerAlt: 'You are a VIP, 10% off every order',
      body: heading('Welcome to VIP') + para(`${hi(d.firstName)} you've spent $250 or more with us. Thank you! As a VIP, this code takes 10% off every order, any time.`)
        + offerCard(env, { theme: 'vip', big: '10%', unit: 'every order', title: 'VIP pricing, on every order, any time', code: 'VIP10',
          fine: 'For customers who\'ve spent $250+ with us. Use it as often as you like. Can\'t be combined with other discounts.' })
        + productGrid(picks, { heading: 'New this fortnight' })
        + button('Shop with VIP10', `${env.STORE_URL}/discount/VIP10?redirect=/collections/all`),
    };
  },
  async winback(env, email, d) {
    const { code, endsAt } = await createPersonalCode(env, { prefix: 'COMEBACK15', percent: 15, days: 14, title: 'Win-back 15%' });
    const picks = await collectionProducts(env, 'new-arrivals', 4);
    return {
      subject: 'We miss you. Here\'s 15% off',
      preheader: 'See what\'s new since your last visit.',
      banner: 'banner-winback.jpg', bannerAlt: 'We miss you',
      body: heading('It\'s been a while!') + para(`${hi(d.firstName)} here's what's new since your last visit, plus 15% off your next order.`)
        + offerCard(env, { theme: 'winback', big: '15%', unit: 'off', title: 'Welcome back: 15% off your next order', code,
          fine: `Single use, valid until ${fmtDate(endsAt)}. Can't be combined with other discounts. The button applies it for you.` })
        + productGrid(picks, { heading: 'New since your last visit' })
        + button('Use my 15%', `${env.STORE_URL}/discount/${code}?redirect=/collections/all`),
    };
  },
  async fortnight(env, email, d) {
    const intro = `${hi(d.firstName)} here's what's worth a look this fortnight, picked by our team.`;
    // Each theme carries a different offer: a New arrivals code, spend-and-save, or a sitewide subscriber code.
    const insider = (unit, title, where, redirect) => d.offer
      ? offerCard(env, { theme: 'insider', big: '10%', unit, title, code: d.offer.code,
          fine: `${where} until ${fmtDate(d.offer.endsAt)}. Once per customer. Can't be combined with other discounts.` })
        + button('Use my 10%', `${env.STORE_URL}/discount/${d.offer.code}?redirect=${redirect}`)
      : tierCard(env);
    if (d.theme === 'new') {
      const p = await collectionProducts(env, 'new-arrivals', 4);
      return { subject: d.offer ? 'Just landed, and 10% off for subscribers' : 'Just landed: new this fortnight', preheader: 'Fresh arrivals, picked by our team.', banner: 'banner-new-arrivals.jpg', bannerAlt: 'New arrivals this fortnight',
        body: heading('New arrivals') + para(intro) + insider('new arrivals', 'Subscriber code: 10% off New arrivals', 'Valid on the New arrivals collection', '/collections/new-arrivals')
          + productGrid(p) + (d.offer ? '' : button('See what\'s new', `${env.STORE_URL}/collections/new-arrivals`)) };
    }
    if (d.theme === 'best') {
      const p = await collectionProducts(env, 'best-sellers', 4);
      return { subject: 'What everyone\'s buying right now', preheader: 'This fortnight\'s best sellers.', banner: 'banner-best-sellers.jpg', bannerAlt: 'Best sellers this fortnight',
        body: heading('Most loved right now') + para(intro) + productGrid(p) + tierCard(env) + button('Shop best sellers', `${env.STORE_URL}/collections/best-sellers`) };
    }
    if (d.theme === 'blog') {
      const articles = await latestArticles(env, 3);
      const p = await personalPicks(env, email, 2);
      return { subject: d.offer ? 'New guides, plus 10% off for subscribers' : 'From the tech desk: new guides worth a read', preheader: 'Buying tips and how-tos from our team.', banner: 'banner-blog.jpg', bannerAlt: 'New guides worth a read',
        body: heading('From the tech desk') + para(`${hi(d.firstName)} a few guides from our team, plus a couple of picks for you.`)
          + articleList(articles) + insider('subscribers only', 'A subscriber code, on everything', 'Valid on everything', '/collections/all')
          + productGrid(p, { heading: 'Picked for you' }) + (d.offer ? '' : button('Read all guides', `${env.STORE_URL}/blogs/news`)) };
    }
    const p = await personalPicks(env, email, 4);
    const [banner, bannerAlt] = await interestBanner(env, email);
    return { subject: 'Picked for you this fortnight', preheader: 'Chosen from what you\'ve looked at and bought.', banner, bannerAlt,
      body: heading('Picked for you') + para(intro) + productGrid(p) + tierCard(env) + button('Shop your picks', `${env.STORE_URL}/collections/all`) };
  },

};

/* ======================= Outbox ======================= */

/**
 * Sends queued emails, at most DAILY_SEND_LIMIT per 24 hours, after a fresh consent check.
 * With `id`, sends just that one job now (the welcome email, right after sign-up).
 */
export async function drainOutbox(env, { id } = {}) {
  const budget = Number(env.DAILY_SEND_LIMIT || 95) - (await sentTodayCount(env));
  if (budget <= 0) return { sent: 0, reason: 'daily limit reached' };
  const { results } = id
    ? await env.DB.prepare(`SELECT * FROM sends WHERE status = 'queued' AND id = ?`).bind(id).all()
    : await env.DB.prepare(`SELECT * FROM sends WHERE status = 'queued' AND created_at <= ? ORDER BY priority ASC, created_at ASC LIMIT ?`)
      .bind(now(), Math.min(budget, 40)).all();
  let sent = 0;
  for (const job of results) {
    const mark = (status, error = null) => env.DB.prepare('UPDATE sends SET status = ?, error = ?, sent_at = ? WHERE id = ?')
      .bind(status, error, now(), job.id).run();
    try {
      if (!(await mayEmail(env, job.email, job.flow))) { await mark('skipped', 'not subscribed'); continue; }
      // One marketing email per person per 20 hours; anything else waits its turn.
      const recent = await env.DB.prepare(`SELECT id FROM sends WHERE email = ? AND status = 'sent' AND sent_at > ? LIMIT 1`)
        .bind(job.email, now() - 20 * HOUR).first();
      if (recent) {
        await env.DB.prepare('UPDATE sends SET created_at = ? WHERE id = ?').bind(now() + 6 * HOUR, job.id).run();
        continue;
      }
      const builder = builders[job.flow];
      const email = builder ? await builder(env, job.email, JSON.parse(job.payload || '{}')) : null;
      if (!email) { await mark('skipped', 'nothing to send'); continue; }
      const unsubUrl = await unsubscribeUrl(env, job.email);
      await sendViaResend(env, { to: job.email, subject: email.subject, unsubUrl,
        html: layout(env, { ...email, unsubUrl }) });
      await mark('sent');
      sent++;
      if (email.afterSend) await email.afterSend().catch((e) => console.error('afterSend', job.flow, e));
    } catch (err) {
      await mark('error', String(err && err.message || err).slice(0, 500));
    }
  }
  return { sent };
}

/* ======================= Weekly report ======================= */

export async function weeklyReport(env) {
  const { day, hour, ymd } = localParts(env);
  if (day !== 1 || hour < 9 || (await getKV(env, 'report_ran')) === ymd) return;
  await setKV(env, 'report_ran', ymd);
  const since = now() - 7 * DAY;
  const { results } = await env.DB.prepare(
    `SELECT flow, status, COUNT(*) AS n FROM sends WHERE created_at > ? GROUP BY flow, status ORDER BY flow`).bind(since).all();
  const { results: errors } = await env.DB.prepare(
    `SELECT flow, error, COUNT(*) AS n FROM sends WHERE status = 'error' AND created_at > ? GROUP BY flow, error LIMIT 10`).bind(since).all();
  const rows = results.map((r) => `<tr><td style="padding:4px 10px;">${esc(r.flow)}</td><td style="padding:4px 10px;">${esc(r.status)}</td><td style="padding:4px 10px;text-align:right;">${r.n}</td></tr>`).join('');
  const errs = errors.map((e) => `<li>${esc(e.flow)}: ${esc(e.error)} (${e.n})</li>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;color:#0B1220;"><h2>LuxeMail weekly report</h2>
<p>Emails in the last 7 days:</p><table style="border-collapse:collapse;border:1px solid #ddd;">${rows || '<tr><td style="padding:6px;">No emails this week.</td></tr>'}</table>
${errs ? `<p><strong>Errors to look at:</strong></p><ul>${errs}</ul>` : '<p>No errors. Everything is running.</p>'}</div>`;
  await sendViaResend(env, { to: env.ADMIN_EMAIL, subject: `LuxeMail weekly report (${ymd})`, html, unsubUrl: env.STORE_URL });
}
