CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, expires_at INTEGER);
-- Our own mailing list. Nobody gets marketing email unless status = 'subscribed' here.
-- status: subscribed (ticked the consent box, or accepts marketing on their account) -> unsubscribed.
CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY, first_name TEXT, status TEXT NOT NULL,
  source TEXT, consent_text TEXT, consent_page TEXT, requested_at INTEGER, confirmed_at INTEGER, unsubscribed_at INTEGER);
CREATE INDEX IF NOT EXISTS subscribers_status ON subscribers(status);
-- Browser id -> email, only for people who gave consent on that browser.
CREATE TABLE IF NOT EXISTS clients (client_id TEXT PRIMARY KEY, email TEXT, first_name TEXT, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS clients_email ON clients(email);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT, email TEXT, type TEXT, handle TEXT, product_id TEXT, title TEXT, at INTEGER);
CREATE INDEX IF NOT EXISTS events_email ON events(email, type, at);
CREATE INDEX IF NOT EXISTS events_client ON events(client_id, at);
-- Checkouts reported by the Shopify custom pixel (subscribers only). items: [{variantId, qty, handle, title}]
CREATE TABLE IF NOT EXISTS checkouts (token TEXT PRIMARY KEY, email TEXT, first_name TEXT, total TEXT, items TEXT, started_at INTEGER, updated_at INTEGER, completed INTEGER DEFAULT 0, recover_url TEXT);
CREATE INDEX IF NOT EXISTS checkouts_email ON checkouts(email, updated_at);
-- Order history from the pixel's checkout_completed, checked against the Admin API (verified = 1).
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, email TEXT, first_name TEXT, total_cents INTEGER, handles TEXT, verified INTEGER DEFAULT 0, created_at INTEGER);
CREATE INDEX IF NOT EXISTS orders_email ON orders(email, created_at);
CREATE TABLE IF NOT EXISTS sends (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, flow TEXT, dedupe TEXT UNIQUE, status TEXT, error TEXT, created_at INTEGER, sent_at INTEGER, priority INTEGER DEFAULT 5, payload TEXT);
CREATE INDEX IF NOT EXISTS sends_status ON sends(status, priority, created_at);
CREATE INDEX IF NOT EXISTS sends_email ON sends(email, flow, created_at);
CREATE TABLE IF NOT EXISTS suppressions (email TEXT PRIMARY KEY, reason TEXT, at INTEGER);
-- One personal welcome code per address (shown on the site after sign-up and in the welcome emails).
-- code is NULL for a moment while it's being created, so two requests never make two codes.
CREATE TABLE IF NOT EXISTS welcome_codes (email TEXT PRIMARY KEY, code TEXT, ends_at TEXT, created_at INTEGER);

-- Products each subscriber has been shown, so the next emails show different ones.
CREATE TABLE IF NOT EXISTS shown (email TEXT NOT NULL, handle TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS shown_email ON shown (email, at);

-- Every email we send through Resend, so bounces and spam complaints can be found and that address never emailed again.
CREATE TABLE IF NOT EXISTS deliveries (resend_id TEXT PRIMARY KEY, email TEXT, flow TEXT, sent_at INTEGER, checked_at INTEGER, last_event TEXT);
CREATE INDEX IF NOT EXISTS deliveries_check ON deliveries(last_event, sent_at);
-- Parcel tracking (17TRACK API, key in TRACK17_KEY): one row per tracking number; scans shown on the tracking page.
-- Per-subscriber code added to store links in emails, so a visit from an email counts as engagement.
CREATE TABLE IF NOT EXISTS email_tokens (token TEXT PRIMARY KEY, email TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS parcels (number TEXT PRIMARY KEY, order_name TEXT, fulfillment_id TEXT, status TEXT, scans TEXT, registered INTEGER DEFAULT 0, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS parcels_order ON parcels(order_name);
