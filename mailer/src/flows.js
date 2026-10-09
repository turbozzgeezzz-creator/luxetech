// Every automated email: what triggers it (webhooks, tracking, schedule) and how it's built.
// All marketing emails go only to customers whose Shopify marketing status is SUBSCRIBED,
// checked again right before sending.
import { now, HOUR, DAY, cleanEmail, localParts, getKV, setKV, money, esc } from './util.js';
import {
  gql, marketingStatus, segmentMembers, createPersonalCode, productByHandle, recommendations,
  collectionProducts, latestArticles,
} from './shopify.js';
import {
  enqueue, layout, heading, para, button, codeBox, productGrid, articleList, sendViaResend,
  unsubscribeUrl, sentTodayCount,
} from './email.js';

/* ======================= Inputs ======================= */

/** Theme tracking: product views, add to cart, wishlist, and identifying the shopper's email. */
export async function recordEvent(env, body) {
  const cid = typeof body.cid === 'string' ? body.cid.slice(0, 64) : null;
  if (!cid) return;
  const email = cleanEmail(body.e);
  if (email) {
    await env.DB.prepare(`INSERT INTO clients (client_id, email, first_name, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(client_id) DO UPDATE SET email = excluded.email, first_name = COALESCE(excluded.first_name, clients.first_name), updated_at = excluded.updated_at`)
      .bind(cid, email, body.fn ? String(body.fn).slice(0, 60) : null, now()).run();
  }
  const type = ['view', 'cart', 'wishlist', 'unwishlist'].includes(body.t) ? body.t : null;
  if (!type || !body.h) return;
  const known = email || (await env.DB.prepare('SELECT email FROM clients WHERE client_id = ?').bind(cid).first())?.email || null;
  await env.DB.prepare('INSERT INTO events (client_id, email, type, handle, product_id, title, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(cid, known, type, String(body.h).slice(0, 200), body.p ? String(body.p).slice(0, 40) : null, body.ti ? String(body.ti).slice(0, 200) : null, now()).run();
  if (email) {
    // Back-fill earlier anonymous events from this browser now that we know who it is.
    await env.DB.prepare('UPDATE events SET email = ? WHERE client_id = ? AND email IS NULL').bind(email, cid).run();
  }
}

export async function onCustomerWebhook(env, c) {
  const email = cleanEmail(c.email);
  if (!email) return;
  const consent = c.email_marketing_consent && c.email_marketing_consent.state;
  if (consent !== 'subscribed') return;
  const existing = await env.DB.prepare('SELECT email FROM subscribers WHERE email = ?').bind(email).first();
  if (existing) return;
  await env.DB.prepare('INSERT OR IGNORE INTO subscribers (email, customer_id, first_name, subscribed_at) VALUES (?, ?, ?, ?)')
    .bind(email, c.admin_graphql_api_id || null, c.first_name || null, now()).run();
  await enqueue(env, { email, flow: 'welcome1', dedupe: `welcome1:${email}`, priority: 1, data: { firstName: c.first_name } });
  await enqueue(env, { email, flow: 'welcome2', dedupe: `welcome2:${email}`, priority: 4, data: { firstName: c.first_name }, sendAfter: now() + 3 * DAY });
}

export async function onCheckoutWebhook(env, ck) {
  const email = cleanEmail(ck.email);
  if (!ck.token || !email) return;
  const items = (ck.line_items || []).map((l) => ({ productId: l.product_id, title: l.title, qty: l.quantity }));
  await env.DB.prepare(`INSERT INTO checkouts (token, email, customer_id, first_name, url, total, items, updated_at, completed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(token) DO UPDATE SET email=excluded.email, customer_id=excluded.customer_id, first_name=excluded.first_name,
        url=excluded.url, total=excluded.total, items=excluded.items, updated_at=excluded.updated_at,
        completed=MAX(checkouts.completed, excluded.completed)`)
    .bind(ck.token, email, ck.customer ? `gid://shopify/Customer/${ck.customer.id}` : null, ck.customer ? ck.customer.first_name : null,
      ck.abandoned_checkout_url || null, ck.total_price || null, JSON.stringify(items), now(), ck.completed_at ? 1 : 0).run();
}

export async function onOrderWebhook(env, o) {
  const email = cleanEmail(o.email || (o.customer && o.customer.email));
  const productIds = (o.line_items || []).map((l) => l.product_id).filter(Boolean);
  await env.DB.prepare('INSERT OR IGNORE INTO orders (id, email, customer_id, first_name, product_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(String(o.id), email, o.customer ? `gid://shopify/Customer/${o.customer.id}` : null, o.customer ? o.customer.first_name : null, JSON.stringify(productIds), now()).run();
  if (o.checkout_token) await env.DB.prepare('UPDATE checkouts SET completed = 1 WHERE token = ?').bind(o.checkout_token).run();
  if (email) {
    await env.DB.prepare('UPDATE checkouts SET completed = 1 WHERE email = ? AND updated_at > ?').bind(email, now() - 7 * DAY).run();
    await enqueue(env, { email, flow: 'postpurchase', dedupe: `postpurchase:${o.id}`, priority: 3,
      data: { firstName: o.customer && o.customer.first_name, productIds }, sendAfter: now() + 7 * DAY });
  }
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
  // Abandoned checkout: Shopify's own 10-hour email goes first; this is the 2-day follow-up with a 5% code.
  const { results: checkouts } = await env.DB.prepare(
    `SELECT * FROM checkouts WHERE completed = 0 AND updated_at < ? AND updated_at > ?`).bind(t - 2 * DAY, t - 6 * DAY).all();
  for (const ck of checkouts) {
    if (await orderedSince(env, ck.email, ck.updated_at - HOUR)) continue;
    await enqueue(env, { email: ck.email, flow: 'checkout2', dedupe: `checkout2:${ck.token}`, priority: 1,
      data: { token: ck.token, url: ck.url, items: JSON.parse(ck.items || '[]'), firstName: ck.first_name, customerId: ck.customer_id } });
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

/** Once a day: VIP welcome and win-back, from the Shopify segments. */
export async function scanDaily(env) {
  const { ymd, hour } = localParts(env);
  if (hour < 10 || (await getKV(env, 'daily_ran')) === ymd) return;
  await setKV(env, 'daily_ran', ymd);
  for (const m of await segmentMembers(env, env.VIP_SEGMENT_NAME)) {
    if (!m.subscribed) continue;
    await enqueue(env, { email: m.email, flow: 'vip', dedupe: `vip:${m.email}`, priority: 3, data: { firstName: m.firstName } });
  }
  const quarter = `${new Date().getUTCFullYear()}Q${Math.floor(new Date().getUTCMonth() / 3) + 1}`;
  for (const m of await segmentMembers(env, env.LAPSED_SEGMENT_NAME)) {
    if (!m.subscribed) continue;
    await enqueue(env, { email: m.email, flow: 'winback', dedupe: `winback:${m.email}:${quarter}`, priority: 4,
      data: { firstName: m.firstName, customerId: m.customerId } });
  }
}

const THEMES = ['new', 'picks', 'best', 'blog'];

/** Every second Tuesday from 6:30 pm Sydney time: the fortnightly email, rotating through 4 themes. */
export async function scanFortnightly(env) {
  const { day, hour, minute, ymd } = localParts(env);
  if (day !== 2 || hour < 18 || (hour === 18 && minute < 30)) return;
  const last = await getKV(env, 'fortnight_last');
  if (last && (Date.parse(ymd) - Date.parse(last)) < 13 * DAY * 1000) return;
  await setKV(env, 'fortnight_last', ymd);
  const index = Number((await getKV(env, 'fortnight_index')) || 0);
  await setKV(env, 'fortnight_index', (index + 1) % THEMES.length);
  const theme = THEMES[index % THEMES.length];
  for (const m of await segmentMembers(env, env.SUBSCRIBERS_SEGMENT_NAME, 5000)) {
    if (!m.subscribed) continue;
    await enqueue(env, { email: m.email, flow: 'fortnight', dedupe: `fortnight:${ymd}:${m.email}`, priority: 6,
      data: { theme, firstName: m.firstName } });
  }
}

/* ======================= Building each email ======================= */

const hi = (name) => (name ? `Hi ${esc(name)},` : 'Hi there,');

async function productsForIds(env, ids) {
  if (!ids || !ids.length) return [];
  const data = await gql(env, `query($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { handle } } }`,
    { ids: ids.slice(0, 6).map((id) => `gid://shopify/Product/${id}`) });
  const out = [];
  for (const n of data.nodes) if (n && n.handle) out.push(await productByHandle(env, n.handle));
  return out.filter(Boolean);
}

async function productsForHandles(env, handles) {
  const out = [];
  for (const h of handles || []) { const p = await productByHandle(env, h); if (p && p.available) out.push(p); }
  return out;
}

async function personalPicks(env, email, limit = 4) {
  const lastOrder = await env.DB.prepare('SELECT product_ids FROM orders WHERE email = ? ORDER BY created_at DESC LIMIT 1').bind(email).first();
  const lastView = await env.DB.prepare(`SELECT product_id FROM events WHERE email = ? AND product_id IS NOT NULL ORDER BY at DESC LIMIT 1`).bind(email).first();
  const seed = lastView ? lastView.product_id : lastOrder ? JSON.parse(lastOrder.product_ids || '[]')[0] : null;
  if (seed) {
    const recs = await recommendations(env, seed, limit);
    if (recs.length >= 2) return recs;
  }
  return collectionProducts(env, 'best-sellers', limit);
}

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', timeZone: 'Australia/Sydney' });

export const builders = {
  async welcome1(env, email, d) {
    const picks = await collectionProducts(env, 'best-sellers', 4);
    return {
      subject: `Welcome to ${env.BRAND}: here's 10% off`,
      preheader: 'Your code is inside, plus a few of our most-loved picks.',
      banner: 'banner-welcome.jpg', bannerAlt: 'Welcome, here is 10% off your first order',
      body: heading('Welcome to the crew!') + para(`${hi(d.firstName)} thanks for joining. We hand-pick everyday tech, home and lifestyle gear, and every order is dispatched within 3-4 business days with tracking.`)
        + para('Here\'s 10% off your first order:') + codeBox('WELCOME10', 'One use per customer, on your first order')
        + button('Start shopping', `${env.STORE_URL}/discount/WELCOME10?redirect=/collections/all`)
        + productGrid(picks, { heading: 'Most loved right now' }),
    };
  },
  async welcome2(env, email, d) {
    const status = await marketingStatus(env, email);
    if (status.orders > 0) return null;
    const picks = await collectionProducts(env, 'new-arrivals', 4);
    return {
      subject: 'Still deciding? Your 10% is waiting',
      preheader: 'WELCOME10 still works on your first order.',
      banner: 'banner-picks-everyone.jpg', bannerAlt: 'Fresh picks for you',
      body: heading('Your 10% is still here') + para(`${hi(d.firstName)} in case you missed it, your welcome code is ready whenever you are.`)
        + codeBox('WELCOME10', '10% off your first order')
        + productGrid(picks, { heading: 'Just landed' })
        + button('Use my 10%', `${env.STORE_URL}/discount/WELCOME10?redirect=/collections/all`),
    };
  },
  async checkout2(env, email, d) {
    const ck = await env.DB.prepare('SELECT completed FROM checkouts WHERE token = ?').bind(d.token).first();
    if (ck && ck.completed) return null;
    const { code, endsAt } = await createPersonalCode(env, { prefix: 'BACK5', percent: 5, days: 7, customerId: d.customerId, title: 'Abandoned checkout 5%' });
    const products = await productsForIds(env, (d.items || []).map((i) => i.productId));
    const url = d.url ? `${d.url}${d.url.includes('?') ? '&' : '?'}discount=${code}` : `${env.STORE_URL}/discount/${code}?redirect=/cart`;
    return {
      subject: 'Here\'s 5% off to finish your order',
      preheader: `Your cart is saved, and ${code} takes 5% off.`,
      banner: 'banner-reminder.jpg', bannerAlt: 'Here is 5% off to finish up',
      body: heading('A little nudge, with 5% off') + para(`${hi(d.firstName)} your checkout is still saved. Here's 5% off to help you decide.`)
        + codeBox(code, `5% off, valid until ${fmtDate(endsAt)}. Already applied when you use the button.`)
        + button('Complete my order', url) + productGrid(products, { heading: 'Still in your checkout' }),
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
    const status = await marketingStatus(env, email);
    const { code, endsAt } = await createPersonalCode(env, { prefix: 'BACK5', percent: 5, days: 7, customerId: status.customerId, title: 'Abandoned cart 5%' });
    return {
      subject: '5% off to finish up',
      preheader: `${code} takes 5% off your cart.`,
      banner: 'banner-reminder.jpg', bannerAlt: 'Here is 5% off to finish up',
      body: heading('Here\'s 5% off your cart') + para('Still thinking it over? Here\'s a little something to help.')
        + codeBox(code, `5% off, valid until ${fmtDate(endsAt)}`) + productGrid(products)
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
    const seed = (d.productIds || [])[0];
    const recs = seed ? await recommendations(env, seed, 4) : [];
    if (!recs.length) return null;
    return {
      subject: 'Goes great with your order',
      preheader: 'A few things that pair well with what you bought.',
      banner: 'banner-thank-you.jpg', bannerAlt: 'Thanks for your order',
      body: heading('Thanks for shopping with us!') + para(`${hi(d.firstName)} we hope you're enjoying your order. Here are a few things that go well with it.`)
        + productGrid(recs) + para('Anything not right? Just reply to this email and we\'ll sort it out.'),
    };
  },
  async vip(env, email, d) {
    const picks = await collectionProducts(env, 'new-arrivals', 4);
    return {
      subject: 'You\'re a VIP. Here\'s 10% off every order',
      preheader: 'Thanks for being one of our best customers.',
      banner: 'banner-vip.jpg', bannerAlt: 'You are a VIP, 10% off every order',
      body: heading('Welcome to VIP') + para(`${hi(d.firstName)} you've spent over $250 with us, thank you! As a VIP, this code takes 10% off every order, any time.`)
        + codeBox('VIP10', '10% off every order for VIP customers') + productGrid(picks, { heading: 'New this fortnight' })
        + button('Shop with VIP10', `${env.STORE_URL}/discount/VIP10?redirect=/collections/all`),
    };
  },
  async winback(env, email, d) {
    const { code, endsAt } = await createPersonalCode(env, { prefix: 'COMEBACK15', percent: 15, days: 14, customerId: d.customerId, title: 'Win-back 15%' });
    const picks = await collectionProducts(env, 'new-arrivals', 4);
    return {
      subject: 'We miss you. Here\'s 15% off',
      preheader: 'See what\'s new since your last visit.',
      banner: 'banner-winback.jpg', bannerAlt: 'We miss you',
      body: heading('It\'s been a while!') + para(`${hi(d.firstName)} here's what's new since your last visit, plus 15% off your next order.`)
        + codeBox(code, `15% off, valid until ${fmtDate(endsAt)}`) + productGrid(picks, { heading: 'New since your last visit' })
        + button('Use my 15%', `${env.STORE_URL}/discount/${code}?redirect=/collections/all`),
    };
  },
  async fortnight(env, email, d) {
    const intro = `${hi(d.firstName)} here's what's worth a look this fortnight. Every order is dispatched in 3-4 business days with tracking.`;
    const tiers = para(`<strong>Spend ${money(10000)} and save 5%, or ${money(15000)} and save 10%.</strong> Applied at checkout, no code needed.`);
    if (d.theme === 'new') {
      const p = await collectionProducts(env, 'new-arrivals', 4);
      return { subject: 'Just landed: new this fortnight', preheader: 'Fresh arrivals, picked by our team.', banner: 'banner-new-arrivals.jpg', bannerAlt: 'New arrivals this fortnight',
        body: heading('New arrivals') + para(intro) + productGrid(p) + tiers + button('See what\'s new', `${env.STORE_URL}/collections/new-arrivals`) };
    }
    if (d.theme === 'best') {
      const p = await collectionProducts(env, 'best-sellers', 4);
      return { subject: 'What everyone\'s buying right now', preheader: 'This fortnight\'s best sellers.', banner: 'banner-best-sellers.jpg', bannerAlt: 'Best sellers this fortnight',
        body: heading('Most loved right now') + para(intro) + productGrid(p) + tiers + button('Shop best sellers', `${env.STORE_URL}/collections/best-sellers`) };
    }
    if (d.theme === 'blog') {
      const articles = await latestArticles(env, 3);
      const p = await personalPicks(env, email, 2);
      return { subject: 'From the tech desk: new guides worth a read', preheader: 'Buying tips and how-tos from our team.', banner: 'banner-blog.jpg', bannerAlt: 'New guides worth a read',
        body: heading('From the tech desk') + para(`${hi(d.firstName)} a few guides from our team, plus a couple of picks for you.`)
          + articleList(articles) + productGrid(p, { heading: 'Picked for you' }) + button('Read all guides', `${env.STORE_URL}/blogs/news`) };
    }
    const p = await personalPicks(env, email, 4);
    return { subject: 'Picked for you this fortnight', preheader: 'Chosen from what you\'ve looked at and bought.', banner: 'banner-picks-everyone.jpg', bannerAlt: 'Picked for you this fortnight',
      body: heading('Picked for you') + para(intro) + productGrid(p) + tiers + button('Shop your picks', `${env.STORE_URL}/collections/all`) };
  },
};

/* ======================= Outbox ======================= */

/** Sends queued emails, at most DAILY_SEND_LIMIT per 24 hours, after a fresh consent check. */
export async function drainOutbox(env) {
  const budget = Number(env.DAILY_SEND_LIMIT || 95) - (await sentTodayCount(env));
  if (budget <= 0) return { sent: 0, reason: 'daily limit reached' };
  const { results } = await env.DB.prepare(
    `SELECT * FROM sends WHERE status = 'queued' AND created_at <= ? ORDER BY priority ASC, created_at ASC LIMIT ?`).bind(now(), Math.min(budget, 40)).all();
  let sent = 0;
  for (const job of results) {
    const mark = (status, error = null) => env.DB.prepare('UPDATE sends SET status = ?, error = ?, sent_at = ? WHERE id = ?')
      .bind(status, error, now(), job.id).run();
    try {
      const suppressed = await env.DB.prepare('SELECT email FROM suppressions WHERE email = ?').bind(job.email).first();
      if (suppressed) { await mark('skipped', 'unsubscribed'); continue; }
      // One marketing email per person per 20 hours; anything else waits its turn.
      const recent = await env.DB.prepare(`SELECT id FROM sends WHERE email = ? AND status = 'sent' AND sent_at > ? LIMIT 1`)
        .bind(job.email, now() - 20 * HOUR).first();
      if (recent) {
        await env.DB.prepare('UPDATE sends SET created_at = ? WHERE id = ?').bind(now() + 6 * HOUR, job.id).run();
        continue;
      }
      const status = await marketingStatus(env, job.email);
      if (!status.subscribed) { await mark('skipped', 'not subscribed'); continue; }
      const builder = builders[job.flow];
      const email = builder ? await builder(env, job.email, JSON.parse(job.payload || '{}')) : null;
      if (!email) { await mark('skipped', 'nothing to send'); continue; }
      const unsubUrl = await unsubscribeUrl(env, job.email);
      await sendViaResend(env, { to: job.email, subject: email.subject, unsubUrl,
        html: layout(env, { ...email, unsubUrl }) });
      await mark('sent');
      sent++;
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
