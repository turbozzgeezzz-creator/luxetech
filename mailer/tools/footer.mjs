// Renders the email footer's text as images (white/grey on the dark band), so mail apps that recolour
// text in dark mode can't make it vanish. Run: node tools/footer.mjs  (needs Playwright/Chromium)
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const assets = new URL('../../assets/', import.meta.url);
const out = new URL('../public/footer/', import.meta.url);
const font = (f) => `data:font/woff2;base64,${readFileSync(new URL(f, assets)).toString('base64')}`;
const BG = '#0B1220';
// [file, html, css]: rendered at 2x, shown at 1x in the email.
const PARTS = [
  ['nav-new', 'New in', 'nav'], ['nav-best', 'Best sellers', 'nav'], ['nav-all', 'Shop all', 'nav'], ['nav-dot', '&middot;', 'dot'],
  ['contact', 'Questions? Just reply, or email<br><span class="link">support@luxedealers.com</span>', 'text'],
  ['reason', 'You\'re getting this because you<br>signed up for our emails.', 'small'],
  ['unsubscribe', '<span class="u">Unsubscribe</span>', 'small'],
];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ deviceScaleFactor: 2 });
for (const [name, html, kind] of PARTS) {
  await page.setContent(`<html><head><style>
@font-face{font-family:A;src:url(${font('archivo.woff2')});font-weight:100 900;font-stretch:62% 125%}
body{margin:0;background:${BG}}#x{display:inline-block;background:${BG};text-align:center;font-family:A,Arial,sans-serif;padding:4px 6px}
.nav{font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#fff;padding:6px 8px}
.dot{font-size:12px;font-weight:800;color:#5B6275;padding:6px 2px}
.text{font-size:14px;line-height:21px;color:#C3C8D4}.link{color:#C9A5FF;text-decoration:underline}
.small{font-size:12px;line-height:18px;color:#8A90A0}.u{color:#C3C8D4;text-decoration:underline}
</style></head><body><div id="x" class="${kind}">${html}</div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#x').screenshot({ path: new URL(`${name}.png`, out).pathname });
}
await browser.close();
console.log('footer images written');
