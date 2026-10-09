// Email layout, components, sending through Resend, and the outbox that respects the daily send limit.
import { esc, money, now, hmacHex, DAY } from './util.js';

const VIOLET = '#7D03FC';
const INK = '#0B1220';
const MUTED = '#586072';

export async function unsubscribeUrl(env, email) {
  const sig = await hmacHex(env.UNSUB_SECRET, email);
  return `${env.PUBLIC_URL}/u?e=${encodeURIComponent(email)}&s=${sig}`;
}

export function button(label, url, { light = false } = {}) {
  const bg = light ? '#FFFFFF' : VIOLET;
  const fg = light ? INK : '#FFFFFF';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;"><tr><td style="border-radius:999px;background:${bg};">
<a href="${esc(url)}" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:800;color:${fg};text-decoration:none;border-radius:999px;">${esc(label)}</a></td></tr></table>`;
}

export function heading(text) {
  return `<h1 style="margin:0 0 10px;font-size:30px;line-height:1.1;font-weight:900;font-style:italic;letter-spacing:-0.5px;color:${INK};">${esc(text)}</h1>`;
}

export function para(html) {
  return `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:${INK};">${html}</p>`;
}

export function codeBox(code, note) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 6px;"><tr><td align="center" style="padding:18px;border:2px dashed ${VIOLET};border-radius:16px;background:#F4F2FB;">
<p style="margin:0 0 4px;font-family:'Courier New',monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${VIOLET};">Your code</p>
<p style="margin:0;font-family:'Courier New',monospace;font-size:26px;font-weight:700;letter-spacing:2px;color:${INK};">${esc(code)}</p>
${note ? `<p style="margin:6px 0 0;font-size:13px;color:${MUTED};">${esc(note)}</p>` : ''}</td></tr></table>`;
}

/** Product cards, two per row. */
export function productGrid(products, { heading: title } = {}) {
  const items = products.filter(Boolean).slice(0, 6);
  if (!items.length) return '';
  let rows = '';
  for (let i = 0; i < items.length; i += 2) {
    const cell = (p) => p ? `<td width="50%" valign="top" style="padding:6px;">
<a href="${esc(p.url)}" style="text-decoration:none;color:${INK};display:block;border:1px solid #E7E9ED;border-radius:16px;overflow:hidden;">
${p.image ? `<img src="${esc(p.image)}" width="262" alt="${esc(p.title)}" style="display:block;width:100%;height:auto;border:0;background:#F2F3F5;">` : ''}
<span style="display:block;padding:12px 12px 14px;">
<span style="display:block;font-size:14px;font-weight:700;line-height:1.35;">${esc(shortTitle(p.title))}</span>
${p.price != null ? `<span style="display:block;margin-top:6px;font-size:17px;font-weight:900;font-style:italic;">${money(p.price)}</span>` : ''}
<span style="display:inline-block;margin-top:10px;padding:8px 14px;border-radius:999px;background:${VIOLET};color:#fff;font-size:13px;font-weight:800;">Shop now</span>
</span></a></td>` : '<td width="50%"></td>';
    rows += `<tr>${cell(items[i])}${cell(items[i + 1])}</tr>`;
  }
  return `${title ? `<p style="margin:18px 0 6px;font-size:18px;font-weight:800;color:${INK};">${esc(title)}</p>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid">${rows}</table>`;
}

