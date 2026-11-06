// Email layout, components, sending through Resend, and the outbox that respects the daily send limit.
import { esc, money, now, hmacHex, DAY, sendingReady } from './util.js';

const GOLD = '#F4C430';
const GOLD_TEXT = '#1E4FA8';
const VIOLET = GOLD_TEXT;
const INK = '#0B1220';
const BRAND = '#1E4FA8'; // luxury blue: header and footer
const MUTED = '#5B6474';

/**
 * Colour schemes. Every email has its own, so a welcome never looks like a checkout reminder or a VIP note.
 * Components write placeholder tokens (%%A%% etc.) and layout() swaps in the email's scheme.
 * a: buttons and accents, ai: text on a, at: accent text on white, soft: panels, line: card borders,
 * page: background around the email, deep/deep2: offer card gradient, glow: big numbers on the offer card.
 */
export const TONES = {
  // Bright gradients that sit well with the white header and luxury blue footer. deep -> deep2 is the banner/offer
  // gradient; fg/fgs are the text colours on it; glow is the big number on the offer card.
  gold:      { a: '#F4C430', ai: '#14213D', at: '#1E4FA8', soft: '#FFF7DB', line: '#F3E2A6', page: '#F4F6FA', deep: '#F2B91E', deep2: '#FFE27A', glow: '#14213D', fg: '#14213D', fgs: 'rgba(20,33,61,0.75)' },
  rose:      { a: '#D63E77', ai: '#FFFFFF', at: '#C0306A', soft: '#FDEEF4', line: '#F7D3E1', page: '#F4F6FA', deep: '#D63E77', deep2: '#FF8FB4', glow: '#FFFFFF', fg: '#FFFFFF', fgs: 'rgba(255,255,255,0.85)' },
  emerald:   { a: '#0E8A63', ai: '#FFFFFF', at: '#0E8A63', soft: '#E9F7F1', line: '#CBEBDD', page: '#F4F6FA', deep: '#0E8A63', deep2: '#3CC799', glow: '#FFFFFF', fg: '#FFFFFF', fgs: 'rgba(255,255,255,0.85)' },
  sapphire:  { a: '#1E4FA8', ai: '#FFFFFF', at: '#1E4FA8', soft: '#EEF3FC', line: '#D6E0F2', page: '#F4F6FA', deep: '#1E4FA8', deep2: '#5B8DE0', glow: '#FFD966', fg: '#FFFFFF', fgs: 'rgba(255,255,255,0.85)' },
  burgundy:  { a: '#C0263F', ai: '#FFFFFF', at: '#C0263F', soft: '#FDEDEF', line: '#F6D2D8', page: '#F4F6FA', deep: '#C0263F', deep2: '#FF6B7A', glow: '#FFFFFF', fg: '#FFFFFF', fgs: 'rgba(255,255,255,0.85)' },
  onyx:      { a: '#14306E', ai: '#FFD966', at: '#14306E', soft: '#EEF2FA', line: '#D3DCEE', page: '#F4F6FA', deep: '#14306E', deep2: '#2B63C9', glow: '#FFD966', fg: '#FFFFFF', fgs: 'rgba(255,255,255,0.82)' },
  champagne: { a: '#2F80ED', ai: '#FFFFFF', at: '#1F6AD1', soft: '#EDF5FF', line: '#CFE2FB', page: '#F4F6FA', deep: '#2F80ED', deep2: '#8EC5FF', glow: '#FFFFFF', fg: '#FFFFFF', fgs: 'rgba(255,255,255,0.88)' },
  plum:      { a: '#6A3FD8', ai: '#FFFFFF', at: '#5B33C4', soft: '#F2EEFD', line: '#DED4FA', page: '#F4F6FA', deep: '#6A3FD8', deep2: '#A98BFF', glow: '#FFFFFF', fg: '#FFFFFF', fgs: 'rgba(255,255,255,0.85)' },
};
const FLOW_TONES = {
  welcome1: 'gold', welcome2: 'rose', welcome3: 'burgundy', checkout1: 'onyx', checkout2: 'sapphire', cart1: 'emerald', cart2: 'plum',
  browse: 'champagne', wishlist: 'rose', postpurchase: 'emerald', nextreminder: 'sapphire', vip: 'onyx', winback: 'plum',
  'fortnight:new': 'gold', 'fortnight:picks': 'champagne', 'fortnight:best': 'burgundy', 'fortnight:deals': 'gold', journal: 'sapphire',
};
export function toneFor(flow, theme) {
  return FLOW_TONES[theme ? `${flow}:${theme}` : flow] || FLOW_TONES[flow] || 'gold';
}

