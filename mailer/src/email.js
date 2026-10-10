// Email layout, components, sending through Resend, and the outbox that respects the daily send limit.
import { esc, money, now, hmacHex, DAY } from './util.js';

const VIOLET = '#7D03FC';
const INK = '#0B1220';
const MUTED = '#586072';

export async function unsubscribeUrl(env, email) {
  const sig = await hmacHex(env.UNSUB_SECRET, email);
  return `${env.PUBLIC_URL}/u?e=${encodeURIComponent(email)}&s=${sig}`;
}

export function button(label, url, { light = false, center = false } = {}) {
  const bg = light ? '#FFFFFF' : VIOLET;
  const fg = light ? INK : '#FFFFFF';
  return `<table role="presentation" cellpadding="0" cellspacing="0" ${center ? 'align="center" ' : ''}style="margin:24px ${center ? 'auto' : '0'} 4px;"><tr><td style="border-radius:999px;background:${bg};box-shadow:0 6px 18px rgba(125,3,252,0.28);">
<a href="${esc(url)}" style="display:inline-block;padding:16px 34px;font-size:16px;font-weight:800;color:${fg};text-decoration:none;border-radius:999px;">${esc(label)} &rarr;</a></td></tr></table>`;
}

export function heading(text) {
  return `<h1 class="h1" style="margin:0 0 12px;font-size:32px;line-height:1.1;font-weight:900;font-style:italic;letter-spacing:-0.5px;color:${INK};">${esc(text)}</h1>`;
}

export function para(html) {
  return `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:${INK};">${html}</p>`;
}

/** Plain code box, kept for the weekly report and anything without its own offer card. */
export function codeBox(code, note) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 6px;"><tr><td align="center" style="padding:18px;border:2px dashed ${VIOLET};border-radius:16px;background:#F4F2FB;">
<p style="margin:0;font-family:'Courier New',monospace;font-size:26px;font-weight:700;letter-spacing:2px;color:${INK};">${esc(code)}</p>
${note ? `<p style="margin:6px 0 0;font-size:13px;color:${MUTED};">${esc(note)}</p>` : ''}</td></tr></table>`;
}

// Each kind of offer has its own look, so a welcome gift never looks like a VIP perk or a win-back.
const OFFER_THEMES = {
  welcome: { bg: '#7D03FC', grad: 'linear-gradient(135deg,#8B1CFF 0%,#5A00D6 100%)', accent: '#FFFFFF', text: '#FFFFFF', soft: '#E9DBFF', icon: 'gift' },
  reminder: { bg: '#0B1220', grad: 'linear-gradient(135deg,#1B1446 0%,#0B1220 100%)', accent: '#C9A5FF', text: '#FFFFFF', soft: '#B9B3D6', icon: 'gift' },
  personal: { bg: '#C2187A', grad: 'linear-gradient(135deg,#E0338F 0%,#8E0F7A 100%)', accent: '#FFFFFF', text: '#FFFFFF', soft: '#FFD6EC', icon: 'tag' },
  vip: { bg: '#0B1220', grad: 'linear-gradient(135deg,#231A05 0%,#0B1220 70%)', accent: '#F5C451', text: '#FFFFFF', soft: '#D9CFA8', icon: 'crown' },
  winback: { bg: '#1D4ED8', grad: 'linear-gradient(135deg,#3B6CF6 0%,#4A12C9 100%)', accent: '#FFFFFF', text: '#FFFFFF', soft: '#DCE6FF', icon: 'heart' },
  tiers: { bg: '#0F766E', grad: 'linear-gradient(135deg,#14A39A 0%,#0B5E73 100%)', accent: '#FFFFFF', text: '#FFFFFF', soft: '#CFF5F1', icon: 'sparkles' },
};

/**
 * The offer for this email: big number on the left, what it is, the code and its conditions on the right.
 * `fine` must state every real condition (first order only, expiry, single use, doesn't combine).
 */
export function offerCard(env, { theme, big, unit, title, code, fine }) {
  const t = OFFER_THEMES[theme];
  const codeHtml = code ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px 0 0;"><tr><td style="padding:10px 16px;border:2px dashed ${t.accent};border-radius:12px;background:rgba(255,255,255,0.08);">
<span style="font-family:'Courier New',monospace;font-size:22px;font-weight:700;letter-spacing:2px;color:${t.text};">${esc(code)}</span></td></tr></table>` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 8px;border-radius:20px;background:${t.bg};background-image:${t.grad};"><tr>
<td class="stack offer-big" width="150" valign="middle" align="center" style="padding:26px 10px 26px 22px;">
<img src="${env.PUBLIC_URL}/icons/offer-${t.icon}.png" width="48" height="48" alt="" style="display:block;margin:0 auto 8px;border:0;">
<span style="display:block;font-size:52px;line-height:1;font-weight:900;font-style:italic;letter-spacing:-2px;color:${t.accent};">${esc(big)}</span>
<span style="display:block;margin-top:4px;font-size:12px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:${t.accent};">${esc(unit)}</span></td>
<td class="stack offer-copy" valign="middle" style="padding:26px 26px 26px 12px;">
<span style="display:block;font-size:20px;line-height:1.25;font-weight:900;color:${t.text};">${esc(title)}</span>
${codeHtml}
<span style="display:block;margin-top:12px;font-size:13px;line-height:1.5;color:${t.soft};">${esc(fine)}</span></td></tr></table>`;
}

/** Spend-and-save tiers (Shopify automatic discounts), shown only in the fortnightly email. */
export function tierCard(env) {
  const t = OFFER_THEMES.tiers;
  const cell = (spend, save) => `<td class="stack" width="50%" valign="top" style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px 10px;border-radius:14px;background:rgba(255,255,255,0.12);">
