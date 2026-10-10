// Writes the Worker's pixel address into mailer/pixel.js, ready to paste into Shopify.
import { readFileSync, writeFileSync } from 'node:fs';

const url = process.argv[2];
const file = new URL('../pixel.js', import.meta.url);
writeFileSync(file, readFileSync(file, 'utf8').replace(/^const ENDPOINT = '.*';$/m, `const ENDPOINT = ${JSON.stringify(url).replace(/"/g, "'")};`));
console.log(`   pixel.js endpoint set to ${url}`);