export async function unsubscribeUrl(env, email) {
  const sig = await hmacHex(env.UNSUB_SECRET, email);
  return `${env.PUBLIC_URL}/u?e=${encodeURIComponent(email)}&s=${sig}`;
}

export function button(label, url, { light = false, center = false } = {}) {
  const bg = light ? '#FFFFFF' : '%%A%%';
  const fg = light ? INK : '%%AI%%';
  return `<table role="presentation" cellpadding="0" cellspacing="0" ${center ? 'align="center" ' : ''}style="margin:24px ${center ? 'auto' : '0'} 4px;"><tr><td style="border-radius:12px;background:${bg};box-shadow:0 6px 18px rgba(0,0,0,0.18);">
<a href="${esc(url)}" style="display:inline-block;padding:16px 34px;font-size:16px;font-weight:700;color:${fg};text-decoration:none;border-radius:12px;">${esc(label)} &rarr;</a></td></tr></table>`;
}

export function heading(text) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;"><tr><td style="width:44px;height:4px;border-radius:4px;background:%%A%%;font-size:0;line-height:0;">&nbsp;</td></tr></table><h1 class="h1" style="margin:0 0 12px;font-size:30px;line-height:1.12;font-weight:800;letter-spacing:-0.6px;color:${INK};">${esc(text)}</h1>`;
}

export function para(html) {
  return `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:${INK};">${html}</p>`;
}