export function articleList(articles) {
  if (!articles.length) return '';
  return articles.map((a) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;"><tr><td style="padding:16px 18px;border-radius:14px;background:#F4F2FB;">
<a href="${esc(a.url)}" style="text-decoration:none;color:${INK};"><span style="display:block;font-size:17px;font-weight:800;line-height:1.3;">${esc(a.title)}</span>
${a.summary ? `<span style="display:block;margin-top:6px;font-size:14px;line-height:1.5;color:${MUTED};">${esc(a.summary)}</span>` : ''}
<span style="display:block;margin-top:8px;font-size:14px;font-weight:800;color:${VIOLET};">Read the guide &rarr;</span></a></td></tr></table>`).join('');
}

function shortTitle(t) {
  const s = String(t || '').split(/[,|(]| – | - /)[0].trim();
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}

const TRUST = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="trust"><tr>
<td width="33%" valign="top" style="padding-right:10px;font-size:13px;line-height:1.45;color:${INK};"><strong style="color:${VIOLET};">&#10003;</strong> <strong>Dispatched in 3-4 business days</strong><br><span style="color:${MUTED};">Tracked delivery</span></td>
<td width="33%" valign="top" style="padding-right:10px;font-size:13px;line-height:1.45;color:${INK};"><strong style="color:${VIOLET};">&#10003;</strong> <strong>Spend $100 save 5%</strong><br><span style="color:${MUTED};">$150 saves 10%, no code</span></td>
<td width="33%" valign="top" style="font-size:13px;line-height:1.45;color:${INK};"><strong style="color:${VIOLET};">&#10003;</strong> <strong>Damaged or wrong?</strong><br><span style="color:${MUTED};">Full refund</span></td>
</tr></table>`;

/** Full email: logo bar, banner image, white body, trust row, footer with unsubscribe. */
export function layout(env, { preheader, banner, bannerAlt, body, unsubUrl, reason }) {
  const bannerImg = banner
    ? `<tr><td style="padding:0;background:#1E0A57;"><img src="${env.PUBLIC_URL}/banners/${banner}" width="600" alt="${esc(bannerAlt || '')}" style="display:block;width:100%;height:auto;border:0;"></td></tr>`
    : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only">
<title>${esc(env.BRAND)}</title>
<style>body{margin:0;padding:0;background:#F2F3F5;}a{color:${VIOLET};}
@media (max-width:620px){.wrap{width:100%!important}.px{padding-left:20px!important;padding-right:20px!important}.grid td{padding:4px!important}.trust td{display:block!important;width:100%!important;padding:5px 0!important}}</style></head>
<body style="margin:0;padding:0;background:#F2F3F5;font-family:'Helvetica Neue',Arial,sans-serif;color:${INK};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F3F5;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">
<tr><td class="px" style="background:${INK};border-radius:20px 20px 0 0;padding:20px 32px;"><a href="${env.STORE_URL}" style="text-decoration:none;font-size:22px;font-weight:900;font-style:italic;color:#FFFFFF;">TECH<span style="color:${VIOLET};">.</span>LUXEDEALERS</a></td></tr>
${bannerImg}
<tr><td class="px" style="background:#FFFFFF;padding:30px 32px 26px;">${body}</td></tr>
<tr><td class="px" style="background:#F4F2FB;padding:20px 32px;">${TRUST}</td></tr>
<tr><td class="px" style="background:${INK};border-radius:0 0 20px 20px;padding:24px 32px;color:#A7AFBF;font-size:13px;line-height:1.6;">
<p style="margin:0 0 10px;">Questions? Reply to this email or write to <a href="mailto:${env.REPLY_TO}" style="color:#C9A5FF;">${env.REPLY_TO}</a>.</p>
<p style="margin:0 0 12px;"><a href="https://www.instagram.com/tech.luxedealers/" style="color:#fff;text-decoration:none;font-weight:700;">Instagram</a> &middot; <a href="https://www.facebook.com/profile.php?id=61595062625090" style="color:#fff;text-decoration:none;font-weight:700;">Facebook</a> &middot; <a href="${env.STORE_URL}" style="color:#fff;text-decoration:none;font-weight:700;">Shop</a></p>
<p style="margin:0;font-size:11.5px;color:#6F7787;">${esc(reason || `You're receiving this because you subscribed to emails from ${env.BRAND}.`)} ${env.BRAND}, Australia &middot; ${env.REPLY_TO}<br>
<a href="${esc(unsubUrl)}" style="color:#A7AFBF;">Unsubscribe</a> at any time.</p>
</td></tr></table></td></tr></table></body></html>`;
}

/* ---------- Sending ---------- */

export async function sendViaResend(env, { to, subject, html, unsubUrl }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [to],
      reply_to: env.REPLY_TO,
      subject,
      html,
      headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/**
 * Queue an email. `dedupe` makes each email send at most once (e.g. "welcome1:sam@x.com").
 * Lower priority numbers go first when the daily limit is tight.
 */
export async function enqueue(env, { email, flow, dedupe, priority = 5, data = {}, sendAfter = 0 }) {
  await env.DB.prepare(`INSERT OR IGNORE INTO sends (email, flow, dedupe, status, created_at, priority, payload)
      VALUES (?, ?, ?, 'queued', ?, ?, ?)`)
    .bind(email, flow, dedupe, Math.max(now(), sendAfter), priority, JSON.stringify(data)).run();
}

export async function sentTodayCount(env) {
  const since = now() - DAY;
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sends WHERE status = 'sent' AND sent_at > ?`).bind(since).first();
  return row ? row.n : 0;
}
