// LuxeMail custom pixel. Paste into Shopify admin: Settings > Customer events > Add custom pixel.
// Tells LuxeMail about checkouts (to remind people who confirmed they want our emails) and completed orders
// (stops reminders, sends the post-purchase email, builds the VIP and win-back history).
// LuxeMail ignores the email of anyone who isn't a confirmed subscriber.
// deploy.sh fills in ENDPOINT with the Worker's address.
const ENDPOINT = 'https://luxemail-tech.turbozzgeezzz.workers.dev/p';

function handleFrom(url) {
  const m = /\/products\/([^/?#]+)/.exec(url || '');
  return m ? decodeURIComponent(m[1]) : null;
}

function send(type, checkout) {
  if (!checkout || !checkout.token) return;
  const addr = checkout.shippingAddress || checkout.billingAddress || {};
  const body = JSON.stringify({
    t: type,
    token: checkout.token,
    e: checkout.email || null,
    fn: addr.firstName || null,
    total: checkout.subtotalPrice ? String(checkout.subtotalPrice.amount) : null,
    order: checkout.order ? String(checkout.order.id) : null,
    items: (checkout.lineItems || []).map((l) => ({
      variantId: l.variant ? String(l.variant.id) : null,
      qty: l.quantity,
      handle: l.variant && l.variant.product ? handleFrom(l.variant.product.url) : null,
      title: l.title,
    })),
  });
  fetch(ENDPOINT, { method: 'POST', body, keepalive: true, mode: 'no-cors', headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
}

analytics.subscribe('checkout_started', (event) => send('checkout', event.data.checkout));
analytics.subscribe('checkout_contact_info_submitted', (event) => send('checkout', event.data.checkout));
analytics.subscribe('checkout_shipping_info_submitted', (event) => send('checkout', event.data.checkout));
analytics.subscribe('checkout_completed', (event) => send('order', event.data.checkout));
