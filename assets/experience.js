/* ==========================================================================
   Tech.LuxeDealers experience layer
   Scroll reveals, promo carousel, recently viewed, recommendations,
   welcome-back modal, multi-item add to cart and dispatch estimates.
   Loaded after theme.js; everything here is progressive enhancement, so
   the store works the same with JavaScript off.
   ========================================================================== */
(function () {
  'use strict';

  var VIEWED_KEY = 'luxetech:viewed';
  var VISIT_KEY = 'luxetech:last-visit';
  var WELCOME_KEY = 'luxetech:welcome-shown';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var config = window.LuxeTech || {};

  function store(kind) {
    try { return kind === 'session' ? window.sessionStorage : window.localStorage; } catch (e) { return null; }
  }
  function read(key, kind) {
    var s = store(kind); if (!s) return null;
    try { return JSON.parse(s.getItem(key)); } catch (e) { return null; }
  }
  function write(key, value, kind) {
    var s = store(kind); if (!s) return;
    try { s.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  }
  function escapeHTML(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function formatMoney(cents) {
    var format = config.moneyFormat || '${{amount}}';
    var value = (Number(cents) || 0) / 100;
    var withDelims = function (n, dec, thou, decSep) {
      var parts = n.toFixed(dec).split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thou);
      return parts.join(decSep);
    };
    return format.replace(/\{\{\s*(\w+)\s*\}\}/, function (_, key) {
      switch (key) {
        case 'amount_no_decimals': return withDelims(value, 0, ',', '.');
        case 'amount_with_comma_separator': return withDelims(value, 2, '.', ',');
        case 'amount_no_decimals_with_comma_separator': return withDelims(value, 0, '.', ',');
        default: return withDelims(value, 2, ',', '.');
      }
    });
  }
  function imageUrl(src, width) {
    if (!src) return '';
    if (src.indexOf('//') === 0) src = 'https:' + src;
    return src + (src.indexOf('?') > -1 ? '&' : '?') + 'width=' + width;
  }

  /* ------------------------------------------------------------------ */
  /* Scroll reveals                                                     */
  /* ------------------------------------------------------------------ */
  function initReveals() {
    var targets = document.querySelectorAll('main .shopify-section:not(:first-child), [data-reveal]');
    if (reduceMotion || !('IntersectionObserver' in window) || !targets.length) return;
    document.documentElement.classList.add('has-reveal');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });
    targets.forEach(function (el) {
      el.classList.add('reveal');
      /* Stagger direct items in grids so tiles arrive one after another. */
      el.querySelectorAll('[data-stagger] > *').forEach(function (child, i) {
        child.style.setProperty('--stagger', Math.min(i, 8));
      });
      /* Anything already on screen shows immediately. */
      var rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.95) { el.classList.add('is-in'); return; }
      io.observe(el);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Promo carousel (bento hero)                                        */
  /* ------------------------------------------------------------------ */
  class BentoCarousel extends HTMLElement {
    connectedCallback() {
      this.track = this.querySelector('[data-bento-track]');
      this.slides = Array.prototype.slice.call(this.querySelectorAll('[data-slide]'));
      this.dots = Array.prototype.slice.call(this.querySelectorAll('[data-dot]'));
      if (!this.track || this.slides.length < 2) return;
      this.index = 0;
      this.dots.forEach((dot, i) => dot.addEventListener('click', () => { this.go(i); this.restart(); }));
      var prev = this.querySelector('[data-prev]'); var next = this.querySelector('[data-next]');
      if (prev) prev.addEventListener('click', () => { this.go(this.index - 1); this.restart(); });
      if (next) next.addEventListener('click', () => { this.go(this.index + 1); this.restart(); });
      /* Native scrolling does the swiping; we only keep the dots in sync with where it lands. */
      var ticking = false;
      this.track.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => { ticking = false; this.sync(); });
      }, { passive: true });
      /* Pause autoplay while someone is touching or hovering, resume after. */
      var pause = () => this.stop();
      var resume = () => { clearTimeout(this.resumeTimer); this.resumeTimer = setTimeout(() => this.start(), 4000); };
      this.track.addEventListener('touchstart', pause, { passive: true });
      this.track.addEventListener('touchend', resume, { passive: true });
      this.track.addEventListener('wheel', () => { pause(); resume(); }, { passive: true });
      this.addEventListener('mouseenter', pause);
      this.addEventListener('mouseleave', () => this.start());
      this.addEventListener('focusin', pause);
      this.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { this.go(this.index - 1); this.restart(); }
        if (e.key === 'ArrowRight') { this.go(this.index + 1); this.restart(); }
      });
      this.mark(0);
      this.start();
    }
    disconnectedCallback() { this.stop(); clearTimeout(this.resumeTimer); }
    sync() {
      var left = this.track.scrollLeft;
      var best = 0, bestDist = Infinity;
      this.slides.forEach((s, k) => {
        var d = Math.abs(s.offsetLeft - this.track.offsetLeft - left);
        if (d < bestDist) { bestDist = d; best = k; }
      });
      /* At the far end the last slide may not reach the left edge, so treat the end as the last slide. */
      if (left + this.track.clientWidth >= this.track.scrollWidth - 4) best = this.slides.length - 1;
      if (best !== this.index) this.mark(best);
    }
    mark(i) {
      this.index = i;
      this.slides.forEach((s, k) => {
        var active = k === i;
        s.classList.toggle('is-active', active);
        s.setAttribute('aria-hidden', active ? 'false' : 'true');
        s.querySelectorAll('a, button').forEach(function (el) { el.tabIndex = active ? 0 : -1; });
      });
      this.dots.forEach((d, k) => d.setAttribute('aria-current', k === i ? 'true' : 'false'));
    }
    go(i) {
      var n = this.slides.length;
      i = (i + n) % n;
      var target = this.slides[i].offsetLeft - this.track.offsetLeft;
      this.track.scrollTo({ left: target, behavior: reduceMotion ? 'auto' : 'smooth' });
      this.mark(i);
    }
    start() {
      if (reduceMotion || this.dataset.autoplay !== 'true') return;
      this.stop();
      var ms = (parseInt(this.dataset.speed, 10) || 6) * 1000;
      this.classList.add('is-playing');
      this.timer = setInterval(() => {
        /* Do not move a slide the visitor cannot see. */
        var r = this.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return;
        this.go(this.index + 1);
      }, ms);
    }
    stop() { clearInterval(this.timer); this.classList.remove('is-playing'); }
    restart() { this.stop(); this.start(); }
  }
  customElements.define('bento-carousel', BentoCarousel);

  /* ------------------------------------------------------------------ */
  /* Order tracker: open the chosen carrier's tracking page             */
  /* ------------------------------------------------------------------ */
  class OrderTracker extends HTMLElement {
    connectedCallback() {
      var form = this.querySelector('[data-tracker-form]');
      if (!form) return;
      var input = form.querySelector('input[name="number"]');
      var select = form.querySelector('select[name="carrier"]');
      var error = form.querySelector('[role="alert"]');
      try {
        var saved = localStorage.getItem('luxetech:carrier');
        if (saved && select && Array.prototype.some.call(select.options, function (o) { return o.value === saved; })) select.value = saved;
      } catch (e) {}
      input.addEventListener('input', function () { if (error) error.hidden = true; input.removeAttribute('aria-invalid'); });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var number = (input.value || '').replace(/\s+/g, '').trim();
        if (!number) {
          if (error) error.hidden = false;
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return;
        }
        var pattern = select ? select.value : '';
        if (!pattern) return;
        try { localStorage.setItem('luxetech:carrier', pattern); } catch (err) {}
        var url = pattern.indexOf('{number}') > -1 ? pattern.split('{number}').join(encodeURIComponent(number)) : pattern + encodeURIComponent(number);
        window.open(url, '_blank', 'noopener');
      });
    }
  }
  customElements.define('order-tracker', OrderTracker);

  /* ------------------------------------------------------------------ */
  /* Recently viewed: record on product pages                           */
  /* ------------------------------------------------------------------ */
  function getViewed() {
    var list = read(VIEWED_KEY);
    return Array.isArray(list) ? list : [];
  }
  function recordView() {
    var node = document.getElementById('ProductViewData');
    if (!node) return;
    var data;
    try { data = JSON.parse(node.textContent); } catch (e) { return; }
    if (!data || !data.handle) return;
    data.at = Date.now();
    var list = getViewed().filter(function (p) { return p.handle !== data.handle; });
    list.unshift(data);
    write(VIEWED_KEY, list.slice(0, 12));
    mailTrack({ t: 'view', h: data.handle, p: data.id, ti: data.title });
  }

  function cardHTML(p) {
    var img = p.image
      ? '<img src="' + escapeHTML(imageUrl(p.image, 500)) + '" alt="" loading="lazy" class="card__img card__img--primary" width="500" height="500">'
      : '';
    var price = typeof p.price === 'number' ? formatMoney(p.price) : escapeHTML(p.price);
    var from = p.price_varies ? '<span class="price__from">From </span>' : '';
    return '<article class="card card--mini">' +
      '<div class="card__media ratio ratio--square"><a href="' + escapeHTML(p.url) + '" class="card__media-link" tabindex="-1" aria-hidden="true">' + img + '</a></div>' +
      '<div class="card__body">' +
      (p.category ? '<p class="card__label">' + escapeHTML(p.category) + '</p>' : '') +
      '<h3 class="card__title"><a href="' + escapeHTML(p.url) + '" class="card__link">' + escapeHTML(p.title) + '</a></h3>' +
      '<div class="price"><span class="price__current">' + from + price + '</span></div>' +
      '</div></article>';
  }

  class RecentlyViewed extends HTMLElement {
    connectedCallback() {
      var exclude = this.dataset.exclude || '';
      var limit = parseInt(this.dataset.limit, 10) || 8;
      var items = getViewed().filter(function (p) { return p.handle !== exclude; }).slice(0, limit);
      var track = this.querySelector('[data-track]');
      if (!items.length || !track) return;
      track.innerHTML = items.map(function (p) { return '<li class="rail__item">' + cardHTML(p) + '</li>'; }).join('');
      this.hidden = false;
      var clear = this.querySelector('[data-clear-viewed]');
      if (clear) clear.addEventListener('click', () => { write(VIEWED_KEY, []); this.hidden = true; });
    }
  }
  customElements.define('recently-viewed', RecentlyViewed);

  /* Recommended for you: Shopify's recommendations for the last product viewed. */
  class RecommendedForYou extends HTMLElement {
    connectedCallback() {
      var viewed = getViewed();
      var seed = viewed[0];
      var track = this.querySelector('[data-track]');
      if (!seed || !seed.id || !track) return;
      var seen = viewed.map(function (p) { return p.handle; });
      var url = (config.routes && config.routes.recommendations ? config.routes.recommendations : '/recommendations/products') +
        '.json?product_id=' + encodeURIComponent(seed.id) + '&limit=10&intent=related';
      fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then((data) => {
        if (!data || !data.products) return;
        var picks = data.products.filter(function (p) { return p.available && seen.indexOf(p.handle) === -1; }).slice(0, 8);
        if (picks.length < 2) picks = data.products.filter(function (p) { return p.available; }).slice(0, 8);
        if (!picks.length) return;
        track.innerHTML = picks.map(function (p) {
          return '<li class="rail__item">' + cardHTML({
            title: p.title, url: p.url, price: p.price, price_varies: p.price_varies,
            image: p.featured_image || (p.images && p.images[0]), category: p.type
          }) + '</li>';
        }).join('');
        var label = this.querySelector('[data-seed]');
        if (label) label.textContent = seed.title;
        this.hidden = false;
      }).catch(function () {});
    }
  }
  customElements.define('recommended-for-you', RecommendedForYou);

  /* ------------------------------------------------------------------ */
  /* Cart helpers                                                       */
  /* ------------------------------------------------------------------ */
  function addItems(items, trigger) {
    var body = { items: items, sections: 'cart-drawer', sections_url: window.location.pathname };
    return fetch(((config.routes && config.routes.cartAdd) || '/cart/add') + '.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.description || data.message || 'Could not add to cart');
        (data.items || []).forEach(function (line) { document.dispatchEvent(new CustomEvent('luxe:cart-added', { detail: line })); });
        return data;
      });
    }).then(function (data) {
      var drawer = document.getElementById('CartDrawer');
      if (drawer && data.sections && data.sections['cart-drawer'] && typeof drawer.renderFromHTML === 'function') {
        drawer.renderFromHTML(data.sections['cart-drawer']);
        if (!document.body.classList.contains('template-cart')) drawer.open(trigger);
        else window.location.reload();
      } else {
        window.location.href = (config.routes && config.routes.cart) || '/cart';
      }
      return data;
    });
  }

  /* "Add both / add selected" buttons: data-bundle-add inside a [data-bundle] container. */
  document.addEventListener('change', function (e) {
    var box = e.target.closest('[data-bundle-item]');
    if (!box) return;
    var wrap = box.closest('[data-bundle]');
    if (wrap) updateBundle(wrap);
  });
  function updateBundle(wrap) {
    var checked = wrap.querySelectorAll('[data-bundle-item]:checked');
    var total = 0;
    checked.forEach(function (c) { total += parseInt(c.dataset.price, 10) || 0; });
    var totalEl = wrap.querySelector('[data-bundle-total]');
    var pct = parseInt(wrap.dataset.bundlePct, 10) || 0;
    if (totalEl) {
      if (pct > 0 && checked.length >= 2) {
        totalEl.innerHTML = escapeHTML(formatMoney(Math.round(total * (100 - pct) / 100))) + ' <s class="bundle-was">' + escapeHTML(formatMoney(total)) + '</s>';
      } else {
        totalEl.textContent = formatMoney(total);
      }
    }
    var countEl = wrap.querySelector('[data-bundle-count]');
    if (countEl) countEl.textContent = checked.length;
    var nounEl = wrap.querySelector('[data-bundle-noun]');
    if (nounEl) nounEl.textContent = checked.length === 1 ? 'item' : 'items';
    var btn = wrap.querySelector('[data-bundle-add]');
    if (btn) btn.disabled = checked.length === 0;
    wrap.querySelectorAll('[data-bundle-card]').forEach(function (card) {
      var input = card.querySelector('[data-bundle-item]');
      card.classList.toggle('is-off', input && !input.checked);
    });
  }
  document.querySelectorAll('[data-bundle]').forEach(updateBundle);
  /* Tapping anywhere on a bundle card (except its links) ticks or unticks it. */
  document.addEventListener('click', function (e) {
    var card = e.target.closest('[data-bundle-card]');
    if (!card || e.target.closest('a, button, input, label, select')) return;
    var input = card.querySelector('[data-bundle-item]');
    if (!input || input.disabled) return;
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-bundle-add]');
    if (!btn) return;
    e.preventDefault();
    var wrap = btn.closest('[data-bundle]');
    var items = [];
    wrap.querySelectorAll('[data-bundle-item]:checked').forEach(function (c) {
      items.push({ id: parseInt(c.value, 10), quantity: 1 });
    });
    if (!items.length) return;
    var err = wrap.querySelector('[data-bundle-error]');
    if (err) err.hidden = true;
    btn.classList.add('is-loading');
    addItems(items, btn).catch(function (ex) {
      if (err) { err.textContent = ex.message; err.hidden = false; }
    }).finally(function () { btn.classList.remove('is-loading'); });
  });

  /* Single quick add from welcome-back cards */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-quick-variant]');
    if (!btn) return;
    e.preventDefault();
    btn.classList.add('is-loading');
    var dialog = btn.closest('dialog');
    addItems([{ id: parseInt(btn.dataset.quickVariant, 10), quantity: 1 }], btn)
      .then(function () { if (dialog && dialog.open) dialog.close(); })
      .catch(function () { window.location.href = btn.dataset.fallback || '/cart'; })
      .finally(function () { btn.classList.remove('is-loading'); });
  });

  /* ------------------------------------------------------------------ */
  /* Welcome back: returning visitors get their recently viewed items   */
  /* ------------------------------------------------------------------ */
  class WelcomeBack extends HTMLElement {
    connectedCallback() {
      var last = read(VISIT_KEY);
      write(VISIT_KEY, Date.now());
      this.dialog = this.querySelector('dialog');
      if (!this.dialog || typeof this.dialog.showModal !== 'function') return;
      if (document.body.classList.contains('template-cart') || document.getElementById('ProductViewData')) return;
      if (read(WELCOME_KEY, 'session')) return;
      var returning = last && Date.now() - last > 30 * 60 * 1000;
      var items = getViewed().filter(function (p) { return p.variant && p.available !== false; }).slice(0, 6);
      if (!returning || !items.length) return;
      var track = this.querySelector('[data-track]');
      track.innerHTML = items.map(function (p) {
        var img = p.image ? '<img src="' + escapeHTML(imageUrl(p.image, 400)) + '" alt="" loading="lazy" width="400" height="400">' : '';
        return '<li class="welcome-card">' +
          '<a href="' + escapeHTML(p.url) + '" class="welcome-card__media">' + img + '</a>' +
          (p.category ? '<p class="welcome-card__cat">' + escapeHTML(p.category) + '</p>' : '') +
          '<a href="' + escapeHTML(p.url) + '" class="welcome-card__title">' + escapeHTML(p.title) + '</a>' +
          '<p class="welcome-card__stock"><span class="stock__dot"></span>In stock</p>' +
          '<p class="welcome-card__price">' + (typeof p.price === 'number' ? formatMoney(p.price) : escapeHTML(p.price)) + '</p>' +
          (p.single_variant
            ? '<button type="button" class="btn btn--primary btn--sm btn--block" data-quick-variant="' + escapeHTML(p.variant) + '" data-fallback="' + escapeHTML(p.url) + '">Add to cart</button>'
            : '<a href="' + escapeHTML(p.url) + '" class="btn btn--primary btn--sm btn--block">Choose options</a>') +
          '</li>';
      }).join('');
      this.querySelectorAll('[data-welcome-close]').forEach((b) => b.addEventListener('click', () => this.dialog.close()));
      this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
      this.timer = setTimeout(() => this.show(), 2500);
    }
    show() {
      if (document.querySelector('dialog[open]') || document.querySelector('.drawer:not([hidden])')) {
        this.timer = setTimeout(() => this.show(), 4000);
        return;
      }
      write(WELCOME_KEY, true, 'session');
      this.dialog.showModal();
    }
    disconnectedCallback() { clearTimeout(this.timer); }
  }
  customElements.define('welcome-back', WelcomeBack);

  /* ------------------------------------------------------------------ */
  /* Dispatch estimate: business days from today                        */
  /* ------------------------------------------------------------------ */
  function addBusinessDays(date, days) {
    var d = new Date(date.getTime());
    var added = 0;
    while (added < days) {
      d.setDate(d.getDate() + 1);
      var wd = d.getDay();
      if (wd !== 0 && wd !== 6) added++;
    }
    return d;
  }
  function initEstimates() {
    var fmt;
    try { fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); } catch (e) { return; }
    document.querySelectorAll('[data-dispatch-estimate]').forEach(function (el) {
      var min = parseInt(el.dataset.min, 10) || 3;
      var max = parseInt(el.dataset.max, 10) || min;
      var now = new Date();
      var from = addBusinessDays(now, min);
      var to = addBusinessDays(now, max);
      var out = el.querySelector('[data-dispatch-dates]') || el;
      out.textContent = min === max ? fmt.format(from) : fmt.format(from) + ' – ' + fmt.format(to);
      el.hidden = false;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Links that open the email popup (welcome offer)                    */
  /* ------------------------------------------------------------------ */
  document.addEventListener('click', function (e) {
    var link = e.target.closest('[data-open-popup]');
    if (!link) return;
    var popup = document.querySelector('newsletter-popup');
    if (popup && typeof popup.open === 'function' && popup.querySelector('dialog')) {
      e.preventDefault();
      popup.open();
    }
  });

  /* ------------------------------------------------------------------ */
  /* Dark mode toggle                                                   */
  /* ------------------------------------------------------------------ */
  function syncThemeButtons() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      b.setAttribute('aria-pressed', dark ? 'true' : 'false');
      if (b.classList.contains('header__icon')) b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    });
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-theme-toggle]');
    if (!btn) return;
    var root = document.documentElement;
    var dark = root.getAttribute('data-theme') !== 'dark';
    if (dark) root.setAttribute('data-theme', 'dark'); else root.removeAttribute('data-theme');
    try { localStorage.setItem('luxetech:theme', dark ? 'dark' : 'light'); } catch (err) {}
    syncThemeButtons();
  });

  /* Currency / country selector submits on change */
  document.addEventListener('change', function (e) {
    var sel = e.target.closest('[data-autosubmit]');
    if (sel && sel.form) sel.form.submit();
  });

  /* ------------------------------------------------------------------ */
  /* LuxeMail tracking (only when Theme settings > Email tracking is set) */
  /* Records views, cart adds and wishlist saves so emails can recommend  */
  /* the right products. Emails only go to people who signed up to the    */
  /* email list (or accept marketing on their account).                   */
  /* ------------------------------------------------------------------ */
  function mailClientId() {
    var id = read('luxetech:cid');
    if (typeof id === 'string' && id.length > 8) return id;
    id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    write('luxetech:cid', id);
    return id;
  }
  function mailTrack(body) {
    var mail = config.mail;
    if (!mail || !mail.endpoint) return;
    try {
      body.cid = mailClientId();
      var payload = JSON.stringify(body);
      var sent = navigator.sendBeacon && navigator.sendBeacon(mail.endpoint, new Blob([payload], { type: 'text/plain' }));
      if (!sent) fetch(mail.endpoint, { method: 'POST', body: payload, keepalive: true, mode: 'no-cors' });
    } catch (e) { /* tracking must never break the page */ }
  }
  /* Signed-in customers who accept marketing on their account (the theme  */
  /* only passes their email then): once per session.                    */
  (function () {
    var mail = config.mail;
    if (!mail || !mail.email) return;
    try { if (sessionStorage.getItem('luxetech:identified')) return; sessionStorage.setItem('luxetech:identified', '1'); } catch (e) {}
    mailTrack({ e: mail.email, fn: mail.firstName || null, c: 1, src: 'account', pg: location.pathname });
  })();
  /* Newsletter sign-ups: submitting the form joins the email list. */
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.querySelector) return;
    var tags = form.querySelector('input[name="contact[tags]"]');
    var email = form.querySelector('input[name="contact[email]"]');
    if (!tags || !email || !/newsletter/.test(tags.value) || !email.value) return;
    var src = (tags.value.split(',')[1] || 'newsletter').trim();
    try { sessionStorage.setItem('luxetech:signup-email', email.value.trim()); } catch (err) {}
    mailTrack({ e: email.value, c: 1, src: src, pg: location.pathname });
  }, true);
  /* After the sign-up reloads the page: show the subscriber's own welcome code (from LuxeMail, the  */
  /* same one as in their welcome email). Falls back to the shared code if anything goes wrong.      */
  (function () {
    var reveals = document.querySelectorAll('[data-welcome-reveal]');
    if (!reveals.length) return;
    var mail = config.mail;
    var email = null;
    try { email = sessionStorage.getItem('luxetech:signup-email'); } catch (e) {}
    Array.prototype.forEach.call(reveals, function (el) {
      var codeEl = el.querySelector('[data-discount-code]');
      var copy = el.querySelector('[data-copy-code]');
      var apply = el.querySelector('[data-apply-code]');
      var actions = el.querySelector('.discount-reveal__actions');
      var note = el.querySelector('[data-discount-note]');
      var done = false;
      function show(code, endsAt) {
        if (done || !code) return;
        done = true;
        codeEl.textContent = code;
        if (copy) copy.setAttribute('data-copy-code', code);
        if (apply) apply.href = apply.getAttribute('data-href-base').replace('__CODE__', encodeURIComponent(code));
        if (actions) actions.hidden = false;
        if (endsAt && note) {
          note.textContent = 'Your own code: single use, valid until ' + new Date(endsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) + '.';
          note.hidden = false;
        }
      }
      var fallback = function () { show(el.getAttribute('data-fallback-code')); };
      if (!mail || !mail.endpoint || !email) return fallback();
      setTimeout(fallback, 9000);
      var url = mail.endpoint.replace(/\/t\/?$/, '') + '/welcome-code';
      var tries = 0;
      (function ask() {
        fetch(url, { method: 'POST', body: JSON.stringify({ e: email }), headers: { 'Content-Type': 'text/plain' } })
          .then(function (res) {
            // A brand-new sign-up can take a moment to reach the list: try again a few times.
            if (res.status === 404 && tries++ < 3) { setTimeout(ask, 1500); return null; }
            return res.ok ? res.json() : null;
          })
          .then(function (data) {
            if (data === null && tries > 0 && tries <= 3) return;
            if (data && data.code && Date.parse(data.endsAt) > Date.now()) show(data.code, data.endsAt);
            else fallback();
          })
          .catch(fallback);
      })();
    });
  })();
  document.addEventListener('luxe:cart-added', function (e) {
    var d = e.detail || {};
    if (d.handle) mailTrack({ t: 'cart', h: d.handle, p: d.product_id, ti: d.product_title || d.title });
  });

  /* ------------------------------------------------------------------ */
  /* Wishlist (stored on the shopper's device)                          */
  /* ------------------------------------------------------------------ */
  var WISH_KEY = 'luxetech:wishlist';
  function getWishlist() { var l = read(WISH_KEY); return Array.isArray(l) ? l : []; }
  function setWishlist(list) { write(WISH_KEY, list); syncWishlist(); document.dispatchEvent(new CustomEvent('wishlist:change')); }
  function syncWishlist() {
    var list = getWishlist();
    var handles = list.map(function (p) { return p.handle; });
    document.querySelectorAll('[data-wishlist-count]').forEach(function (el) {
      el.textContent = list.length; el.hidden = list.length === 0;
    });
    document.querySelectorAll('[data-wishlist-toggle]').forEach(function (btn) {
      var on = handles.indexOf(btn.dataset.handle) > -1;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      var label = btn.querySelector('[data-wishlist-label]');
      if (label) label.textContent = on ? 'Saved' : 'Save';
    });
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-wishlist-toggle]');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    var item;
    try { item = JSON.parse(btn.dataset.product); } catch (err) { return; }
    var list = getWishlist();
    var idx = list.findIndex(function (p) { return p.handle === item.handle; });
    if (idx > -1) list.splice(idx, 1); else list.unshift(item);
    setWishlist(list.slice(0, 50));
    mailTrack({ t: idx > -1 ? 'unwishlist' : 'wishlist', h: item.handle, ti: item.title });
    btn.classList.add('is-pop'); setTimeout(function () { btn.classList.remove('is-pop'); }, 400);
  });

  class WishlistGrid extends HTMLElement {
    connectedCallback() {
      this.render();
      document.addEventListener('wishlist:change', () => this.render());
    }
    render() {
      var list = getWishlist();
      var grid = this.querySelector('[data-wishlist-grid]');
      var empty = this.querySelector('[data-wishlist-empty]');
      var count = this.querySelector('[data-wishlist-total]');
      if (count) count.textContent = list.length + (list.length === 1 ? ' saved item' : ' saved items');
      if (!grid) return;
      if (!list.length) { grid.innerHTML = ''; if (empty) empty.hidden = false; return; }
      if (empty) empty.hidden = true;
      grid.innerHTML = list.map(function (p) {
        var img = p.image ? '<img src="' + escapeHTML(imageUrl(p.image, 500)) + '" alt="" loading="lazy" class="card__img card__img--primary" width="500" height="500">' : '';
        var price = typeof p.price === 'number' ? formatMoney(p.price) : escapeHTML(p.price);
        var action = p.single_variant
          ? '<button type="button" class="btn btn--primary btn--sm btn--block" data-quick-variant="' + escapeHTML(p.variant) + '" data-fallback="' + escapeHTML(p.url) + '">Add to cart</button>'
          : '<a href="' + escapeHTML(p.url) + '" class="btn btn--primary btn--sm btn--block">Choose options</a>';
        return '<li><article class="card card--mini">' +
          '<div class="card__media ratio ratio--square"><a href="' + escapeHTML(p.url) + '" class="card__media-link" tabindex="-1" aria-hidden="true">' + img + '</a>' +
          '<button type="button" class="wish-btn is-active" data-wishlist-toggle data-handle="' + escapeHTML(p.handle) + '" data-product=\'' + escapeHTML(JSON.stringify(p)) + '\' aria-pressed="true" aria-label="Remove ' + escapeHTML(p.title) + ' from wishlist">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.2-9.1C1.6 8.2 3.6 4.5 7.3 4.5c2 0 3.4 1.1 4.7 2.8 1.3-1.7 2.7-2.8 4.7-2.8 3.7 0 5.7 3.7 4.5 6.9-1.7 4.5-9.2 9.1-9.2 9.1z"/></svg></button></div>' +
          '<div class="card__body">' + (p.category ? '<p class="card__label">' + escapeHTML(p.category) + '</p>' : '') +
          '<h3 class="card__title"><a href="' + escapeHTML(p.url) + '" class="card__link">' + escapeHTML(p.title) + '</a></h3>' +
          '<div class="price"><span class="price__current">' + (p.price_varies ? '<span class="price__from">From </span>' : '') + price + '</span></div>' +
          '<div class="card__quick card__quick--button">' + action + '</div></div></article></li>';
      }).join('');
      syncWishlist();
    }
  }
  customElements.define('wishlist-grid', WishlistGrid);

  /* ------------------------------------------------------------------ */
  /* Quantity break cards set the quantity on the product form          */
  /* ------------------------------------------------------------------ */
  document.addEventListener('change', function (e) {
    var radio = e.target.closest('[data-qty-break]');
    if (!radio) return;
    var form = document.querySelector('product-info form[action*="/cart/add"], .pdp form[action*="/cart/add"]');
    var input = (form && form.querySelector('input[name="quantity"]')) || document.querySelector('.pdp input[name="quantity"]');
    if (input) { input.value = radio.value; input.dispatchEvent(new Event('change', { bubbles: true })); }
  });

  function init() {
    syncThemeButtons();
    syncWishlist();
    recordView();
    initReveals();
    initEstimates();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
