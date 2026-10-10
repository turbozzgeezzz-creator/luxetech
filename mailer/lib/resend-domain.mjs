// Makes sure the sending domain exists in Resend. Prints its status ("verified", "pending", ...) to stdout,
// and the DNS records still needed to stderr so they show in the deploy log.
const name = process.argv[2];
const api = (path, init = {}) => fetch('https://api.resend.com' + path, {
  ...init,
  headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
}).then(async (r) => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend ${path} ${r.status}: ${body.message || ''}`);
  return body;
});

let domain = (await api('/domains')).data.find((d) => d.name === name);
if (!domain) domain = await api('/domains', { method: 'POST', body: JSON.stringify({ name, region: 'ap-northeast-1' }) });
let info = await api(`/domains/${domain.id}`);
if (info.status !== 'verified') {
  await api(`/domains/${domain.id}/verify`, { method: 'POST' }).catch(() => {});
  info = await api(`/domains/${domain.id}`);
}
if (info.status !== 'verified') {
  console.error(`   Add these DNS records for ${name} where luxedealers.com's DNS is managed:`);
  for (const r of info.records || []) {
    console.error(`   - ${r.type.padEnd(5)} name: ${r.name}   value: ${r.value}${r.priority != null ? `   priority: ${r.priority}` : ''}   (${r.status})`);
  }
}
process.stdout.write(info.status);
