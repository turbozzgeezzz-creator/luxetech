// Makes a new email banner from an existing one: keeps its artwork and background, replaces the text.
// Usage: node tools/banner.mjs <source.jpg (1200x600 original)> <out.jpg> "EYEBROW" "Headline line 1" "Headline line 2"
// Needs Playwright (Chromium) and Python with Pillow. Output is 1200x520 like the other banners.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [src, out, eyebrow, line1, line2] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), 'banner-'));
const clean = join(dir, 'clean.png');

// 1. Blend out the printed logo (top left) and the old text, column by column, from the clean background
//    just above and below each area. The background is a smooth gradient, so this leaves no trace.
execFileSync('python3', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB'); px = im.load()
def blend(x0, x1, y0, y1):
    for x in range(x0, x1):
        top = [sum(px[x, y][c] for y in range(y0 - 6, y0)) / 6 for c in range(3)]
        bot = [sum(px[x, y][c] for y in range(y1, y1 + 6)) / 6 for c in range(3)]
        for y in range(y0, y1):
            t = (y - y0) / (y1 - y0)
            px[x, y] = tuple(int(round(top[c] * (1 - t) + bot[c] * t)) for c in range(3))
blend(30, 345, 22, 124)   # logo
blend(60, 770, 232, 450)  # old eyebrow and headline
im.save(sys.argv[2])
`, src, clean]);

// 2. Set the new text in the store's own fonts (Archivo heavy italic, JetBrains Mono).
const assets = new URL('../../assets/', import.meta.url);
const font = (f) => `data:font/woff2;base64,${readFileSync(new URL(f, assets)).toString('base64')}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = `<html><head><style>
@font-face{font-family:A;src:url(${font('archivo-italic.woff2')});font-style:italic;font-weight:100 900;font-stretch:62% 125%}
@font-face{font-family:M;src:url(${font('jetbrains-mono.woff2')})}
body{margin:0}#b{position:relative;width:1200px;height:600px;background:url(data:image/png;base64,${readFileSync(clean).toString('base64')})}
#t{position:absolute;left:80px;top:244px;width:700px}
.e{font-family:M;font-size:22px;letter-spacing:7px;color:#D2C2FF;text-transform:uppercase}
.h{margin-top:24px;font-family:A;font-style:italic;font-weight:900;font-stretch:125%;font-size:74px;line-height:1.02;letter-spacing:-1.5px;color:#fff}
</style></head><body><div id="b"><div id="t"><div class="e">${esc(eyebrow)}</div><div class="h">${esc(line1)}<br>${esc(line2 || '')}</div></div></div></body></html>`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1200, height: 600 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
const full = join(dir, 'full.png');
await page.locator('#b').screenshot({ path: full });
await browser.close();

// 3. Crop to the email size (same crop as the other banners) and save as JPEG.
execFileSync('python3', ['-c', `
import sys
from PIL import Image
Image.open(sys.argv[1]).convert('RGB').crop((0, 55, 1200, 575)).save(sys.argv[2], 'JPEG', quality=86, optimize=True, progressive=True)
`, full, out]);
console.log('wrote', out);