<span style="display:block;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${t.soft};">Spend ${spend}+</span>
<span style="display:block;margin-top:4px;font-size:30px;font-weight:900;font-style:italic;color:#FFFFFF;">Save ${save}</span></td></tr></table></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 8px;border-radius:20px;background:${t.bg};background-image:${t.grad};"><tr><td style="padding:22px 18px 18px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="56" valign="middle" style="padding:0 6px;"><img src="${env.PUBLIC_URL}/icons/offer-sparkles.png" width="44" height="44" alt="" style="display:block;border:0;"></td>
<td valign="middle" style="padding:0 6px;font-size:19px;font-weight:900;color:#FFFFFF;">Spend more, save more<span style="display:block;font-size:13px;font-weight:400;color:${t.soft};">Taken off automatically at checkout. No code needed.</span></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;"><tr>${cell('$100', '5%')}${cell('$150', '10%')}</tr></table></td></tr></table>`;
}

/** For checkout reminders: how close their order is to the automatic spend-and-save discounts. */
export function tierNudge(env, subtotalCents) {
  if (subtotalCents == null || Number.isNaN(subtotalCents)) return '';
  let msg;
  if (subtotalCents >= 15000) msg = `<strong>Good news:</strong> orders of ${money(15000)}+ get 10% off automatically at checkout.`;
  else if (subtotalCents >= 10000) msg = `<strong>You're getting 5% off</strong> automatically. Add ${money(15000 - subtotalCents)} more to make it 10%.`;
  else msg = `<strong>Add ${money(10000 - subtotalCents)} more</strong> and 5% comes off automatically (orders of $100+).`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 6px;"><tr><td style="padding:14px 16px;border-radius:14px;background:#ECFDF8;border:1px solid #BCEBDD;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="38" valign="middle"><span style="display:inline-block;width:28px;height:28px;line-height:28px;border-radius:50%;background:#0F766E;color:#fff;text-align:center;font-weight:900;">%</span></td>
<td valign="middle" style="font-size:14px;line-height:1.5;color:#0B3B36;">${msg}</td></tr></table></td></tr></table>`;
}

/** Product cards, two per row. */
export function productGrid(products, { heading: title } = {}) {
  const items = products.filter(Boolean).slice(0, 6);
  if (!items.length) return '';
  let rows = '';
  for (let i = 0; i < items.length; i += 2) {
    const cell = (p) => p ? `<td class="pcell" width="50%" valign="top" style="padding:7px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E7E9ED;border-radius:18px;background:#FFFFFF;"><tr><td style="padding:0;">
<a href="${esc(p.url)}" style="text-decoration:none;color:${INK};display:block;">
${p.image ? `<img src="${esc(p.image)}" width="254" alt="${esc(shortTitle(p.title))}" style="display:block;width:100%;height:auto;border:0;border-radius:17px 17px 0 0;background:#F2F3F5;">` : ''}</a></td></tr>
<tr><td class="pbody" style="padding:14px 14px 16px;">
<a href="${esc(p.url)}" style="text-decoration:none;color:${INK};"><span class="ptitle" style="display:block;min-height:38px;font-size:14px;font-weight:700;line-height:1.35;">${esc(shortTitle(p.title))}</span></a>
${p.price != null ? `<span style="display:block;margin-top:6px;font-size:18px;font-weight:900;font-style:italic;color:${INK};">${money(p.price)}</span>` : ''}
<a href="${esc(p.url)}" style="display:inline-block;margin-top:10px;padding:9px 16px;border-radius:999px;background:${VIOLET};color:#FFFFFF;font-size:13px;font-weight:800;text-decoration:none;">Shop now</a>
</td></tr></table></td>` : '<td class="pcell" width="50%"></td>';
    rows += `<tr>${cell(items[i])}${cell(items[i + 1])}</tr>`;
  }
  return `${title ? `<p style="margin:26px 0 6px;font-size:19px;font-weight:900;font-style:italic;color:${INK};">${esc(title)}</p>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid">${rows}</table>`;
}

export function articleList(articles) {
  if (!articles.length) return '';
  return articles.map((a) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;"><tr><td style="padding:18px 20px;border-radius:16px;background:#F4F2FB;border-left:4px solid ${VIOLET};">
<a href="${esc(a.url)}" style="text-decoration:none;color:${INK};"><span style="display:block;font-size:17px;font-weight:800;line-height:1.3;">${esc(a.title)}</span>
${a.summary ? `<span style="display:block;margin-top:6px;font-size:14px;line-height:1.5;color:${MUTED};">${esc(a.summary)}</span>` : ''}
<span style="display:block;margin-top:8px;font-size:14px;font-weight:800;color:${VIOLET};">Read the guide &rarr;</span></a></td></tr></table>`).join('');
}

function shortTitle(t) {
  const s = String(t || '').split(/[,|(]| – | - /)[0].trim();
  return s.length > 52 ? s.slice(0, 49) + '…' : s;
}

/** Store promises (no discounts here: each email has its own offer). Wraps to 2x2 on phones without media queries. */
function trustRow(env) {
  const item = (icon, title, sub) => `<div class="trust-item" style="display:inline-block;width:100%;max-width:134px;vertical-align:top;text-align:center;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 6px;">
<img src="${env.PUBLIC_URL}/icons/trust-${icon}.png" width="44" height="44" alt="" style="display:block;margin:0 auto 8px;border:0;">
<span style="display:block;font-size:13px;font-weight:800;line-height:1.3;color:${INK};">${title}</span>
<span style="display:block;margin-top:2px;font-size:12px;line-height:1.4;color:${MUTED};">${sub}</span></td></tr></table></div>`;
  return `<div style="font-size:0;text-align:center;">${item('truck', 'Tracked delivery', 'Dispatched in 3-4 business days')}${item('shield', 'Secure checkout', 'Pay safely with Shopify')}${item('refund', 'Damaged or wrong?', 'Full refund')}${item('chat', 'Real people', 'Just reply to this email')}</div>`;
}

/** Full email: header, banner, body, store promises, footer with social icons and unsubscribe. */
export function layout(env, { preheader, banner, bannerAlt, body, unsubUrl, reason, plain }) {
  const bannerImg = banner
    ? `<tr><td style="padding:0;background:${VIOLET};"><img src="${env.PUBLIC_URL}/banners/${banner}" width="600" height="300" alt="${esc(bannerAlt || '')}" style="display:block;width:100%;max-width:600px;height:auto;border:0;background:${VIOLET};color:#FFFFFF;font-size:22px;font-weight:800;line-height:1.3;text-align:center;"></td></tr>`
    : '';
  const social = (icon, href, label) => `<a href="${href}" style="display:inline-block;margin:0 5px;text-decoration:none;"><img src="${env.PUBLIC_URL}/icons/social-${icon}.png" width="36" height="36" alt="${label}" style="display:block;border:0;color:#FFFFFF;font-size:12px;"></a>`;
  return `<!DOCTYPE html><html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>${esc(env.BRAND)}</title>
<style>body{margin:0;padding:0;background:#ECEEF3;-webkit-text-size-adjust:100%;}a{color:${VIOLET};}img{-ms-interpolation-mode:bicubic;}
@media (max-width:620px){
.wrap{width:100%!important}.outer{padding:0!important}.card{border-radius:0!important}
.px{padding-left:20px!important;padding-right:20px!important}.h1{font-size:28px!important}
.stack{display:block!important;width:100%!important;box-sizing:border-box}
.offer-big{padding:24px 20px 4px!important}.offer-copy{padding:8px 22px 24px!important;text-align:center!important}.offer-copy table{margin-left:auto!important;margin-right:auto!important}
.pcell{padding:5px!important}.pbody{padding:12px 10px 14px!important}.ptitle{font-size:13px!important}
}</style></head>
<body style="margin:0;padding:0;background:#ECEEF3;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:${INK};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader || '')}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ECEEF3;"><tr><td class="outer" align="center" style="padding:24px 12px;">
<table role="presentation" class="wrap card" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;border-radius:22px;overflow:hidden;background:#FFFFFF;">
<tr><td class="px" style="background:${INK};padding:20px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="middle"><a href="${env.STORE_URL}" style="text-decoration:none;font-size:22px;font-weight:900;font-style:italic;letter-spacing:-0.3px;color:#FFFFFF;">TECH<span style="color:#9B4DFF;">.</span>LUXEDEALERS</a></td>
<td align="right" valign="middle"><a href="${env.STORE_URL}/collections/all" style="font-size:13px;font-weight:800;color:#C9A5FF;text-decoration:none;">Shop &rarr;</a></td></tr></table></td></tr>
${bannerImg}
<tr><td class="px" style="background:#FFFFFF;padding:32px 32px 30px;">${body}</td></tr>
${plain ? '' : `<tr><td class="px" style="background:#F6F3FD;padding:22px 26px;">${trustRow(env)}</td></tr>`}
<tr><td class="px" align="center" style="background:${INK};padding:28px 32px;color:#A7AFBF;font-size:13px;line-height:1.6;text-align:center;">
<p style="margin:0 0 14px;">${social('instagram', 'https://www.instagram.com/tech.luxedealers/', 'Instagram')}${social('facebook', 'https://www.facebook.com/profile.php?id=61595062625090', 'Facebook')}${social('bag', env.STORE_URL, 'Shop')}</p>
<p style="margin:0 0 10px;">Questions? Reply to this email or write to <a href="mailto:${env.REPLY_TO}" style="color:#C9A5FF;">${env.REPLY_TO}</a>.</p>
<p style="margin:0;font-size:11.5px;color:#7A8294;">${esc(reason || `You're receiving this because you subscribed to emails from ${env.BRAND}.`)}<br>${env.BRAND}, Australia &middot;
<a href="${esc(unsubUrl)}" style="color:#A7AFBF;">Unsubscribe</a></p>
</td></tr></table></td></tr></table></body></html>`;
}

/* ---------- Sending ---------- */

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/**
 * Many mail apps block remote images for new senders, so every image is embedded in the email itself
 * (inline attachments referenced as cid:). An image that can't be fetched stays a normal link.
 */
export async function embedImages(env, html, maxBytes = 3_000_000) {
  const urls = [...new Set([...html.matchAll(/<img[^>]+src="(https?:\/\/[^"]+)"/g)].map((m) => m[1]))];
  const attachments = [];
  let total = 0;
  for (const [i, raw] of urls.entries()) {
    const url = raw.replace(/&amp;/g, '&');
    try {
      const req = new Request(url, { headers: { Accept: 'image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.5' } });
      const res = url.startsWith(env.PUBLIC_URL + '/') && env.ASSETS ? await env.ASSETS.fetch(req) : await fetch(req);
      const type = (res.headers.get('Content-Type') || '').split(';')[0].trim();
      if (!res.ok || !EXT[type]) continue;
      const buf = await res.arrayBuffer();
      if (total + buf.byteLength > maxBytes) continue;
      total += buf.byteLength;
      const cid = `img${i}@luxemail`;
      attachments.push({ filename: `image-${i}.${EXT[type]}`, content: toBase64(buf), content_id: cid, content_type: type });
      html = html.split(`src="${raw}"`).join(`src="cid:${cid}"`);
    } catch (e) {
      console.error('embed image', url, e);
    }
  }
  return { html, attachments };
}

export async function sendViaResend(env, { to, subject, html: rawHtml, unsubUrl }) {
  const { html, attachments } = await embedImages(env, rawHtml);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [to],
      reply_to: env.REPLY_TO,
      subject,
      html,
      ...(attachments.length ? { attachments } : {}),
      headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/**
 * Queue an email. `dedupe` makes each email send at most once (e.g. "welcome1:sam@x.com").
 * Lower priority numbers go first when the daily limit is tight. Returns the new job's id (null if it was a duplicate).
 */
export async function enqueue(env, { email, flow, dedupe, priority = 5, data = {}, sendAfter = 0 }) {
  const res = await env.DB.prepare(`INSERT OR IGNORE INTO sends (email, flow, dedupe, status, created_at, priority, payload)
      VALUES (?, ?, ?, 'queued', ?, ?, ?)`)
    .bind(email, flow, dedupe, Math.max(now(), sendAfter), priority, JSON.stringify(data)).run();
  return res.meta && res.meta.changes ? res.meta.last_row_id : null;
}

export async function sentTodayCount(env) {
  const since = now() - DAY;
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sends WHERE status = 'sent' AND sent_at > ?`).bind(since).first();
  return row ? row.n : 0;
}
