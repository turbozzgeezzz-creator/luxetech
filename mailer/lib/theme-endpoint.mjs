// Sets Theme settings > Email tracking > Endpoint in config/settings_data.json. The deploy script commits it.
import { readFileSync, writeFileSync } from 'node:fs';

const url = process.argv[2];
const file = new URL('../../config/settings_data.json', import.meta.url);
let s = readFileSync(file, 'utf8');
if (/"luxemail_endpoint":\s*"[^"]*"/.test(s)) {
  s = s.replace(/"luxemail_endpoint":\s*"[^"]*"/, `"luxemail_endpoint": ${JSON.stringify(url)}`);
} else {
  s = s.replace(/"current":\s*\{\n(\s*)/, (m, indent) => `${m}"luxemail_endpoint": ${JSON.stringify(url)},\n${indent}`);
}
writeFileSync(file, s);
console.log(`   tracking endpoint set to ${url} (commit and push to make it live)`);
