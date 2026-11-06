// Parcel scans from the 17TRACK API (server to server; key in TRACK17_KEY, nothing loads from 17TRACK in
// shoppers' browsers). Every few hours: read undelivered shipments from Shopify, fetch their scans, keep them
// (carrier names removed) for the Track your order page, and, when the app has fulfillment permission, add
// Shopify fulfillment events (in transit, out for delivery, delivered) so Shopify sends its own shipping emails.
import { now, HOUR, getKV, setKV } from './util.js';
import { gql, hideCarrier } from './shopify.js';

const T17 = 'https://api.17track.net/track/v2.2';
const MAP = { InTransit: 'IN_TRANSIT', AvailableForPickup: 'READY_FOR_PICKUP', OutForDelivery: 'OUT_FOR_DELIVERY', DeliveryFailure: 'ATTEMPTED_DELIVERY', Delivered: 'DELIVERED' };
const LABEL = 'Tech.LuxeDealers Tracked';
const RANK = { CONFIRMED: 1, IN_TRANSIT: 2, READY_FOR_PICKUP: 3, ATTEMPTED_DELIVERY: 3, OUT_FOR_DELIVERY: 4, DELIVERED: 5 };

async function t17(env, path, body) {
  const r = await fetch(`${T17}/${path}`, { method: 'POST', headers: { '17token': env.TRACK17_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.code !== 0) throw new Error(`17track ${path} ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  return j.data || {};
}

export async function syncParcels(env, force = false) {
  if (!env.TRACK17_KEY) return;
  try { await runSync(env, force); } catch (e) {
    await setKV(env, 'parcel_sync', `error ${new Date().toISOString().slice(0, 16)}: ${String(e.message || e).slice(0, 300)}`);
    throw e;
  }
}

async function runSync(env, force) {
  const t = now();
  if (!force && t < Number(await getKV(env, 'parcel_next') || 0)) return;
  let budget = 30; // Cloudflare free plan: 50 outbound requests per run
  const since = new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10);
  const data = await gql(env, `query($q:String!){ orders(first: 100, sortKey: CREATED_AT, reverse: true, query: $q){ nodes{ name
      fulfillments(first: 5){ id displayStatus trackingInfo(first: 2){ number company url } events(first: 30){ nodes{ status } } } } } }`, { q: `created_at:>=${since}` });
  budget--;
  const ships = [];
  for (const o of data.orders.nodes) for (const f of o.fulfillments) {
    const ti = (f.trackingInfo || []).find((x) => x.number);
    if (!ti || f.displayStatus === 'DELIVERED' || f.displayStatus === 'CANCELED') continue;
    ships.push({ order: o.name.replace('#', ''), fid: f.id, number: ti.number.replace(/\s+/g, '').toUpperCase(), company: ti.company, url: ti.url, best: Math.max(0, ...f.events.nodes.map((e) => RANK[e.status] || 0)) });
  }
  const nums = [...new Set(ships.map((s) => s.number))];
  const denied = /^no permission (\d+)/.exec(await getKV(env, 'parcel_events') || '');
  let pending = false, eventsOk = !denied || t > Number(denied[1]) + 6 * HOUR, added = 0;
  // Register numbers not seen before (each uses one quota, once).
  const known = new Set();
  for (let i = 0; i < nums.length; i += 90) {
    const part = nums.slice(i, i + 90);
    const rows = await env.DB.prepare(`SELECT number FROM parcels WHERE registered = 1 AND number IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    for (const r of rows.results || []) known.add(r.number);
  }
  const fresh = nums.filter((n) => !known.has(n));
  for (let i = 0; i < fresh.length && budget > 4; i += 40) {
    budget--;
    const d = await t17(env, 'register', fresh.slice(i, i + 40).map((number) => ({ number })));
    const ok = [...(d.accepted || []).map((a) => a.number), ...(d.rejected || []).filter((r) => r.error && r.error.code === -18019901).map((r) => r.number)];
    for (const n of ok) await env.DB.prepare('INSERT INTO parcels (number, registered, updated_at) VALUES (?, 1, ?) ON CONFLICT(number) DO UPDATE SET registered = 1').bind(n, t).run();
  }
  for (let i = 0; i < nums.length && budget > 3; i += 40) {
    budget--;
    const d = await t17(env, 'gettrackinfo', nums.slice(i, i + 40).map((number) => ({ number })));
    for (const a of d.accepted || []) {
      const info = a.track_info || {};
      const status = (info.latest_status || {}).status || 'NotFound';
      const scans = [];
      for (const p of ((info.tracking || {}).providers || [])) for (const e of (p.events || [])) {
        const text = hideCarrier(e.description);
        if (!text) continue;
        const ad = e.address || {};
        scans.push({ at: e.time_iso || e.time_utc, text, place: hideCarrier([ad.city, ad.state, ad.country].filter(Boolean).join(', ') || e.location || '') || null });
      }
      scans.sort((x, y) => String(y.at).localeCompare(String(x.at)));
      for (const s of ships.filter((x) => x.number === a.number)) {
        await env.DB.prepare('INSERT INTO parcels (number, order_name, fulfillment_id, status, scans, registered, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?) ON CONFLICT(number) DO UPDATE SET order_name = excluded.order_name, fulfillment_id = excluded.fulfillment_id, status = excluded.status, scans = excluded.scans, updated_at = excluded.updated_at')
          .bind(a.number, s.order, s.fid, status, JSON.stringify(scans.slice(0, 60)), t).run();
        const target = MAP[status];
        if (!eventsOk || !target || (RANK[target] || 0) <= s.best) continue;
        if (budget < 2) { pending = true; continue; }
        budget--;
        try {
          await gql(env, `mutation($e:FulfillmentEventInput!){ fulfillmentEventCreate(fulfillmentEvent:$e){ userErrors{ message } } }`,
            { e: { fulfillmentId: s.fid, status: target, happenedAt: (scans[0] || {}).at || new Date().toISOString(), message: scans[0] ? scans[0].text.slice(0, 200) : null } });
          s.best = RANK[target]; added++;
        } catch (e) {
          // Retried after 6 hours (a newly granted scope reaches the worker with its next Shopify token).
          if (/access|scope|denied/i.test(String(e.message || e))) { eventsOk = false; await setKV(env, 'parcel_events', `no permission ${t}: ${String(e.message || e).slice(0, 200)}`); }
        }
      }
    }
  }
  // Customers only ever see our own tracking page: swap the carrier name and link on undelivered shipments.
  let relabeled = 0;
  for (const s of ships) {
    const url = `${env.STORE_URL}/pages/track-your-order?order=${encodeURIComponent(s.order)}`;
    if (s.company === LABEL && s.url === url) continue;
    if (budget < 6) { pending = true; break; }
    budget--;
    const r = await gql(env, `mutation($id:ID!,$t:FulfillmentTrackingInput!){ fulfillmentTrackingInfoUpdate(fulfillmentId:$id, trackingInfoInput:$t, notifyCustomer:false){ userErrors{ message } } }`,
      { id: s.fid, t: { company: LABEL, number: s.number, url } });
    const errs = r.fulfillmentTrackingInfoUpdate.userErrors;
    if (errs.length) throw new Error(`tracking relabel ${s.order}: ${errs.map((e) => e.message).join('; ')}`);
    relabeled++;
  }
  await setKV(env, 'parcel_next', String(t + (pending ? 0 : 3 * HOUR)));
  await setKV(env, 'parcel_sync', `ok ${new Date().toISOString().slice(0, 16)}: ${nums.length} parcels, ${added} Shopify updates, ${relabeled} relabeled${eventsOk ? '' : ' (Shopify updates need fulfillment permission)'}${pending ? ', more next run' : ''}`);
}

export async function scansFor(env, numbers) {
  if (!numbers.length) return {};
  const r = await env.DB.prepare(`SELECT number, status, scans FROM parcels WHERE number IN (${numbers.map(() => '?').join(',')})`).bind(...numbers).all();
  const out = {};
  for (const x of r.results || []) out[x.number] = { status: x.status, scans: JSON.parse(x.scans || '[]') };
  return out;
}