/** Plain code box, kept for the weekly report and anything without its own offer card. */
export function codeBox(code, note) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 6px;"><tr><td align="center" style="padding:18px;border:2px dashed ${GOLD};border-radius:16px;background:#F3F6FA;">
<p style="margin:0;font-family:'Courier New',monospace;font-size:26px;font-weight:700;letter-spacing:2px;color:${INK};">${esc(code)}</p>
${note ? `<p style="margin:6px 0 0;font-size:13px;color:${MUTED};">${esc(note)}</p>` : ''}</td></tr></table>`;
}

// Each kind of offer has its own look, so a welcome gift never looks like a VIP perk or a win-back.
const OFFER_THEMES = {
  welcome: { bg: '#C9A23F', grad: 'linear-gradient(135deg,#F6DE97 0%,#D4AF37 45%,#9C7A22 100%)', accent: '#111111', text: '#111111', soft: '#3E2E0A', icon: 'gift' },
  reminder: { bg: '#0D0B07', grad: 'linear-gradient(135deg,#3A2B12 0%,#0D0B07 100%)', accent: '#E6C463', text: '#FFFFFF', soft: '#D9CFB4', icon: 'gift' },
  personal: { bg: '#1A140A', grad: 'linear-gradient(135deg,#5A3F17 0%,#1A140A 100%)', accent: '#F1D27A', text: '#FFFFFF', soft: '#E6D9B8', icon: 'tag' },
  vip: { bg: '#0D0B07', grad: 'linear-gradient(135deg,#231A05 0%,#0D0B07 70%)', accent: '#F5C451', text: '#FFFFFF', soft: '#D9CFA8', icon: 'crown' },
  winback: { bg: '#2A1D0C', grad: 'linear-gradient(135deg,#6B4C1B 0%,#1A1209 100%)', accent: '#F1D27A', text: '#FFFFFF', soft: '#E6D9B8', icon: 'heart' },
  lastcall: { bg: '#7A2E12', grad: 'linear-gradient(135deg,#B8892E 0%,#6E1F14 100%)', accent: '#FFF3D6', text: '#FFFFFF', soft: '#FBE3C9', icon: 'sparkles' },
  thanks: { bg: '#0D0B07', grad: 'linear-gradient(135deg,#3A2B12 0%,#0D0B07 100%)', accent: '#E6C463', text: '#FFFFFF', soft: '#D9CFB4', icon: 'gift' },
  insider: { bg: '#1A140A', grad: 'linear-gradient(135deg,#4A3614 0%,#0D0B07 100%)', accent: '#F1D27A', text: '#FFFFFF', soft: '#E6D9B8', icon: 'tag' },
  tiers: { bg: '#0F3479', grad: 'linear-gradient(135deg,#2E66C6 0%,#0F3479 100%)', accent: '#FFD966', text: '#FFFFFF', soft: '#DCE6F7', icon: 'sparkles' },
};

/**
 * The offer for this email: big number on the left, what it is, the code and its conditions on the right.
 * `fine` must state every real condition (first order only, expiry, single use, doesn't combine).
 */
export function offerCard(env, { theme, big, unit, title, code, fine }) {
  const t = { ...OFFER_THEMES[theme], bg: '%%DEEP%%', grad: 'radial-gradient(circle at 90% 0%,rgba(255,255,255,0.35) 0%,rgba(255,255,255,0) 55%),linear-gradient(135deg,%%DEEP%% 0%,%%DEEP2%% 100%)', accent: '%%GLOW%%', text: '%%FG%%', soft: '%%FGS%%' };
  const codeHtml = code ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px 0 0;"><tr><td style="padding:10px 16px;border:2px dashed ${t.accent};border-radius:12px;background:rgba(255,255,255,0.18);">
<span style="font-family:'Courier New',monospace;font-size:22px;font-weight:700;letter-spacing:2px;color:${t.text};">${esc(code)}</span></td></tr></table>` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 8px;border-radius:20px;background:${t.bg};background-image:${t.grad};"><tr>
<td class="stack offer-big" width="150" valign="middle" align="center" style="padding:26px 10px 26px 22px;">
<img src="${env.PUBLIC_URL}/icons/offer-${t.icon}.png" width="48" height="48" alt="" style="display:block;margin:0 auto 8px;border:0;">
<span style="display:block;font-size:52px;line-height:1;font-weight:800;letter-spacing:-2px;color:${t.accent};">${esc(big)}</span>
<span style="display:block;margin-top:4px;font-size:12px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:${t.accent};">${esc(unit)}</span></td>
<td class="stack offer-copy" valign="middle" style="padding:26px 26px 26px 12px;">
<span style="display:block;font-size:20px;line-height:1.25;font-weight:900;color:${t.text};">${esc(title)}</span>
${codeHtml}
<span style="display:block;margin-top:12px;font-size:13px;line-height:1.5;color:${t.soft};">${esc(fine)}</span></td></tr></table>`;
}

/** Spend-and-save tiers (Shopify automatic discounts), shown only in the fortnightly email. */
function tiers(env) {
  const s1 = Number(env.TIER1_SPEND_CENTS || 0), s2 = Number(env.TIER2_SPEND_CENTS || 0);
  return { s1, s2, p1: Number(env.TIER1_PERCENT || 5), p2: Number(env.TIER2_PERCENT || 10) };
}
export function tierCard(env) {
  const tr = tiers(env);
  if (!tr.s1) return '';
  const t = OFFER_THEMES.tiers;
  const cell = (spend, save) => `<td class="stack" width="50%" valign="top" style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px 10px;border-radius:14px;background:rgba(255,255,255,0.12);">
<span style="display:block;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${t.soft};">Spend ${spend}+</span>
<span style="display:block;margin-top:4px;font-size:30px;font-weight:800;color:#FFD966;">Save ${save}</span></td></tr></table></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 8px;border-radius:20px;background:${t.bg};background-image:${t.grad};"><tr><td style="padding:22px 18px 18px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="56" valign="middle" style="padding:0 6px;"><img src="${env.PUBLIC_URL}/icons/offer-sparkles.png" width="44" height="44" alt="" style="display:block;border:0;"></td>
<td valign="middle" style="padding:0 6px;font-size:19px;font-weight:900;color:#FFFFFF;">Spend more, save more<span style="display:block;font-size:13px;font-weight:400;color:${t.soft};">Taken off automatically at checkout. No code needed.</span></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;"><tr>${cell(money(tr.s1), tr.p1 + '%')}${tr.s2 > tr.s1 ? cell(money(tr.s2), tr.p2 + '%') : ''}</tr></table></td></tr></table>`;
}

/** For checkout reminders: how close their order is to the automatic spend-and-save discounts. */
export function tierNudge(env, subtotalCents) {
  const tr = tiers(env);
  if (!tr.s1 || subtotalCents == null || Number.isNaN(subtotalCents)) return '';
  const top = tr.s2 > tr.s1 ? tr.s2 : tr.s1, topP = tr.s2 > tr.s1 ? tr.p2 : tr.p1;
  let msg;
  if (subtotalCents >= top) msg = `<strong>Good news:</strong> orders of ${money(top)}+ get ${topP}% off automatically at checkout.`;
  else if (subtotalCents >= tr.s1) msg = `<strong>You're getting ${tr.p1}% off</strong> automatically. Add ${money(top - subtotalCents)} more to make it ${topP}%.`;
  else msg = `<strong>Add ${money(tr.s1 - subtotalCents)} more</strong> and ${tr.p1}% comes off automatically (orders of ${money(tr.s1)}+).`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 6px;"><tr><td style="padding:14px 16px;border-radius:14px;background:#EEF3FC;border:1px solid #D6E0F2;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="38" valign="middle"><span style="display:inline-block;width:28px;height:28px;line-height:28px;border-radius:50%;background:#1E4FA8;color:#FFD966;text-align:center;font-weight:900;">%</span></td>
<td valign="middle" style="font-size:14px;line-height:1.5;color:#14213D;">${msg}</td></tr></table></td></tr></table>`;
}

/**
 * Product cards, two per row. Each table cell is the card itself (border-spacing makes the gaps), so both
 * cards in a row are always the same height, and titles get a fixed two-line box so prices line up.
 */
export function productGrid(products, { heading: title } = {}) {
  const items = products.filter(Boolean).slice(0, 6);
  if (!items.length) return '';
  const cell = (p) => p ? `<td class="pcard" width="50%" valign="top" style="width:50%;padding:0;border:1px solid %%LINE%%;border-radius:18px;background:#FFFFFF;overflow:hidden;">
<a href="${esc(p.url)}" style="text-decoration:none;color:${INK};display:block;">
${p.image ? `<img src="${esc(p.image)}" width="254" alt="${esc(shortTitle(p.title))}" style="display:block;width:100%;height:auto;border:0;border-radius:17px 17px 0 0;background:#F4F2EE;">` : ''}</a>
<div class="pbody" style="padding:14px 14px 16px;">
<a href="${esc(p.url)}" style="text-decoration:none;color:${INK};"><span class="ptitle" style="display:block;height:38px;overflow:hidden;font-size:13px;font-weight:700;line-height:19px;text-transform:uppercase;">${esc(shortTitle(p.title))}</span></a>
<span style="display:block;margin-top:8px;font-size:18px;line-height:22px;font-weight:800;color:${INK};">${p.price != null ? money(p.price) : '&nbsp;'}${p.compareAt ? ` <s style="font-size:13px;font-weight:500;color:${MUTED};">${money(p.compareAt)}</s>` : ''}</span>
${p.compareAt ? `<span style="display:inline-block;margin-top:6px;padding:3px 9px;border-radius:999px;background:#F4C430;color:#14213D;font-size:11px;font-weight:800;letter-spacing:.3px;">SAVE ${Math.floor((p.compareAt - p.price) * 100 / p.compareAt)}%</span>` : ''}
<a href="${esc(p.url)}" style="display:inline-block;margin-top:10px;padding:9px 16px;border-radius:10px;background:%%A%%;color:%%AI%%;font-size:13px;font-weight:700;text-decoration:none;">Shop now</a>
</div></td>` : '<td class="pcard pcard--empty" width="50%" style="width:50%;padding:0;"></td>';
  let rows = '';
  if (items.length === 1) rows = `<tr>${cell(items[0])}</tr>`;
  else for (let i = 0; i < items.length; i += 2) rows += `<tr>${cell(items[i])}${cell(items[i + 1])}</tr>`;
  const one = items.length === 1;
  return `${title ? `<p style="margin:26px 0 2px;font-size:19px;font-weight:800;color:${INK};">${esc(title)}</p>` : ''}
<table role="presentation" ${one ? 'align="center" width="300"' : 'width="100%"'} cellpadding="0" cellspacing="0" class="grid" style="${one ? 'width:300px;max-width:100%;margin:0 auto;' : 'width:100%;'}border-collapse:separate;border-spacing:0 12px;table-layout:fixed;">${rows.replace(/<\/td><td class="pcard/g, '</td><td class="gap" width="12" style="width:12px;padding:0;font-size:0;line-height:0;">&nbsp;</td><td class="pcard')}</table>`;
}

export function articleList(articles) {
  if (!articles.length) return '';
  return articles.map((a) => `${a.image ? `<a href="${esc(a.url)}" style="display:block;margin:0 0 -6px;"><img src="${esc(a.image)}" width="548" alt="" style="display:block;width:100%;max-width:548px;height:auto;border-radius:16px 16px 0 0;border:0;"></a>` : ''}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr><td style="padding:18px 20px;border-radius:${a.image ? '0 0 16px 16px' : '16px'};background:%%SOFT%%;border-left:4px solid %%A%%;">
<a href="${esc(a.url)}" style="text-decoration:none;color:${INK};"><span style="display:block;font-size:17px;font-weight:800;line-height:1.3;">${esc(a.title)}</span>
${a.summary ? `<span style="display:block;margin-top:6px;font-size:14px;line-height:1.5;color:${MUTED};">${esc(a.summary)}</span>` : ''}
<span style="display:block;margin-top:8px;font-size:14px;font-weight:800;color:%%AT%%;">Read the story &rarr;</span></a></td></tr></table>`).join('');
}

function shortTitle(t) {
  const s = String(t || '').split(/[,|(]| – | - /)[0].trim();
  return s.length > 46 ? s.slice(0, 43).trim() + '…' : s;
}

/** Store promises (no discounts here: each email has its own offer). Wraps to 2x2 on phones without media queries. */
function trustRow(env) {
  const item = (icon, title, sub) => `<div class="trust-item" style="display:inline-block;width:100%;max-width:134px;vertical-align:top;text-align:center;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 6px;">
<img src="${env.PUBLIC_URL}/icons/trust-${icon}.png" width="44" height="44" alt="" style="display:block;margin:0 auto 8px;border:0;">
<span style="display:block;font-size:13px;font-weight:800;line-height:1.3;color:${INK};">${title}</span>
<span style="display:block;margin-top:2px;font-size:12px;line-height:1.4;color:${MUTED};">${sub}</span></td></tr></table></div>`;
  return `<div style="font-size:0;text-align:center;">${item('truck', 'Free shipping', 'Over US$50, tracked')}${item('shield', 'Secure checkout', 'PayPal, Shop Pay, cards')}${item('refund', 'Refund or reship', 'If something\'s not right')}${item('chat', 'Real people', 'Just reply to this email')}</div>`;
}

/** Full email: header, banner, body, store promises, footer with social icons and unsubscribe. */
/**
 * Letter style for non-promotional emails (the journal): text-first like a personal email, no banner, images,
 * prices or styled footer, so Gmail is more likely to file it under Primary rather than Promotions.
 */
function letterLayout(env, { preheader, body, unsubUrl, reason }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(env.BRAND)}</title></head>
<body style="margin:0;padding:0;background:#FFFFFF;font-family:Arial,Helvetica,sans-serif;color:${INK};">
<div style="display:none;max-height:0;overflow:hidden;">${esc(preheader || '')}</div>
<div style="max-width:560px;margin:0 auto;padding:24px 20px;font-size:16px;line-height:1.6;">
<a href="${env.STORE_URL}" style="display:block;margin:0 0 20px;text-decoration:none;border-bottom:1px solid #E3E8EF;"><img src="${env.PUBLIC_URL}/brand/header.png" width="300" height="50" alt="${esc(env.BRAND)}" style="display:block;width:300px;max-width:100%;height:auto;margin:0 auto;border:0;color:#7D03FC;font-size:20px;font-weight:900;font-style:italic;"></a>${body}
<p style="margin:32px 0 0;font-size:12px;line-height:1.5;color:${MUTED};">${esc(reason || `You're getting this because you signed up for ${env.BRAND} emails.`)} <a href="${esc(unsubUrl)}" style="color:${MUTED};">Unsubscribe</a></p>
</div></body></html>`;
}

/** Products as plain text lines (name and price, linked) for letter-style reminders. */
export function letterItems(products) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">${products.map((p) => `<tr><td style="padding:0 14px 12px 0;vertical-align:middle;">${p.image ? `<a href="${esc(p.url)}"><img src="${esc(p.image)}" width="88" height="88" alt="" style="display:block;width:88px;height:88px;border-radius:10px;border:1px solid #E3E8EF;"></a>` : ''}</td><td style="padding:0 0 12px;vertical-align:middle;font-size:15px;line-height:1.4;"><a href="${esc(p.url)}" style="color:${INK};font-weight:bold;text-decoration:none;">${esc(shortTitle(p.title))}</a>${p.price != null ? `<br><span style="color:${MUTED};">${money(p.price)}</span>` : ''}</td></tr>`).join('')}</table>`;
}

/** Journal stories for letter-style emails: small photo, linked title and a one-line summary. */
export function letterStories(articles) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">${articles.map((a) => `<tr><td style="padding:0 14px 14px 0;vertical-align:top;">${a.image ? `<a href="${esc(a.url)}"><img src="${esc(a.image)}" width="88" height="88" alt="" style="display:block;width:88px;height:88px;object-fit:cover;border-radius:10px;border:1px solid #E3E8EF;"></a>` : ''}</td><td style="padding:0 0 14px;vertical-align:top;font-size:15px;line-height:1.45;"><a href="${esc(a.url)}" style="color:${INK};font-weight:bold;text-decoration:none;">${esc(a.title)}</a>${a.summary ? `<br><span style="color:${MUTED};">${esc(a.summary)}</span>` : ''}</td></tr>`).join('')}</table>`;
}

/** A plain underlined link on its own line, in place of a button. */
export function letterLink(label, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;"><tr><td style="border-radius:10px;background:#7D03FC;"><a href="${esc(url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:10px;">${esc(label)}</a></td></tr></table>`;
}


export function layout(env, { preheader, banner, bannerAlt, body, unsubUrl, reason, plain, tone, letter }) {
  // Tech.LuxeDealers: every email is a letter (Gmail Primary tab). The designed layout below is kept for reference only.
  return letterLayout(env, { preheader, body, unsubUrl, reason });
  const T = TONES[tone] || TONES.gold;
  const bannerImg = banner
    ? `<tr><td style="padding:0;background:%%DEEP%%;"><img src="${env.PUBLIC_URL}/banners/${banner}" width="600" height="260" alt="${esc(bannerAlt || '')}" style="display:block;width:100%;max-width:600px;height:auto;border:0;background:%%DEEP%%;color:%%FG%%;font-size:22px;font-weight:800;line-height:1.3;text-align:center;"></td></tr>`
    : '';
  // Footer text is drawn as images (tools/footer.mjs): dark-mode recolouring can't touch them. Alt text is the same words.
  const part = (name, w, h, alt, href) => {
    const img = `<img src="${env.PUBLIC_URL}/footer/${name}.png" width="${w}" height="${h}" alt="${esc(alt)}" style="display:inline-block;vertical-align:middle;border:0;max-width:100%;height:auto;color:#C3C8D4;font-size:12px;line-height:18px;font-family:Arial,sans-serif;">`;
    return href ? `<a href="${esc(href)}" style="display:inline-block;text-decoration:none;color:#C3C8D4;">${img}</a>` : img;
  };
  const social = (icon, href, label) => `<a href="${href}" style="display:inline-block;margin:0 5px;text-decoration:none;"><img src="${env.PUBLIC_URL}/icons/social-${icon}.png" width="36" height="36" alt="${label}" style="display:block;border:0;color:${VIOLET};font-size:12px;"></a>`;
  return `<!DOCTYPE html><html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>${esc(env.BRAND)}</title>
<style>body{margin:0;padding:0;background:%%PAGE%%;-webkit-text-size-adjust:100%;}a{color:%%AT%%;}img{-ms-interpolation-mode:bicubic;}
@media (max-width:620px){
.wrap{width:100%!important}.outer{padding:0!important}.card{border-radius:0!important}
.px{padding-left:20px!important;padding-right:20px!important}.h1{font-size:28px!important}
.stack{display:block!important;width:100%!important;box-sizing:border-box}
.offer-big{padding:24px 20px 4px!important}.offer-copy{padding:8px 22px 24px!important;text-align:center!important}.offer-copy table{margin-left:auto!important;margin-right:auto!important}
.gap{width:8px!important}.pbody{padding:12px 10px 14px!important}.ptitle{font-size:13px!important;line-height:17px!important;height:34px!important}
}</style></head>
<body style="margin:0;padding:0;background:%%PAGE%%;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:${INK};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader || '')}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:%%PAGE%%;"><tr><td class="outer" align="center" style="padding:24px 12px;">
<table role="presentation" class="wrap card" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;border-radius:22px;overflow:hidden;background:#FFFFFF;">
<tr><td style="padding:0;background:#FFFFFF;border-bottom:1px solid #E3E8EF;"><a href="${env.STORE_URL}" style="display:block;text-decoration:none;"><img src="${env.PUBLIC_URL}/brand/header.png" width="600" height="100" alt="${esc(env.BRAND)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;background:#FFFFFF;color:#B8892E;font-size:22px;font-weight:900;font-style:italic;text-align:center;"></a></td></tr>
${bannerImg}
<tr><td class="px" style="background:#FFFFFF;padding:32px 32px 30px;">${body}</td></tr>
${plain ? '' : `<tr><td class="px" style="background:%%SOFT%%;padding:22px 26px;">${trustRow(env)}</td></tr>`}
<tr><td class="px" align="center" bgcolor="${BRAND}" background="${env.PUBLIC_URL}/footer/bg.png" style="background-color:${BRAND};background-image:url('${env.PUBLIC_URL}/footer/bg.png');background-repeat:repeat;padding:30px 24px 32px;text-align:center;font-size:0;line-height:0;">
<p style="margin:0 0 18px;">${social('instagram', 'https://www.instagram.com/tech.luxedealers/', 'Instagram')}${social('facebook', 'https://www.facebook.com/profile.php?id=61595062625090', 'Facebook')}</p>
<p style="margin:0 0 14px;">${part('new-in', 45, 20, 'New in', `${env.STORE_URL}/collections/new-arrivals`)}${part('dot', 22, 20, '·')}${part('bags', 34, 20, 'Bags', `${env.STORE_URL}/collections/handbags`)}${part('dot', 22, 20, '·')}${part('shop-all', 54, 20, 'Shop all', `${env.STORE_URL}/collections/shop-all`)}</p>
<p style="margin:0 0 10px;">${part('help', 288, 20, `Questions? Email ${env.REPLY_TO}`, `mailto:${env.REPLY_TO}`)}</p>
<p style="margin:0;">${part('unsub', 291, 18, `${reason || 'Signed up for Tech.LuxeDealers emails'} · Unsubscribe`, unsubUrl)}</p>
</td></tr></table></td></tr></table></body></html>`
    .replace(/%%A%%/g, T.a).replace(/%%AI%%/g, T.ai).replace(/%%AT%%/g, T.at).replace(/%%SOFT%%/g, T.soft).replace(/%%LINE%%/g, T.line)
    .replace(/%%PAGE%%/g, T.page).replace(/%%DEEP2%%/g, T.deep2).replace(/%%DEEP%%/g, T.deep).replace(/%%GLOW%%/g, T.glow).replace(/%%FGS%%/g, T.fgs).replace(/%%FG%%/g, T.fg);
}

/* ---------- Sending ---------- */

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Our own artwork never changes between deploys, so each image is fetched once per Worker instance and reused for
// every email (each fetch counts towards Cloudflare's per-run request limit).
const IMG_CACHE = new Map();

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/**
 * Many mail apps block remote images for new senders, so every image is embedded in the email itself
 * (inline attachments referenced as cid:). An image that can't be fetched stays a normal link.
 */
export async function embedImages(env, html, maxBytes = 1_500_000) {
  // Only our own artwork (logo, banners, icons) is attached; product photos load from Shopify's image servers,
  // which keeps each run within Cloudflare's per-run request limit so the queue keeps moving.
  const urls = [...new Set([...html.matchAll(/<img[^>]+src="(https?:\/\/[^"]+)"/g)].map((m) => m[1]))].filter((u) => u.startsWith(env.PUBLIC_URL + '/'));
  // Fetch every image at once (faster sends), then attach them in page order within the size budget.
  const fetched = await Promise.all(urls.map(async (raw) => {
    const url = raw.replace(/&amp;/g, '&');
    if (IMG_CACHE.has(url)) return { raw, ...IMG_CACHE.get(url) };
    try {
      const req = new Request(url, { headers: { Accept: 'image/jpeg,image/png;q=0.9,image/gif;q=0.8' } });
      const res = url.startsWith(env.PUBLIC_URL + '/') && env.ASSETS ? await env.ASSETS.fetch(req) : await fetch(req);
      const type = (res.headers.get('Content-Type') || '').split(';')[0].trim();
      if (!res.ok || !EXT[type]) return null;
      const buf = await res.arrayBuffer();
      IMG_CACHE.set(url, { type, buf });
      return { raw, type, buf };
    } catch (e) {
      console.error('embed image', url, e);
      return null;
    }
  }));
  const attachments = [];
  let total = 0;
  for (const [i, img] of fetched.entries()) {
    if (!img || total + img.buf.byteLength > maxBytes) continue; // anything left out stays a normal link
    total += img.buf.byteLength;
    const cid = `img${i}@luxemail`;
    attachments.push({ filename: `image-${i}.${EXT[img.type]}`, content: toBase64(img.buf), content_id: cid, content_type: img.type });
    html = html.split(`src="${img.raw}"`).join(`src="cid:${cid}"`);
  }
  return { html, attachments };
}

export async function sendViaResend(env, { to, subject, html: rawHtml, unsubUrl }) {
  if (!(await sendingReady(env))) throw new Error('Sending is not live yet');
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
