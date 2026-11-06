/* LuxeDealers theme script. No dependencies, no build step.
   Sections: utilities, motion (reveals, parallax, header), drawers, search,
   slideshow, rails, tabs, lookbook, product form and gallery, cart,
   quick view, collection filters, wishlist and recently viewed,
   newsletter popup and offers, localization, small extras. */
(function () {
  'use strict';

  var L = window.Luxe || {};
  var doc = document;
  var root = doc.documentElement;
  var reduceMotion = root.getAttribute('data-motion') === 'off' ||
    (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- Utilities ---------- */
  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function on(el, ev, fn, opts) { if (el) el.addEventListener(ev, fn, opts); }
  function debounce(fn, wait) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, wait); }; }
  function parseHTML(html) { return new DOMParser().parseFromString(html, 'text/html'); }
  function announce(msg) { var el = $('#A11yStatus'); if (el) { el.textContent = ''; setTimeout(function () { el.textContent = msg; }, 60); } }
  function storeGet(key, fallback) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function storeSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function fetchJSON(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, opts.headers || {});
    return fetch(url, opts).then(function (r) {
      return r.json().then(function (data) { if (!r.ok) { var err = new Error(data.description || data.message || 'Request failed'); err.data = data; throw err; } return data; });
    });
  }
  function formatMoney(cents) {
    var fmt = L.moneyFormat || '${{amount}}';
    cents = typeof cents === 'string' ? cents.replace('.', '') : cents;
    function fmtNum(n, dec, th, decSep) {
      n = (n / 100).toFixed(dec);
      var parts = n.split('.');
      return parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + th) + (parts[1] ? decSep + parts[1] : '');
    }
    return fmt.replace(/\{\{\s*(\w+)\s*\}\}/, function (m, key) {
      switch (key) {
        case 'amount_no_decimals': return fmtNum(cents, 0, ',', '.');
        case 'amount_with_comma_separator': return fmtNum(cents, 2, '.', ',');
        case 'amount_no_decimals_with_comma_separator': return fmtNum(cents, 0, '.', ',');
        case 'amount_with_apostrophe_separator': return fmtNum(cents, 2, "'", '.');
        default: return fmtNum(cents, 2, ',', '.');
      }
    }).replace(/[.,]00$/, '') + (L.currency ? ' ' + L.currency : '');
  }
  var lastFocus = null;
  function trapFocus(container, e) {
    if (e.key !== 'Tab') return;
    var f = $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])', container).filter(function (el) { return el.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  var locks = 0;
  function lockScroll() { if (locks++ === 0) { root.style.overflow = 'hidden'; } }
  function unlockScroll() { if (--locks <= 0) { locks = 0; root.style.overflow = ''; } }

  var toastTimer;
  function toast(msg) {
    var t = $('.toast');
    if (!t) { t = doc.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); doc.body.appendChild(t); }
    t.textContent = msg;
    requestAnimationFrame(function () { t.classList.add('is-visible'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-visible'); }, 2800);
  }

  /* ---------- Motion: reveals ---------- */
  function prepareSplit(ctx) {
    $$('[data-split]', ctx).forEach(function (el) {
      if (el.dataset.splitDone) return;
      el.dataset.splitDone = '1';
      var lines = el.innerHTML.split(/<br\s*\/?>/i);
      el.innerHTML = lines.map(function (line, i) { return '<span class="split-line" style="--l:' + i + '"><span>' + line.trim() + '</span></span>'; }).join('');
    });
  }
  var revealObserver = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('is-in'); revealObserver.unobserve(en.target); }
    });
  }, { rootMargin: '0px 0px -4% 0px', threshold: 0 }) : null;
  // Safety net: anything already on screen, or anything left when you reach the bottom, is shown.
  function revealVisible() {
    var vh = window.innerHeight, atEnd = window.innerHeight + window.scrollY >= doc.documentElement.scrollHeight - 40;
    $$('[data-reveal]:not(.is-in), [data-split]:not(.is-in)').forEach(function (el) {
      if (atEnd || el.getBoundingClientRect().top < vh) { el.classList.add('is-in'); if (revealObserver) revealObserver.unobserve(el); }
    });
  }
  window.addEventListener('scroll', function () { clearTimeout(revealVisible.t); revealVisible.t = setTimeout(revealVisible, 120); }, { passive: true });
  window.addEventListener('load', function () { setTimeout(revealVisible, 600); });
  function initReveals(ctx) {
    prepareSplit(ctx);
    $$('[data-stagger]', ctx).forEach(function (wrap) {
      $$(':scope > *', wrap).forEach(function (child, i) {
        if (!child.hasAttribute('data-reveal')) child.setAttribute('data-reveal', wrap.dataset.stagger || '');
        child.style.setProperty('--i', i % 8);
      });
    });
    var els = $$('[data-reveal]:not(.is-in), [data-split]:not(.is-in)', ctx);
    if (!revealObserver || reduceMotion) { els.forEach(function (el) { el.classList.add('is-in'); }); return; }
    els.forEach(function (el) { revealObserver.observe(el); });
  }

  /* ---------- Motion: parallax ---------- */
  var parallaxEls = [];
  function collectParallax() { parallaxEls = reduceMotion ? [] : $$('[data-parallax]'); }
  function updateParallax() {
    var vh = window.innerHeight;
    parallaxEls.forEach(function (el) {
      var r = el.parentElement.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) return;
      var p = ((r.top + r.height / 2) - vh / 2) / (vh / 2 + r.height / 2);
      el.style.setProperty('--py', Math.max(-1, Math.min(1, p)).toFixed(3));
    });
  }

  /* ---------- Header ---------- */
  var headerWrap = $('.header-wrapper');
  function measureHeader() { if (headerWrap && !headerWrap.classList.contains('is-scrolled')) root.style.setProperty('--header-total', headerWrap.offsetHeight + 'px'); }
  measureHeader();
  on(window, 'resize', debounce(measureHeader, 150));
  var toTop = $('.to-top');
  var ticking = false;
  var lastY = 0;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY;
      var max = doc.documentElement.scrollHeight - window.innerHeight;
      var prog = max > 0 ? y / max : 0;
      if (headerWrap) {
        headerWrap.classList.toggle('is-scrolled', y > 40);
        headerWrap.style.setProperty('--progress', prog.toFixed(4));
        if (headerWrap.dataset.hideOnScroll === 'true') {
          var down = y > lastY && y > 400 && !headerWrap.classList.contains('is-open');
          headerWrap.classList.toggle('is-hidden', down);
        }
      }
      lastY = y;
      updateStories();
      updateRunways();
      if (toTop) { toTop.classList.toggle('is-visible', y > window.innerHeight * 1.2); toTop.style.setProperty('--progress', prog.toFixed(4)); }
      updateParallax();
      ticking = false;
    });
  }
  on(window, 'scroll', onScroll, { passive: true });
  on(window, 'resize', debounce(onScroll, 100));
  on(toTop, 'click', function () { window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); });

  // Mega menu: hover opens via CSS; this adds click/keyboard support on touch.
  $$('.nav-item[data-has-mega]').forEach(function (item) {
    var link = $('.nav-link', item);
    on(link, 'click', function (e) {
      if (window.matchMedia('(hover: hover)').matches) return;
      if (!item.classList.contains('is-open')) { e.preventDefault(); $$('.nav-item.is-open').forEach(function (o) { o.classList.remove('is-open'); }); item.classList.add('is-open'); link.setAttribute('aria-expanded', 'true'); }
    });
    // Hover intent: open only after the pointer rests on the item, close with a short grace period.
    var openT, closeT;
    on(item, 'mouseenter', function () {
      clearTimeout(closeT);
      openT = setTimeout(function () {
        $$('.nav-item.is-open').forEach(function (o) { if (o !== item) o.classList.remove('is-open'); });
        item.classList.add('is-open'); link.setAttribute('aria-expanded', 'true');
      }, 220);
    });
    on(item, 'mouseleave', function () {
      clearTimeout(openT);
      closeT = setTimeout(function () { item.classList.remove('is-open'); link.setAttribute('aria-expanded', 'false'); }, 180);
    });
    on(item, 'focusin', function () { headerWrap && headerWrap.classList.add('is-open'); });
    on(item, 'focusout', function (e) { if (!item.contains(e.relatedTarget)) { item.classList.remove('is-open'); link.setAttribute('aria-expanded', 'false'); headerWrap && headerWrap.classList.remove('is-open'); } });
    $$('.mega__links li', item).forEach(function (li, i) { li.style.setProperty('--i', i % 12); });
  });
  on(doc, 'keydown', function (e) { if (e.key === 'Escape') $$('.nav-item.is-open').forEach(function (o) { o.classList.remove('is-open'); }); });

  /* ---------- Announcement rotator ---------- */
  $$('[data-rotator]').forEach(function (wrap) {
    var msgs = $$('.announcement__msg', wrap);
    if (msgs.length < 2) { if (msgs[0]) msgs[0].classList.add('is-active'); return; }
    var i = 0, delay = (parseInt(wrap.dataset.rotator, 10) || 5) * 1000;
    msgs[0].classList.add('is-active');
    var paused = false;
    on(wrap, 'mouseenter', function () { paused = true; });
    on(wrap, 'mouseleave', function () { paused = false; });
    setInterval(function () {
      if (paused || doc.hidden) return;
      var cur = msgs[i]; i = (i + 1) % msgs.length; var next = msgs[i];
      cur.classList.remove('is-active'); cur.classList.add('is-leaving');
      next.classList.remove('is-leaving'); next.classList.add('is-active');
      setTimeout(function () { cur.classList.remove('is-leaving'); }, 900);
    }, delay);
  });

  /* ---------- Drawers ---------- */
  function openDrawer(id, trigger) {
    var d = doc.getElementById(id);
    if (!d || d.classList.contains('is-open')) return;
    lastFocus = trigger || doc.activeElement;
    d.classList.add('is-open');
    d.setAttribute('aria-hidden', 'false');
    $$('.drawer__body > *', d).forEach(function (c, i) { c.style.setProperty('--i', Math.min(i, 8)); });
    lockScroll();
    var focusTarget = $('[data-autofocus]', d) || $('.drawer__panel, .search-overlay__panel, .popup__card, .menu-overlay__panel', d);
    setTimeout(function () { focusTarget && focusTarget.focus({ preventScroll: true }); }, 80);
    $$('[data-drawer-open="' + id + '"]').forEach(function (b) { b.setAttribute('aria-expanded', 'true'); });
  }
  function closeDrawer(d) {
    if (!d || !d.classList.contains('is-open')) return;
    d.classList.remove('is-open');
    d.setAttribute('aria-hidden', 'true');
    unlockScroll();
    $$('[data-drawer-open="' + d.id + '"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  on(doc, 'click', function (e) {
    var opener = e.target.closest('[data-drawer-open]');
    if (opener) { e.preventDefault(); openDrawer(opener.getAttribute('data-drawer-open'), opener); return; }
    var closer = e.target.closest('[data-drawer-close]');
    if (closer) { e.preventDefault(); closeDrawer(closer.closest('.drawer, .search-overlay, .popup, .menu-overlay')); }
  });
  on(doc, 'keydown', function (e) {
    var open = $$('.drawer.is-open, .search-overlay.is-open, .popup.is-open, .menu-overlay.is-open').pop();
    if (!open) return;
    if (e.key === 'Escape') closeDrawer(open);
    else trapFocus(open, e);
  });

  /* ---------- Predictive search ---------- */
  (function () {
    var wrap = $('#SearchOverlay');
    if (!wrap) return;
    var input = $('input[type="search"]', wrap);
    var results = $('[data-predictive]', wrap);
    var defaults = $('[data-search-defaults]', wrap);
    var ctrl;
    var run = debounce(function () {
      var q = input.value.trim();
      if (q.length < 2) { results.innerHTML = ''; results.hidden = true; if (defaults) defaults.hidden = false; return; }
      if (ctrl) ctrl.abort();
      ctrl = 'AbortController' in window ? new AbortController() : null;
      fetch(L.routes.predictiveSearch + '?q=' + encodeURIComponent(q) + '&resources[type]=product,collection,query,article&resources[limit]=8&section_id=predictive-search', ctrl ? { signal: ctrl.signal } : {})
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var d = parseHTML(html);
          var content = $('#predictive-search-results', d);
          results.innerHTML = content ? content.innerHTML : '';
          results.hidden = false;
          if (defaults) defaults.hidden = true;
          initReveals(results);
        }).catch(function () {});
    }, 220);
    on(input, 'input', run);
  })();

  /* ---------- Hero slideshow ---------- */
  $$('[data-slideshow]').forEach(function (hero) {
    var slides = $$('.hero__slide', hero);
    var dots = $$('.hero__dot', hero);
    var pauseBtn = $('[data-slideshow-pause]', hero);
    var autoplay = hero.dataset.autoplay === 'true' && slides.length > 1 && !reduceMotion;
    var speed = (parseInt(hero.dataset.speed, 10) || 7) * 1000;
    hero.style.setProperty('--autoplay', (speed / 1000) + 's');
    var index = 0, timer = null, paused = false;
    function playVideo(slide, play) { $$('video', slide).forEach(function (v) { if (play) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause(); }); }
    function go(n, user) {
      if (n === index && slides[n].classList.contains('is-active')) return;
      slides[index].classList.remove('is-active'); slides[index].setAttribute('aria-hidden', 'true'); playVideo(slides[index], false);
      if (dots[index]) { dots[index].classList.remove('is-active'); dots[index].removeAttribute('aria-current'); }
      index = (n + slides.length) % slides.length;
      var s = slides[index];
      s.classList.add('is-active'); s.removeAttribute('aria-hidden'); playVideo(s, true);
      $$('.split-line', s).forEach(function (l) { l.classList.remove('is-in'); void l.offsetWidth; l.classList.add('is-in'); });
      if (dots[index]) { var d = dots[index]; d.classList.remove('is-active'); void d.offsetWidth; d.classList.add('is-active'); d.setAttribute('aria-current', 'true'); }
      if (user) restart();
    }
    function restart() { clearInterval(timer); if (autoplay && !paused) timer = setInterval(function () { go(index + 1); }, speed); }
    dots.forEach(function (d, i) { on(d, 'click', function () { go(i, true); }); });
    on(pauseBtn, 'click', function () {
      paused = !paused; hero.classList.toggle('is-paused', paused);
      pauseBtn.setAttribute('aria-label', paused ? pauseBtn.dataset.playLabel : pauseBtn.dataset.pauseLabel);
      pauseBtn.querySelector('[data-icon-pause]').hidden = paused; pauseBtn.querySelector('[data-icon-play]').hidden = !paused;
      if (paused) clearInterval(timer); else restart();
    });
    on(hero, 'mouseenter', function () { if (autoplay && !paused) { clearInterval(timer); hero.classList.add('is-paused'); } });
    on(hero, 'mouseleave', function () { if (autoplay && !paused) { hero.classList.remove('is-paused'); restart(); } });
    var x0 = null;
    on(hero, 'touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    on(hero, 'touchend', function (e) { if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1), true); x0 = null; });
    on(doc, 'visibilitychange', function () { if (doc.hidden) clearInterval(timer); else restart(); });
    slides.forEach(function (s, i) { if (i) s.setAttribute('aria-hidden', 'true'); });
    if (slides[0]) { slides[0].classList.add('is-active'); playVideo(slides[0], true); }
    if (dots[0]) dots[0].classList.add('is-active');
    requestAnimationFrame(function () { $$('.split-line', slides[0]).forEach(function (l) { l.classList.add('is-in'); }); });
    restart();
  });

  /* ---------- Rails ---------- */
  function initRails(ctx) {
    $$('[data-rail]', ctx).forEach(function (rail) {
      if (rail.dataset.railReady) return;
      rail.dataset.railReady = '1';
      var track = $('.rail__track', rail);
      var prev = $('[data-rail-prev]', rail.closest('section') || rail);
      var next = $('[data-rail-next]', rail.closest('section') || rail);
      var bar = $('.rail__progress span', rail);
      if (!track) return;
      function step() { var c = track.firstElementChild; return c ? c.getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap || 0) : track.clientWidth; }
      function update() {
        if (!visible()) return;
        var max = track.scrollWidth - track.clientWidth;
        if (prev) prev.disabled = track.scrollLeft <= 2;
        if (next) next.disabled = track.scrollLeft >= max - 2;
        rail.classList.toggle('at-start', track.scrollLeft <= 2);
        rail.classList.toggle('at-end', track.scrollLeft >= max - 2);
        rail.classList.toggle('no-scroll', max <= 2);
        if (bar) {
          var w = max > 0 ? track.clientWidth / track.scrollWidth : 1;
          bar.style.setProperty('--w', (w * 100) + '%');
          bar.style.setProperty('--x', (max > 0 ? (track.scrollLeft / max) * ((1 - w) / w) * 100 : 0) + '%');
        }
      }
      function visible() { return !rail.closest('[hidden]'); }
      on(prev, 'click', function () { if (visible()) track.scrollBy({ left: -step(), behavior: 'smooth' }); });
      on(next, 'click', function () { if (visible()) track.scrollBy({ left: step(), behavior: 'smooth' }); });
      // Carousel arrows on the sides of the row
      var sides = ['prev', 'next'].map(function (dir) {
        var b = doc.createElement('button');
        b.type = 'button'; b.className = 'rail__side rail__side--' + dir; b.tabIndex = -1;
        b.setAttribute('aria-hidden', 'true');
        b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + (dir === 'prev' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7') + '"/></svg>';
        on(b, 'click', function () { track.scrollBy({ left: (dir === 'prev' ? -1 : 1) * step() * (window.innerWidth < 750 ? 1 : 2), behavior: 'smooth' }); });
        rail.appendChild(b);
        return b;
      });
      // Drag with the mouse, like a carousel (touch already swipes natively)
      var drag = null, moved = false;
      on(track, 'pointerdown', function (e) {
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        drag = { x: e.clientX, left: track.scrollLeft }; moved = false;
      });
      on(window, 'pointermove', function (e) {
        if (!drag) return;
        var dx = e.clientX - drag.x;
        if (!moved && Math.abs(dx) > 6) { moved = true; track.classList.add('is-dragging'); }
        if (moved) { track.scrollLeft = drag.left - dx; e.preventDefault(); }
      });
      on(window, 'pointerup', function () {
        if (!drag) return;
        drag = null;
        if (moved) { track.classList.remove('is-dragging'); var s = step(); track.scrollTo({ left: Math.round(track.scrollLeft / s) * s, behavior: 'smooth' }); }
      });
      on(track, 'click', function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
      on(track, 'dragstart', function (e) { e.preventDefault(); });
      on(track, 'scroll', debounce(update, 30), { passive: true });
      on(window, 'resize', debounce(update, 150));
      update();
    });
  }

  /* ---------- Tabs ---------- */
  $$('[data-tabs]').forEach(function (wrap) {
    var tabs = $$('[role="tab"]', wrap);
    function select(tab) {
      tabs.forEach(function (t) {
        var sel = t === tab;
        t.setAttribute('aria-selected', sel ? 'true' : 'false');
        t.tabIndex = sel ? 0 : -1;
        var panel = doc.getElementById(t.getAttribute('aria-controls'));
        if (panel) { panel.hidden = !sel; if (sel) { initRails(panel); initReveals(panel); } }
      });
    }
    tabs.forEach(function (t, i) {
      on(t, 'click', function () { select(t); });
      on(t, 'keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; n.focus(); select(n); }
      });
    });
  });

  /* ---------- Lookbook hotspots ---------- */
  $$('[data-lookbook]').forEach(function (lb) {
    var spots = $$('.hotspot', lb), items = $$('.look-item', lb);
    function activate(n) {
      spots.forEach(function (s, i) { s.classList.toggle('is-active', i === n); var b = $('button', s); if (b) b.setAttribute('aria-pressed', i === n ? 'true' : 'false'); });
      items.forEach(function (it, i) { it.classList.toggle('is-active', i === n); });
    }
    spots.forEach(function (s, i) { on($('button', s), 'click', function () { activate(i); if (items[i] && window.innerWidth < 990) items[i].scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' }); }); on(s, 'mouseenter', function () { activate(i); }); });
    items.forEach(function (it, i) { on(it, 'mouseenter', function () { activate(i); }); on(it, 'focusin', function () { activate(i); }); });
    if (spots.length) activate(0);
  });

  /* ---------- Cart ---------- */
  var cartDrawer = function () { return doc.getElementById('CartDrawer'); };
  function cartSections() {
    var ids = ['cart-drawer', 'cart-count'];
    if ($('#main-cart')) ids.push($('#main-cart').dataset.sectionId);
    return ids;
  }
  // Free-shipping bar for shoppers paying in another currency: the threshold is set in the store's currency,
  // so convert it with the rate Shopify uses on this page.
  function initShipBars(root) {
    var rate = parseFloat((window.Shopify && Shopify.currency && Shopify.currency.rate) || 0);
    $$('[data-ship-bar]', root).forEach(function (bar) {
      if (!rate) return;
      var limit = Math.round(parseInt(bar.dataset.threshold, 10) * rate), total = parseInt(bar.dataset.total, 10) || 0, left = limit - total;
      var fmt = new Intl.NumberFormat(doc.documentElement.lang || undefined, { style: 'currency', currency: bar.dataset.currency, currencyDisplay: 'narrowSymbol' });
      // Only while the cart is short of free shipping; once it qualifies, the totals say Free.
      if (left <= 0) { bar.hidden = true; return; }
      $('span', bar).textContent = bar.dataset.remaining.replace('%AMOUNT%', fmt.format(left / 100).replace(/[.,]00$/, ''));
      $('.ship-bar__fill', bar).style.setProperty('--pct', Math.floor(total * 100 / limit) + '%');
      bar.hidden = false;
    });
    $$('[data-ship-cost]', root).forEach(function (el) {
      if (!rate) return;
      var limit = Math.round(parseInt(el.dataset.threshold, 10) * rate), fee = parseInt(el.dataset.fee, 10) * rate;
      var fmt = new Intl.NumberFormat(doc.documentElement.lang || undefined, { style: 'currency', currency: el.dataset.currency, currencyDisplay: 'narrowSymbol' });
      var free = (parseInt(el.dataset.total, 10) || 0) >= limit;
      el.textContent = free ? el.dataset.free : fmt.format(Math.round(fee) / 100);
      el.className = free ? 'bag-totals__free' : '';
    });
  }
  initShipBars(doc);
  function renderSections(sections) {
    if (!sections) return;
    if (sections['cart-drawer']) {
      var d = parseHTML(sections['cart-drawer']);
      var fresh = $('[data-cart-drawer-inner]', d), cur = $('[data-cart-drawer-inner]');
      if (fresh && cur) cur.innerHTML = fresh.innerHTML;
    }
    if (sections['cart-count']) {
      var c = parseHTML(sections['cart-count']);
      var n = $('[data-cart-count-value]', c);
      var count = n ? parseInt(n.textContent, 10) || 0 : 0;
      $$('[data-cart-count]').forEach(function (el) {
        el.textContent = count; el.hidden = count === 0;
        el.classList.remove('is-bump'); void el.offsetWidth; el.classList.add('is-bump');
      });
      var tv = $('[data-cart-total-value]', c);
      if (tv) $$('[data-cart-total]').forEach(function (el) { el.textContent = tv.textContent; });
    }
    var main = $('#main-cart');
    if (main && sections[main.dataset.sectionId]) {
      var m = parseHTML(sections[main.dataset.sectionId]);
      var freshMain = $('#main-cart', m);
      if (freshMain) main.innerHTML = freshMain.innerHTML;
    }
    initShipBars(doc);
  }
  function addToCart(items, btn) {
    if (btn) { btn.classList.add('is-loading'); btn.setAttribute('aria-busy', 'true'); }
    return fetchJSON(L.routes.cartAdd, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items, sections: cartSections(), sections_url: window.location.pathname })
    }).then(function (res) {
      if (L.cartType === 'page' && !$('#main-cart')) { window.location.href = L.routes.cart; return res; }
      renderSections(res.sections);
      (res.items || []).forEach(function (it) { beacon({ t: 'cart', h: it.handle, p: String(it.product_id), ti: it.product_title }); });
      var open = $$('.popup.is-open'); open.forEach(closeDrawer);
      openDrawer('CartDrawer', btn);
      announce(L.strings.added);
      return res;
    }).catch(function (err) {
      toast((err.data && (err.data.description || err.data.message)) || err.message);
      throw err;
    }).finally(function () { if (btn) { btn.classList.remove('is-loading'); btn.removeAttribute('aria-busy'); } });
  }
  function changeLine(key, qty, lineEl) {
    if (lineEl) lineEl.classList.add('is-removing');
    return fetchJSON(L.routes.cartChange, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: key, quantity: qty, sections: cartSections(), sections_url: window.location.pathname })
    }).then(function (res) { renderSections(res.sections); })
      .catch(function (err) { if (lineEl) lineEl.classList.remove('is-removing'); toast((err.data && err.data.description) || err.message); });
  }
  on(doc, 'click', function (e) {
    var rm = e.target.closest('[data-line-remove]');
    if (rm) { e.preventDefault(); changeLine(rm.dataset.lineRemove, 0, rm.closest('.cart-line')); return; }
    var qb = e.target.closest('[data-qty-step]');
    if (qb) {
      var box = qb.closest('.qty'), input = $('input', box);
      var v = Math.max(parseInt(input.min || 0, 10), (parseInt(input.value, 10) || 0) + parseInt(qb.dataset.qtyStep, 10));
      input.value = v;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  on(doc, 'change', debounce(function (e) {
    var input = e.target.closest('[data-line-qty]');
    if (input) changeLine(input.dataset.lineQty, parseInt(input.value, 10) || 0, input.closest('.cart-line'));
  }, 350));
  on(doc, 'change', debounce(function (e) {
    var note = e.target.closest('[data-cart-note]');
    if (note) fetchJSON(L.routes.cartUpdate, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: note.value }) }).catch(function () {});
  }, 400));
  // Upsell / quick add buttons with a single variant id.
  on(doc, 'click', function (e) {
    var b = e.target.closest('[data-add-variant]');
    if (!b) return;
    e.preventDefault();
    addToCart([{ id: parseInt(b.dataset.addVariant, 10), quantity: 1 }], b).catch(function () {});
  });

  /* ---------- Product form and variants ---------- */
  function initProduct(ctx) {
    $$('[data-product]', ctx).forEach(function (wrap) {
      if (wrap.dataset.productReady) return;
      wrap.dataset.productReady = '1';
      var dataEl = $('[data-product-json]', wrap);
      if (!dataEl) return;
      var data = JSON.parse(dataEl.textContent);
      var form = $('form[data-product-form]', wrap);
      var idInput = form && $('input[name="id"]', form);
      var addBtn = form && $('[data-add-button]', form);
      var addLabel = addBtn && $('[data-add-label]', addBtn);
      var priceEl = $('[data-price]', wrap);
      var stockEl = $('[data-stock]', wrap);
      var skuEl = $('[data-sku]', wrap);
      var optionLabels = $$('[data-option-label]', wrap);
      var gallery = $('[data-gallery]', wrap);
      var sticky = doc.querySelector('[data-sticky-atc]');
      var updateUrl = wrap.dataset.updateUrl === 'true';

      function currentOptions() {
        return $$('fieldset[data-option-index]', wrap).map(function (fs) {
          var c = $('input:checked', fs); return c ? c.value : null;
        });
      }
      function findVariant(opts) {
        return data.variants.find(function (v) { return v.options.every(function (o, i) { return o === opts[i]; }); });
      }
      function markAvailability(opts) {
        $$('fieldset[data-option-index]', wrap).forEach(function (fs) {
          var idx = parseInt(fs.dataset.optionIndex, 10);
          $$('input', fs).forEach(function (inp) {
            var test = opts.slice(); test[idx] = inp.value;
            var match = data.variants.find(function (v) { return v.options.every(function (o, i) { return o === test[i]; }) && v.available; });
            var lbl = inp.nextElementSibling;
            if (lbl) lbl.classList.toggle('is-unavailable', !match);
          });
        });
      }
      function update() {
        var opts = currentOptions();
        optionLabels.forEach(function (l, i) { l.textContent = opts[i] || ''; });
        var v = findVariant(opts);
        markAvailability(opts);
        if (!v) {
          if (addBtn) { addBtn.disabled = true; addLabel.textContent = L.strings.unavailable; }
          if (stockEl) { stockEl.hidden = true; }
          return;
        }
        if (idInput) { idInput.value = v.id; idInput.dispatchEvent(new Event('change', { bubbles: true })); }
        if (addBtn) { addBtn.disabled = !v.available; addLabel.textContent = v.available ? L.strings.addToBag : L.strings.soldOut; }
        if (priceEl) {
          var html = '<span class="price__current">' + formatMoney(v.price) + '</span>';
          if (v.compare_at_price > v.price) html = '<span class="price__current">' + formatMoney(v.price) + '</span><s class="price__compare">' + formatMoney(v.compare_at_price) + '</s>';
          priceEl.innerHTML = html;
          priceEl.classList.toggle('price--sale', v.compare_at_price > v.price);
        }
        if (skuEl) { skuEl.textContent = v.sku || ''; skuEl.parentElement.hidden = !v.sku; }
        if (stockEl) {
          var inv = data.inventory && data.inventory[v.id];
          var threshold = parseInt(stockEl.dataset.threshold, 10) || 0;
          stockEl.hidden = false;
          stockEl.className = 'stock';
          if (!v.available) { stockEl.classList.add('stock--out'); stockEl.textContent = stockEl.dataset.out; }
          else if (inv && inv.managed && inv.qty > 0 && threshold > 0 && inv.qty <= threshold) { stockEl.classList.add('stock--low'); stockEl.textContent = stockEl.dataset.low.replace('[count]', inv.qty); }
          else if (inv && inv.managed && inv.qty <= 0 && inv.policy === 'continue') { stockEl.classList.add('stock--low'); stockEl.textContent = stockEl.dataset.backorder; }
          else { stockEl.textContent = stockEl.dataset.in; }
        }
        if (v.featured_media && gallery) { gallery.dispatchEvent(new CustomEvent('gallery:go', { detail: v.featured_media.id })); }
        else if (v.featured_media && v.featured_media.src) {
          // Quick view: the photo sits beside the form, not in a gallery. Swap it to the chosen style.
          var qv = wrap.closest('[data-quick-view-content]') || wrap.parentElement;
          var qimg = qv && $('.quick-view__media img', qv);
          if (qimg && qimg.getAttribute('src') !== v.featured_media.src) { qimg.removeAttribute('srcset'); qimg.src = v.featured_media.src; }
        }
        if (updateUrl) { var url = new URL(window.location.href); url.searchParams.set('variant', v.id); history.replaceState({}, '', url.toString()); }
        if (sticky) { var sb = $('[data-add-button]', sticky); if (sb) { sb.disabled = !v.available; $('[data-add-label]', sb).textContent = v.available ? L.strings.addToBag : L.strings.soldOut; } var sp = $('[data-price]', sticky); if (sp && priceEl) sp.innerHTML = priceEl.innerHTML; }
      }
      on(wrap, 'change', function (e) { if (e.target.closest('fieldset[data-option-index]')) update(); });
      if ($$('fieldset[data-option-index]', wrap).length) markAvailability(currentOptions());

      if (form) on(form, 'submit', function (e) {
        e.preventDefault();
        var fd = new FormData(form);
        var item = { id: parseInt(fd.get('id'), 10), quantity: parseInt(fd.get('quantity') || '1', 10) };
        var props = {};
        fd.forEach(function (val, key) { var m = key.match(/^properties\[(.+)\]$/); if (m && val) props[m[1]] = val; });
        if (Object.keys(props).length) item.properties = props;
        addToCart([item], addBtn).catch(function () {});
      });

      if (sticky && addBtn && 'IntersectionObserver' in window) {
        new IntersectionObserver(function (en) { var on = !en[0].isIntersecting && en[0].boundingClientRect.top < 0; sticky.classList.toggle('is-visible', on); doc.documentElement.classList.toggle('atc-on', on); }).observe(addBtn);
        on($('[data-add-button]', sticky), 'click', function (e) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : addBtn.click(); });
      }
      initGallery(wrap);
    });
  }

  /* ---------- Gallery: swipe, dots, hover zoom, lightbox ---------- */
  function initGallery(ctx) {
    $$('[data-gallery]', ctx).forEach(function (g) {
      if (g.dataset.galleryReady) return;
      g.dataset.galleryReady = '1';
      var track = $('.gallery__main', g);
      var slides = $$('.gallery__slide', g);
      var dots = $$('.gallery__dot', g);
      var count = $('[data-gallery-count]', g);
      var thumbs = $('.gallery__thumbs', g), cur = 0;
      function setActive(i) {
        cur = i;
        dots.forEach(function (d, n) { d.setAttribute('aria-current', n === i ? 'true' : 'false'); });
        if (count) count.textContent = (i + 1) + ' / ' + slides.length;
        if (thumbs && dots[i]) {
          var d = dots[i], vertical = thumbs.scrollHeight > thumbs.clientHeight + 2;
          if (vertical) thumbs.scrollTo({ top: d.offsetTop - thumbs.clientHeight / 2 + d.clientHeight / 2, behavior: 'smooth' });
          else thumbs.scrollTo({ left: d.offsetLeft - thumbs.clientWidth / 2 + d.clientWidth / 2, behavior: 'smooth' });
        }
      }
      function goTo(i) { i = Math.max(0, Math.min(slides.length - 1, i)); track.scrollTo({ left: i * track.clientWidth, behavior: reduceMotion ? 'auto' : 'smooth' }); setActive(i); }
      on($('[data-gallery-prev]', g), 'click', function () { goTo(cur - 1); });
      on($('[data-gallery-next]', g), 'click', function () { goTo(cur + 1); });
      on(track, 'keydown', function (e) { if (e.key === 'ArrowRight') { e.preventDefault(); goTo(cur + 1); } if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(cur - 1); } });
      on(track, 'scroll', debounce(function () { setActive(Math.round(track.scrollLeft / track.clientWidth)); }, 50), { passive: true });
      dots.forEach(function (d, i) { on(d, 'click', function () { track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' }); }); });
      on(g, 'gallery:go', function (e) {
        var idx = slides.findIndex(function (s) { return s.dataset.mediaId == e.detail; });
        if (idx < 0) return;
        if (getComputedStyle(track).gridAutoFlow.indexOf('column') === 0) track.scrollTo({ left: idx * track.clientWidth, behavior: reduceMotion ? 'auto' : 'smooth' });
        else if (idx > 0) slides[idx].scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        setActive(idx);
      });
      // Hover zoom on desktop: the image follows the pointer.
      if (window.matchMedia('(hover: hover) and (min-width: 990px)').matches && g.dataset.zoom === 'true') {
        slides.forEach(function (s) {
          var img = $('img', s);
          if (!img) return;
          on(s, 'mousemove', function (e) { var r = s.getBoundingClientRect(); img.style.transformOrigin = ((e.clientX - r.left) / r.width * 100) + '% ' + ((e.clientY - r.top) / r.height * 100) + '%'; });
          on(s, 'mouseenter', function () { s.classList.add('is-zooming'); });
          on(s, 'mouseleave', function () { s.classList.remove('is-zooming'); });
        });
      }
      var lb = $('[data-lightbox]', g);
      if (lb) {
        slides.forEach(function (s, i) {
          on(s, 'click', function (e) {
            if (e.target.closest('video, model-viewer, iframe, button')) return;
            $$('img[data-lb-src]', lb).forEach(function (im) { if (!im.getAttribute('src')) im.src = im.dataset.lbSrc; });
            lb.classList.add('is-open'); lockScroll();
            var lbTrack = $('.lightbox__track', lb);
            requestAnimationFrame(function () { lbTrack.scrollLeft = i * lbTrack.clientWidth; $('.lightbox__close', lb).focus(); });
          });
        });
        on($('.lightbox__close', lb), 'click', function () { lb.classList.remove('is-open'); unlockScroll(); });
        on(lb, 'keydown', function (e) { if (e.key === 'Escape') { lb.classList.remove('is-open'); unlockScroll(); } });
      }
    });
  }

  /* ---------- Quick view ---------- */
  on(doc, 'click', function (e) {
    var b = e.target.closest('[data-quick-view]');
    if (!b) return;
    e.preventDefault();
    var modal = doc.getElementById('QuickView');
    if (!modal) return;
    var body = $('[data-quick-view-body]', modal);
    body.innerHTML = '<div class="quick-view__loading"><span class="btn btn--outline is-loading" aria-hidden="true">.</span></div>';
    openDrawer('QuickView', b);
    fetch(b.dataset.quickView + (b.dataset.quickView.indexOf('?') > -1 ? '&' : '?') + 'section_id=quick-view-product')
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var d = parseHTML(html);
        var inner = $('[data-quick-view-content]', d);
        body.innerHTML = inner ? inner.innerHTML : '';
        initProduct(body);
        initDispatch(body);
        initReveals(body);
        var first = $('select, input, button', body); if (first) first.focus({ preventScroll: true });
      });
  });

  /* ---------- Collection filters, sort and load more ---------- */
  (function () {
    var root_ = $('[data-collection]');
    if (!root_) return;
    var sectionId = root_.dataset.sectionId;
    function render(url, push) {
      var grid = $('[data-collection-grid]');
      if (grid) grid.classList.add('is-loading');
      var u = new URL(url, window.location.origin);
      u.searchParams.set('section_id', sectionId);
      fetch(u.toString()).then(function (r) { return r.text(); }).then(function (html) {
        var d = parseHTML(html);
        ['[data-collection-grid]', '[data-facets]', '[data-active-filters]', '[data-product-count]', '[data-load-more]', '[data-facets-mobile]'].forEach(function (sel) {
          var fresh = $(sel, d); $$(sel).forEach(function (cur) { if (fresh) cur.innerHTML = fresh.innerHTML; });
        });
        u.searchParams.delete('section_id');
        if (push) history.pushState({ facets: true }, '', u.toString());
        initReveals(); initWishButtons();
      }).finally(function () { var g = $('[data-collection-grid]'); if (g) g.classList.remove('is-loading'); });
    }
    function formUrl(form) {
      var fd = new FormData(form), params = new URLSearchParams();
      fd.forEach(function (v, k) { if (v !== '') params.append(k, v); });
      var sort = $('[data-sort]'); if (sort && sort.value) params.set('sort_by', sort.value);
      return window.location.pathname + '?' + params.toString();
    }
    on(doc, 'change', debounce(function (e) {
      var f = e.target.closest('form[data-facet-form]');
      if (f) { render(formUrl(f), true); return; }
      if (e.target.matches('[data-sort]')) {
        var url = new URL(window.location.href); url.searchParams.set('sort_by', e.target.value); url.searchParams.delete('page');
        render(url.pathname + url.search, true);
      }
    }, 300));
    on(doc, 'submit', function (e) { var f = e.target.closest('form[data-facet-form]'); if (f) { e.preventDefault(); render(formUrl(f), true); } });
    on(doc, 'click', function (e) {
      var a = e.target.closest('[data-facet-link]');
      if (a) { e.preventDefault(); render(a.getAttribute('href'), true); return; }
      var gs = e.target.closest('[data-grid-cols]');
      if (gs) {
        $$('[data-grid-cols]').forEach(function (b) { b.setAttribute('aria-pressed', b === gs ? 'true' : 'false'); });
        var g = $('.product-grid', $('[data-collection-grid]'));
        if (g) g.classList.toggle('product-grid--4', gs.dataset.gridCols === '4');
        storeSet('luxe:grid', gs.dataset.gridCols);
      }
    });
    on(window, 'popstate', function (e) { if (e.state && e.state.facets) render(window.location.href, false); });

    // Infinite load: fetch the next page when the sentinel scrolls into view.
    function initLoadMore() {
      var btn = $('[data-load-more] a[data-next]');
      if (!btn || !('IntersectionObserver' in window)) return;
      var io = new IntersectionObserver(function (en) {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        btn.classList.add('is-loading');
        var u = new URL(btn.href, window.location.origin); u.searchParams.set('section_id', sectionId);
        fetch(u.toString()).then(function (r) { return r.text(); }).then(function (html) {
          var d = parseHTML(html);
          var grid = $('[data-collection-grid] .product-grid'), freshGrid = $('[data-collection-grid] .product-grid', d);
          if (grid && freshGrid) $$(':scope > *', freshGrid).forEach(function (c) { grid.appendChild(c); });
          var lm = $('[data-load-more]'), freshLm = $('[data-load-more]', d);
          if (lm) lm.innerHTML = freshLm ? freshLm.innerHTML : '';
          initReveals(); initWishButtons(); initLoadMore();
        });
      }, { rootMargin: '400px' });
      io.observe(btn);
    }
    initLoadMore();
    var saved = storeGet('luxe:grid', null);
    if (saved === '4') { var b4 = $('[data-grid-cols="4"]'); if (b4) b4.click(); }
  })();

  /* ---------- Wishlist (stored on the shopper's device) ---------- */
  var WISH = 'luxe:wishlist';
  function wishList() { return storeGet(WISH, []); }
  function initWishButtons(ctx) {
    var list = wishList();
    $$('[data-wish]', ctx).forEach(function (b) { b.setAttribute('aria-pressed', list.indexOf(b.dataset.wish) > -1 ? 'true' : 'false'); });
    $$('[data-wish-count]').forEach(function (el) { el.textContent = list.length; el.hidden = list.length === 0; });
  }
  on(doc, 'click', function (e) {
    var b = e.target.closest('[data-wish]');
    if (!b) return;
    e.preventDefault();
    var list = wishList(), h = b.dataset.wish, i = list.indexOf(h);
    if (i > -1) list.splice(i, 1); else list.unshift(h);
    storeSet(WISH, list.slice(0, 60));
    initWishButtons();
    toast(i > -1 ? b.dataset.removedText || 'Removed from wishlist' : b.dataset.addedText || 'Saved to wishlist');
    beacon({ t: i === -1 ? 'wishlist' : 'unwishlist', h: h });
  });
  function renderHandles(container, handles, emptyEl) {
    if (!container) return;
    if (!handles.length) { if (emptyEl) emptyEl.hidden = false; container.closest('[data-handle-section]') && (container.closest('[data-handle-section]').hidden = !emptyEl); return; }
    Promise.all(handles.map(function (h) {
      return fetch(L.routes.root.replace(/\/$/, '') + '/products/' + encodeURIComponent(h) + '?view=card').then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; });
    })).then(function (htmls) {
      var html = htmls.filter(Boolean).join('');
      if (!html) { if (emptyEl) emptyEl.hidden = false; return; }
      container.innerHTML = html;
      var sec = container.closest('[data-handle-section]'); if (sec) sec.hidden = false;
      initReveals(container); initWishButtons(container); initRails(sec || container); window.dispatchEvent(new Event('resize'));
    });
  }
  $$('[data-wishlist-grid]').forEach(function (g) { renderHandles(g, wishList(), $('[data-wishlist-empty]')); });

  // Wishlist drawer: built from the products' live data each time it opens.
  function renderWishDrawer() {
    var listEl = $('[data-wish-drawer-list]'), empty = $('[data-wish-drawer-empty]'), countEl = $('[data-wish-count-text]');
    if (!listEl) return;
    var handles = wishList();
    if (countEl) countEl.textContent = handles.length ? '(' + handles.length + ')' : '';
    empty.hidden = handles.length > 0;
    if (!handles.length) { listEl.innerHTML = ''; return; }
    var base = L.routes.root.replace(/\/$/, '');
    Promise.all(handles.map(function (h) { return fetchJSON(base + '/products/' + encodeURIComponent(h) + '.js').catch(function () { return null; }); })).then(function (ps) {
      listEl.innerHTML = ps.filter(Boolean).map(function (p) {
        var img = p.featured_image ? p.featured_image + (p.featured_image.indexOf('?') > -1 ? '&' : '?') + 'width=200' : '';
        var v = (p.variants || []).filter(function (x) { return x.available; })[0];
        var single = p.variants && p.variants.length === 1;
        return '<li class="wish-item"><a class="wish-item__img" href="' + p.url + '">' + (img ? '<img src="' + img + '" alt="" width="88" height="88" loading="lazy">' : '') + '</a>' +
          '<div class="wish-item__info"><a class="wish-item__title" href="' + p.url + '">' + escapeHTML(p.title) + '</a><strong>' + formatMoney(p.price) + '</strong>' +
          '<div class="wish-item__actions">' + (v && single ? '<button type="button" class="btn btn--sm btn--gold" data-add-variant="' + v.id + '">' + escapeHTML(L.strings.addToBag) + '</button>' : '<a class="btn btn--sm btn--gold" href="' + p.url + '">' + escapeHTML(L.strings.view || 'View') + '</a>') +
          '<button type="button" class="link" data-wish="' + p.handle + '">' + escapeHTML(L.strings.remove || 'Remove') + '</button></div></div></li>';
      }).join('');
    });
  }
  on(doc, 'click', function (e) { if (e.target.closest('[data-drawer-open="WishlistDrawer"]')) setTimeout(renderWishDrawer, 0); else if (e.target.closest('#WishlistDrawer [data-wish]')) setTimeout(renderWishDrawer, 50); });

  /* ---------- Recently viewed ---------- */
  var RV = 'luxe:viewed';
  var current = $('[data-product-handle]');
  if (current) {
    var h = current.dataset.productHandle, rv = storeGet(RV, []).filter(function (x) { return x !== h; });
    rv.unshift(h); storeSet(RV, rv.slice(0, 16));
    beacon({ t: 'view', h: h, p: current.dataset.productId, ti: current.dataset.productTitle });
  }
  $$('[data-recently-viewed]').forEach(function (g) {
    var exclude = current ? current.dataset.productHandle : null;
    var limit = parseInt(g.dataset.limit, 10) || 8;
    renderHandles(g, storeGet(RV, []).filter(function (x) { return x !== exclude; }).slice(0, limit), null);
  });

  /* No product appears in two rows: "You might also like" wins, "More from" fills with others. */
  function dedupeRows() {
    var seen = {}, cur = $('[data-product-handle]');
    if (cur) seen[cur.dataset.productHandle] = 1;
    $$('[data-product-recs] .card, [data-product-more] .card, .bset__item').forEach(function (card) {
      var w = $('[data-wish]', card), a = $('a[href*="/products/"]', card);
      var h = w ? w.dataset.wish : (a ? (a.getAttribute('href').split('/products/')[1] || '').split(/[?#]/)[0] : '');
      if (!h) return;
      if (seen[h] && !card.classList.contains('bset__item')) { card.remove(); return; }
      seen[h] = 1;
    });
    $$('[data-product-more], [data-product-recs]').forEach(function (s) { if (!$('.card', s)) s.hidden = true; });
  }
  dedupeRows();

  /* ---------- Product recommendations ---------- */
  $$('[data-recommendations]').forEach(function (el) {
    fetch(el.dataset.url).then(function (r) { return r.text(); }).then(function (html) {
      var d = parseHTML(html);
      var sec = $('.shopify-section section', d) || $('section', d);
      if (!sec) return;
      el.replaceWith(sec);
      initReveals(sec); initRails(sec); initWishButtons(sec);
      dedupeRows();
    }).catch(function () {});
  });

  /* ---------- "From $X" labels: lowest price per collection, fetched once and cached ---------- */
  (function () {
    var els = $$('[data-from-price]');
    if (!els.length) return;
    var cache = storeGet('luxe:from', {}), day = 6 * 3600 * 1000, base = L.routes.root.replace(/\/$/, '');
    var handles = {};
    els.forEach(function (el) { handles[el.dataset.fromPrice] = true; });
    Object.keys(handles).forEach(function (h) {
      var fill = function (v) { $$('[data-from-price="' + h + '"]').forEach(function (el) { el.textContent = v; var p = el.closest('.tile__from, [data-from-wrap]'); if (p) p.classList.toggle('is-ready', !!v); }); };
      var c = cache[h];
      if (c && Date.now() - c.t < day) return fill(c.v);
      fetch(base + '/collections/' + encodeURIComponent(h) + '?sort_by=price-ascending&view=minprice').then(function (r) { return r.ok ? r.text() : ''; }).then(function (v) {
        v = (v || '').replace(/<[^>]*>/g, '').trim();
        if (v.length > 24) v = '';
        cache[h] = { v: v, t: Date.now() }; storeSet('luxe:from', cache); fill(v);
      }).catch(function () {});
    });
  })();

  /* ---------- Buy more, save more (product page) ---------- */
  $$('[data-qty-breaks]').forEach(function (box) {
    var form = doc.getElementById(box.dataset.form);
    if (!form) return;
    var qtyInput = $('input[name="quantity"]', form);
    var json = $('[data-product-json]'), data = null;
    try { data = json ? JSON.parse(json.textContent) : null; } catch (e) {}
    function refresh(price) {
      $$('input[type="radio"]', box).forEach(function (r) {
        var n = parseInt(r.value, 10), pc = parseInt(r.dataset.pct, 10) || 0, lab = r.closest('.qtyb__opt');
        var each = Math.round(price * (100 - pc) / 100);
        var tot = $('[data-qtyb-total]', lab), was = $('[data-qtyb-was]', lab), sm = $('small', lab);
        if (tot) tot.textContent = formatMoney(each * n);
        if (was) was.textContent = formatMoney(price * n);
        if (sm && n > 1) sm.textContent = sm.textContent.replace(/^\S+( [A-Z]{3}(?= ))?/, formatMoney(each));
      });
    }
    on(box, 'change', function (e) {
      var r = e.target.closest('input[type="radio"]');
      if (!r || !qtyInput) return;
      qtyInput.value = r.value;
      $$('.qtyb__opt', box).forEach(function (l) { l.classList.toggle('is-on', l.contains(r)); });
    });
    var first = $('input:checked', box); if (first) first.closest('.qtyb__opt').classList.add('is-on');
    var idIn = $('input[name="id"]', form);
    on(idIn, 'change', function () {
      if (!data) return;
      var v = data.variants.filter(function (x) { return String(x.id) === idIn.value; })[0];
      if (v) refresh(v.price);
    });
  });

  /* ---------- Discount codes in the bag ---------- */
  function applyCodes(codes, input) {
    var err = input ? $('[data-cart-code-error]', input.closest('[data-cart-code]')) : null;
    return fetchJSON(L.routes.cartUpdate.replace(/\.js$/, '') + '.js', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discount: codes.join(','), sections: cartSections(), sections_url: window.location.pathname }) })
      .then(function (res) {
        if (input) {
          var c = input.value.trim().toUpperCase();
          var hit = (res.discount_codes || []).filter(function (d) { return d.code.toUpperCase() === c && d.applicable; })[0];
          if (!hit && c) { if (err) err.hidden = false; return; }
        }
        renderSections(res.sections);
      }).catch(function () { if (err) err.hidden = false; });
  }
  function currentCodes() { return $$('[data-cart-code-remove]').map(function (b) { return b.dataset.cartCodeRemove; }).filter(function (v, i, a) { return a.indexOf(v) === i; }); }
  on(doc, 'click', function (e) {
    var ap = e.target.closest('[data-cart-code-apply]');
    if (ap) {
      var input = $('[data-cart-code-input]', ap.closest('[data-cart-code]'));
      var code = input.value.trim();
      if (!code) { input.focus(); return; }
      ap.classList.add('is-loading');
      applyCodes(currentCodes().concat([code]), input).finally(function () { ap.classList.remove('is-loading'); });
      return;
    }
    var rm = e.target.closest('[data-cart-code-remove]');
    if (rm) applyCodes(currentCodes().filter(function (c) { return c !== rm.dataset.cartCodeRemove; }));
  });
  on(doc, 'keydown', function (e) {
    if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-cart-code-input]')) { e.preventDefault(); var b = $('[data-cart-code-apply]', e.target.closest('[data-cart-code]')); if (b) b.click(); }
  });

  /* ---------- Help centre: search + topics ---------- */
  $$('[data-faqc]').forEach(function (fc) {
    var input = $('[data-faqc-search]', fc), empty = $('[data-faqc-empty]', fc), topic = 'all';
    function apply() {
      var q = (input.value || '').trim().toLowerCase(), any = false;
      $$('[data-faqc-group]', fc).forEach(function (g) {
        var groupOn = topic === 'all' || g.dataset.faqcGroup === topic, shown = 0;
        $$('[data-faqc-q]', g).forEach(function (d) {
          var hit = groupOn && (!q || d.textContent.toLowerCase().indexOf(q) > -1);
          d.hidden = !hit; if (hit) shown++;
          if (q && hit) d.open = true;
        });
        g.hidden = shown === 0; if (shown) any = true;
      });
      empty.hidden = any;
    }
    on(input, 'input', debounce(apply, 120));
    on(fc, 'click', function (e) {
      var b = e.target.closest('[data-faqc-topic]');
      if (!b) return;
      topic = b.dataset.faqcTopic;
      $$('[data-faqc-topic]', fc).forEach(function (x) { x.classList.toggle('is-active', x === b); });
      apply();
      if (window.innerWidth < 990) $('.faqc__main', fc).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  /* ---------- Cookie banner (Shopify Customer Privacy API) ---------- */
  (function () {
    var box = $('[data-cookie-banner]');
    if (!box) {
      // Our banner is off (Shopify's own privacy banner is used): "Cookie preferences" opens Shopify's.
      on(doc, 'click', function (e) {
        if (!e.target.closest('[data-cookie-prefs]')) return;
        e.preventDefault();
        if (window.privacyBanner && window.privacyBanner.showPreferences) window.privacyBanner.showPreferences();
        else window.location.href = '/pages/cookie-policy';
      });
      return;
    }
    var panel = $('[data-cookie-panel]', box), more = $('[data-cookie-more]', box), cp = null;
    function otherApp() { return !!(window.Pandectes || doc.querySelector('#pandectes-banner, [id^="pandectes"], .pd-cookie-banner-window')); }
    function show(withPrefs) {
      if (otherApp()) return;
      box.hidden = false; requestAnimationFrame(function () { box.classList.add('is-on'); });
      if (cp && cp.currentVisitorConsent) {
        var c = cp.currentVisitorConsent() || {};
        $$('[data-cookie-cat]', box).forEach(function (i) { var v = c[i.dataset.cookieCat]; i.checked = v === 'yes'; });
      }
      if (withPrefs) openPrefs();
    }
    function hide() { box.classList.remove('is-on'); setTimeout(function () { box.hidden = true; }, 300); }
    function openPrefs() { panel.hidden = false; more.textContent = more.dataset.save; more.dataset.mode = 'save'; }
    function decide(c) {
      var payload = { analytics: !!c.analytics, marketing: !!c.marketing, preferences: !!c.preferences, sale_of_data: !!c.marketing };
      if (cp && cp.setTrackingConsent) cp.setTrackingConsent(payload, function () {});
      storeSet('luxe:consent', payload);
      hide();
      window.luxeCookiePending = false;
      doc.dispatchEvent(new CustomEvent('luxe:consent'));
    }
    on(box, 'click', function (e) {
      if (e.target.closest('[data-cookie-accept]')) return decide({ analytics: 1, marketing: 1, preferences: 1 });
      if (e.target.closest('[data-cookie-reject]')) return decide({});
      if (e.target.closest('[data-cookie-more]')) {
        if (more.dataset.mode !== 'save') return openPrefs();
        var c = {}; $$('[data-cookie-cat]', box).forEach(function (i) { c[i.dataset.cookieCat] = i.checked; });
        decide(c);
      }
    });
    on(doc, 'click', function (e) { if (e.target.closest('[data-cookie-prefs]')) { e.preventDefault(); show(true); } });
    function init() {
      cp = window.Shopify && window.Shopify.customerPrivacy;
      if (!cp) return;
      // Ask once. A saved choice (on this device or in Shopify) means we never pop up again by ourselves.
      if (storeGet('luxe:consent', null)) return;
      try { if (sessionStorage.getItem('luxe:cookie-seen')) return; sessionStorage.setItem('luxe:cookie-seen', '1'); } catch (e) {}
      if (!(cp.shouldShowBanner && cp.shouldShowBanner())) return;
      // Wait until the page has finished loading, then ask in the middle of the screen. The email popup waits for this choice.
      window.luxeCookiePending = true;
      var go = function () { setTimeout(function () { show(false); }, 800); };
      if (doc.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
    }
    if (window.Shopify && window.Shopify.loadFeatures) {
      window.Shopify.loadFeatures([{ name: 'consent-tracking-api', version: '0.1' }], function (err) { if (!err) init(); });
    }
  })();

  /* ---------- Light / dark mode ---------- */
  (function () {
    var root = doc.documentElement;
    function sync() { var d = root.getAttribute('data-theme') === 'dark'; $$('[data-theme-toggle]').forEach(function (b) { b.setAttribute('aria-pressed', d ? 'true' : 'false'); }); }
    on(doc, 'click', function (e) {
      if (!e.target.closest('[data-theme-toggle]')) return;
      var dark = root.getAttribute('data-theme') !== 'dark';
      var swap = function () { if (dark) root.setAttribute('data-theme', 'dark'); else root.removeAttribute('data-theme'); };
      if (doc.startViewTransition && !reduceMotion) doc.startViewTransition(swap); else swap();
      storeSet('luxe:theme', dark ? 'dark' : 'light');
      var m = doc.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', dark ? '#09203B' : '#ffffff');
      sync();
    });
    sync();
  })();

  /* ---------- Search buttons open the header search bar (the old full-screen search is retired) ---------- */
  doc.addEventListener('click', function (e) {
    var b = e.target.closest('[data-drawer-open="SearchOverlay"]');
    var form = $('[data-header-search]');
    if (!b || !form) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var wrap = $('[data-header]'), input = $('input[type="search"]', form);
    $$('.menu-overlay.is-open, .drawer.is-open').forEach(closeDrawer);
    if (wrap) wrap.classList.add('is-search-open');
    if (wrap && wrap.classList.contains('is-hidden')) wrap.classList.remove('is-hidden');
    if (window.innerWidth >= 990 && wrap && wrap.getBoundingClientRect().top < -10) window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(function () { input.focus(); }, 60);
  }, true);
  on(doc, 'focusout', function (e) {
    var form = e.target.closest && e.target.closest('[data-header-search]');
    if (!form) return;
    setTimeout(function () { var wrap = $('[data-header]'); if (wrap && !form.contains(doc.activeElement) && !$('input[type="search"]', form).value) wrap.classList.remove('is-search-open'); }, 200);
  });

  /* ---------- Bottom sheets (size guide on phones): drag the handle down to close ---------- */
  $$('.drawer--sheet').forEach(function (d) {
    var panel = $('.drawer__panel', d), grab = $('[data-sheet-grab]', d), head = $('.drawer__head', d), y0 = null, dy = 0;
    [grab, head].forEach(function (h) {
      if (!h) return;
      on(h, 'touchstart', function (e) { y0 = e.touches[0].clientY; dy = 0; panel.style.transition = 'none'; }, { passive: true });
      on(h, 'touchmove', function (e) { if (y0 === null) return; dy = Math.max(0, e.touches[0].clientY - y0); panel.style.transform = 'translateY(' + dy + 'px)'; }, { passive: true });
      on(h, 'touchend', function () { panel.style.transition = ''; panel.style.transform = ''; if (dy > 90) closeDrawer(d); y0 = null; });
    });
  });

  /* ---------- Long option lists: two rows, then "Show all" ---------- */
  on(doc, 'click', function (e) {
    var b = e.target.closest('[data-option-more]');
    if (!b) return;
    var f = b.closest('[data-option-many]'), open = !f.classList.contains('is-open');
    f.classList.toggle('is-open', open);
    b.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!b.dataset.more) b.dataset.more = b.firstChild.textContent;
    b.firstChild.textContent = open ? b.dataset.less + ' ' : b.dataset.more;
  });
  // Keep the chosen value in view when the list is collapsed.
  $$('[data-option-many]').forEach(function (f) {
    var vals = $('.option__values', f), c = $('input:checked', f);
    if (!c) return;
    var lab = c.nextElementSibling;
    if (lab && lab.offsetTop - vals.offsetTop > vals.clientHeight - 20) { vals.insertBefore(lab, vals.firstChild); vals.insertBefore(c, lab); }
  });

  /* ---------- LuxeMail beacon (only when an endpoint is configured) ---------- */
  // Body: { cid, t?, h?, p?, ti?, e?, fn?, c?, src?, pg }. An email is only sent with c = 1: a sign-up,
  // or a signed-in customer who already accepts marketing emails.
  function beacon(body) {
    if (!L.mail || !L.mail.endpoint) return;
    try {
      var id = storeGet('luxe:cid', null);
      if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); storeSet('luxe:cid', id); }
      body.cid = id; body.pg = window.location.pathname;
      if (!body.e && L.mail.email) { body.e = L.mail.email; body.fn = L.mail.firstName || null; body.c = 1; body.src = 'account'; }
      var url = L.mail.endpoint.replace(/\/$/, ''); if (!/\/t$/.test(url)) url += '/t';
      var blob = new Blob([JSON.stringify(body)], { type: 'text/plain' });
      if (navigator.sendBeacon) navigator.sendBeacon(url, blob);
    } catch (e) {}
  }
  if (L.mail && L.mail.email && !storeGet('luxe:acct', null)) { storeSet('luxe:acct', 1); beacon({}); }
  // Arrived from one of our emails: report the link code once (counts as engagement), then tidy it out of the address bar.
  (function () {
    try {
      var u = new URL(window.location.href), lx = u.searchParams.get('lx');
      if (!lx) return;
      beacon({ lx: lx });
      u.searchParams.delete('lx'); window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
    } catch (e) {}
  })();

  /* ---------- Newsletter: consent, popup and welcome offer ---------- */
  on(doc, 'submit', function (e) {
    var f = e.target.closest('form[data-newsletter]');
    if (!f) return;
    var consent = $('input[data-consent]', f);
    if (consent && !consent.checked) {
      e.preventDefault();
      var msg = $('[data-consent-error]', f); if (msg) msg.hidden = false;
      consent.focus();
      return;
    }
    storeSet('luxe:popup', { done: true, at: Date.now() });
    var email = $('input[type="email"]', f);
    if (email && email.value) storeSet('luxe:signup-email', email.value.trim());
    var fname = $('input[name="contact[first_name]"]', f);
    if (email && email.value) beacon({ e: email.value.trim(), fn: fname ? fname.value.trim() : null, c: 1, src: f.dataset.newsletter || 'newsletter' });
  });
  on(doc, 'click', function (e) {
    var c = e.target.closest('[data-copy]');
    if (!c) return;
    e.preventDefault();
    var text = c.dataset.copy;
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast(L.strings.copied); }).catch(function () {
      var t = doc.createElement('textarea'); t.value = text; doc.body.appendChild(t); t.select(); try { doc.execCommand('copy'); toast(L.strings.copied); } catch (err) {} t.remove();
    });
  });

  (function () {
    var popup = doc.getElementById('NewsletterPopup');
    if (!popup) return;
    if (window.location.search.indexOf('customer_posted=true') > -1 && window.location.hash.indexOf('PopupForm') > -1) { openDrawer('NewsletterPopup'); showWelcomeCode(); return; }
    if (window.location.search.indexOf('customer_posted=true') > -1) showWelcomeCode();
    var state = storeGet('luxe:popup', null);
    var days = parseInt(popup.dataset.repeatDays, 10) || 0;
    if (state && (state.done || !days || Date.now() - state.at < days * 864e5)) return;
    if (popup.dataset.hideForMarketing === 'true') return;
    if (popup.dataset.auto === 'false') return;
    // Another email popup app (e.g. SendWILL) is still on the site: don't show two.
    function otherPopup() { return !!doc.querySelector('[id*="ecomsend" i], [class*="ecomsend" i], [id*="sendwill" i], [class*="sendwill" i]'); }
    var shown = false;
    function show() {
      if (shown || otherPopup() || $('.drawer.is-open, .popup.is-open, .search-overlay.is-open, .menu-overlay.is-open')) return;
      // Never stack on the cookie question: wait for that choice, then give the visitor a while before asking.
      var cookie = doc.getElementById('CookieBanner');
      if (window.luxeCookiePending || (cookie && !cookie.hidden)) { doc.addEventListener('luxe:consent', function () { setTimeout(show, 15000); }, { once: true }); return; }
      shown = true; openDrawer('NewsletterPopup');
      storeSet('luxe:popup', { done: false, at: Date.now() });
    }
    var delay = (parseInt(popup.dataset.delay, 10) || 10) * 1000;
    if (popup.dataset.trigger === 'exit' && window.matchMedia('(hover: hover)').matches) {
      on(doc, 'mouseout', function (e) { if (!e.relatedTarget && e.clientY < 10) show(); });
    } else {
      setTimeout(show, delay);
    }
    $$('[data-drawer-close]', popup).forEach(function (b) { on(b, 'click', function () { if (!days) storeSet('luxe:popup', { done: true, at: Date.now() }); }); });
  })();
  on(doc, 'click', function (e) { var b = e.target.closest('[data-open-popup]'); if (b) { e.preventDefault(); openDrawer('NewsletterPopup', b); } });
  // After signing up in the popup: show the subscriber's own welcome code from LuxeMail, when it's sending.
  // After sign-up: fetch the subscriber's own code once, apply it to their bag in the background
  // (so it's waiting at checkout), then show it everywhere a code box is on the page.
  function showWelcomeCode() {
    var boxes = $$('[data-popup-code], [data-welcome-code]');
    var email = storeGet('luxe:signup-email', null);
    if (!boxes.length || !email || !L.mail || !L.mail.endpoint) return;
    var url = L.mail.endpoint.replace(/\/t\/?$/, '') + '/welcome-code';
    var tries = 0;
    (function ask() {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ e: email }) })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (d) {
          if (!d || !d.code) return;
          fetch(L.routes.root.replace(/\/$/, '') + '/discount/' + encodeURIComponent(d.code), { credentials: 'same-origin' }).catch(function () {});
          var when = d.endsAt ? new Date(d.endsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) : '';
          boxes.forEach(function (box) {
            $('[data-popup-code-value]', box).textContent = d.code;
            var copyBtn = $('[data-copy]', box); if (copyBtn) copyBtn.dataset.copy = d.code;
            var wait = box.parentNode && $('[data-welcome-wait]', box.parentNode); if (wait) wait.hidden = true;
            var note = $('[data-popup-code-note]', box);
            if (note) note.textContent = (L.strings.codeNote || '').replace('[date]', when);
            box.hidden = false;
            var pop = box.closest('.popup__body'); if (pop) pop.classList.add('has-code');
          });
        })
        .catch(function (s) {
          if (s === 404 && ++tries < 3) return setTimeout(ask, 1500);
          if (s !== 409) return;
          // Already a customer: the first-order code isn't for them, so say so kindly and let them carry on.
          boxes.forEach(function (box) {
            var v = $('[data-popup-code-value]', box), chip = v && v.closest('[data-copy]');
            if (chip) chip.hidden = true;
            var t = $('.popup__code-title', box); if (t) t.lastChild.textContent = ' ' + (L.strings.welcomeBack || '');
            var note = $('[data-popup-code-note]', box); if (note) note.textContent = L.strings.welcomeBackNote || '';
            var wait = box.parentNode && $('[data-welcome-wait]', box.parentNode); if (wait) wait.hidden = true;
            box.hidden = false;
            var pop = box.closest('.popup__body'); if (pop) pop.classList.add('has-code');
          });
        });
    })();
  }

  /* ---------- Localization dropdowns ---------- */
  $$('[data-localization]').forEach(function (wrap) {
    var btn = $('.localization__btn', wrap), list = $('.localization__list', wrap), input = $('input[data-loc-input]', wrap), form = wrap.closest('form');
    on(btn, 'click', function () { var open = btn.getAttribute('aria-expanded') === 'true'; btn.setAttribute('aria-expanded', open ? 'false' : 'true'); list.hidden = open; if (!open) { var cur = $('[aria-current="true"]', list) || $('button', list); cur && cur.focus(); } });
    $$('button', list).forEach(function (b) { on(b, 'click', function () { input.value = b.dataset.value; form.submit(); }); });
    on(wrap, 'keydown', function (e) {
      if (e.key === 'Escape') { btn.setAttribute('aria-expanded', 'false'); list.hidden = true; btn.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { var bs = $$('button', list), i = bs.indexOf(doc.activeElement); if (i > -1 || e.key === 'ArrowDown') { e.preventDefault(); var n = bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]; n && n.focus(); } }
    });
    on(doc, 'click', function (e) { if (!wrap.contains(e.target)) { btn.setAttribute('aria-expanded', 'false'); list.hidden = true; } });
  });

  /* ---------- Intro splash ---------- */
  (function () {
    var sp = doc.getElementById('Splash');
    if (!sp) return;
    if (root.classList.contains('splash-seen') || reduceMotion) { sp.remove(); return; }
    try { sessionStorage.setItem('luxe:splash', '1'); } catch (e) {}
    var done = function () { sp.classList.add('is-done'); setTimeout(function () { sp.remove(); }, 1200); };
    var t0 = Date.now();
    var finish = function () { setTimeout(done, Math.max(0, 1500 - (Date.now() - t0))); };
    if (doc.readyState === 'complete') finish(); else on(window, 'load', finish);
    setTimeout(done, 3200);
  })();

  /* ---------- Full-screen menu: hover shows sub-links and image ---------- */
  (function () {
    var ov = $('[data-menu-overlay]');
    if (!ov) return;
    var wide = function () { return window.matchMedia('(min-width: 990px)').matches; };
    function show(n) {
      $$('[data-group]', ov).forEach(function (g) { g.classList.toggle('is-active', g.dataset.group === n); });
      $$('[data-visual]', ov).forEach(function (v) { v.classList.toggle('is-active', v.dataset.visual === n); });
      $$('[data-menu-group]', ov).forEach(function (b) { b.setAttribute('aria-expanded', b.dataset.menuGroup === n ? 'true' : 'false'); });
    }
    $$('[data-menu-group]', ov).forEach(function (b) {
      on(b, 'mouseenter', function () { if (wide()) show(b.dataset.menuGroup); });
      on(b, 'focus', function () { if (wide()) show(b.dataset.menuGroup); });
      on(b, 'click', function () {
        if (wide()) { show(b.dataset.menuGroup); var first = $('[data-group="' + b.dataset.menuGroup + '"] a', ov); if (first) first.focus(); return; }
        var sub = $('[data-mobile-sub="' + b.dataset.menuGroup + '"]', ov);
        var open = b.getAttribute('aria-expanded') === 'true';
        b.setAttribute('aria-expanded', open ? 'false' : 'true');
        if (sub) sub.hidden = open;
      });
    });
    $$('[data-menu-hover]', ov).forEach(function (a) { on(a, 'mouseenter', function () { if (wide()) show(a.dataset.menuHover); }); });
    var first = $('[data-menu-group]', ov);
    if (first && wide()) show(first.dataset.menuGroup);
  })();

  /* ---------- Scroll story: image grows, words light up ---------- */
  var stories = [];
  function prepareStories() {
    stories = $$('[data-story]').map(function (st) {
      var text = $('[data-words]', st);
      if (text && !text.dataset.wordsReady) {
        text.dataset.wordsReady = '1';
        var walk = function (node) {
          Array.prototype.slice.call(node.childNodes).forEach(function (n) {
            if (n.nodeType === 3) {
              var frag = doc.createDocumentFragment();
              n.textContent.split(/(\s+)/).forEach(function (w) {
                if (!w) return;
                if (/^\s+$/.test(w)) { frag.appendChild(doc.createTextNode(w)); return; }
                var sp = doc.createElement('span'); sp.className = 'story__word'; sp.textContent = w; frag.appendChild(sp);
              });
              n.replaceWith(frag);
            } else if (n.nodeType === 1 && n.tagName !== 'BR') { walk(n); }
          });
        };
        walk(text);
      }
      if (reduceMotion) st.classList.add('story--static');
      return { el: st, words: $$('.story__word', st) };
    });
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function updateStories() {
    if (reduceMotion) return;
    var vh = window.innerHeight;
    stories.forEach(function (s) {
      var r = s.el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) return;
      var p = clamp01(-r.top / Math.max(1, r.height - vh));
      s.el.style.setProperty('--p-frame', clamp01(p / .38).toFixed(3));
      var pt = clamp01((p - .3) / .55);
      s.el.style.setProperty('--p-text', clamp01((p - .25) / .2).toFixed(3));
      s.el.style.setProperty('--p-cta', clamp01((p - .85) / .12).toFixed(3));
      var lit = Math.round(pt * s.words.length);
      s.words.forEach(function (w, i) { w.classList.toggle('is-lit', i < lit); });
    });
  }

  /* ---------- Runway: vertical scroll drives a horizontal track ---------- */
  var runways = [];
  function prepareRunways() {
    runways = $$('[data-runway]').map(function (rw) {
      var track = $('[data-runway-track]', rw);
      var stat = reduceMotion || window.innerWidth < 750;
      rw.classList.toggle('runway--static', stat);
      var dist = stat ? 0 : Math.max(0, track.scrollWidth - window.innerWidth + 48);
      rw.style.setProperty('--runway-h', stat ? 'auto' : (dist + window.innerHeight) + 'px');
      return { el: rw, track: track, dist: dist, items: track.children.length, idx: $('[data-runway-index]', rw), stat: stat };
    });
  }
  function updateRunways() {
    runways.forEach(function (r) {
      if (r.stat) return;
      var rect = r.el.getBoundingClientRect();
      var p = clamp01(-rect.top / Math.max(1, rect.height - window.innerHeight));
      r.el.style.setProperty('--rx', (p * r.dist).toFixed(1) + 'px');
      r.el.style.setProperty('--rp', p.toFixed(3));
      if (r.idx) { var n = Math.min(r.items, Math.floor(p * r.items) + 1); r.idx.textContent = (n < 10 ? '0' : '') + n; }
    });
  }
  on(window, 'resize', debounce(function () { prepareRunways(); updateRunways(); }, 200));

  /* ---------- "View" cursor over product imagery ---------- */
  (function () {
    var cur = $('.view-cursor');
    if (!cur || reduceMotion || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) { if (cur) cur.remove(); return; }
    var x = -200, y = -200, raf = null;
    on(doc, 'mousemove', function (e) {
      x = e.clientX; y = e.clientY;
      var over = e.target.closest && e.target.closest('.card__media, [data-view-cursor], .runway__item .card__visual');
      cur.classList.toggle('is-on', !!over);
      if (!raf) raf = requestAnimationFrame(function () { cur.style.setProperty('--cx', x + 'px'); cur.style.setProperty('--cy', y + 'px'); raf = null; });
    }, { passive: true });
    on(doc, 'mouseleave', function () { cur.classList.remove('is-on'); });
  })();

  /* ---------- Card video preview on hover ---------- */
  on(doc, 'mouseover', function (e) {
    var card = e.target.closest && e.target.closest('.card');
    if (!card || card.dataset.vidBound) return;
    var v = $('.card__video', card);
    if (!v) return;
    card.dataset.vidBound = '1';
    var play = function () { if (!v.src && v.dataset.src) v.src = v.dataset.src; var pr = v.play(); if (pr && pr.then) pr.then(function () { v.classList.add('is-playing'); }).catch(function () {}); };
    on(card, 'mouseenter', play);
    on(card, 'mouseleave', function () { v.pause(); v.classList.remove('is-playing'); });
    play();
  });

  /* ---------- Complete the set ---------- */
  function initSets(ctx) {
    $$('[data-set]', ctx).forEach(function (set) {
      if (set.dataset.ready) return; set.dataset.ready = '1';
      var total = $('[data-set-total]', set), count = $('[data-set-count]', set), btn = $('[data-set-add]', set), label = $('[data-set-label]', set);
      function sum() {
        var t = 0, n = 0;
        $$('input[type="checkbox"]', set).forEach(function (c) {
          var item = c.closest('[data-set-item]'); if (item) item.classList.toggle('is-on', c.checked);
          if (c.checked) { t += parseInt(c.dataset.price, 10) || 0; n++; }
        });
        // Show the buy-more saving these pieces unlock (the same automatic discount Shopify applies at checkout).
        var bar = $('.bset__bar', set), pct = 0;
        if (bar) {
          var q1 = +bar.dataset.q1, p1 = +bar.dataset.p1, q2 = +bar.dataset.q2, p2 = +bar.dataset.p2;
          if (q2 > 1 && n >= q2) pct = p2; else if (q1 > 1 && n >= q1) pct = p1;
        }
        var save = Math.round(t * pct / 100);
        total.textContent = formatMoney(t - save);
        var was = $('[data-set-was]', set), saveEl = $('[data-set-save]', set);
        if (was) { was.hidden = !save; was.textContent = formatMoney(t); }
        if (saveEl) { saveEl.hidden = !save; saveEl.textContent = (saveEl.dataset.text || '').replace('[pct]', pct).replace('[amt]', formatMoney(save)); }
        if (count) count.textContent = n;
        if (btn) { btn.disabled = n < 2; if (label) label.textContent = (n < 2 ? label.dataset.one : label.dataset.many).replace('[n]', n); }
      }
      on(set, 'change', function (e) {
        var sel = e.target.closest('[data-set-select]');
        if (sel) {
          var item = sel.closest('[data-set-item]'), opt = sel.options[sel.selectedIndex], cb = $('input[data-set-variant]', item);
          cb.dataset.setVariant = opt.value; cb.dataset.price = opt.dataset.price; cb.checked = true;
          $('[data-set-price]', item).textContent = opt.dataset.money;
          var im = $('.bset__img img', item); if (im && opt.dataset.img) { im.src = opt.dataset.img; im.removeAttribute('srcset'); }
        }
        sum();
      });
      sum();
      on(btn, 'click', function (e) {
        var b = e.currentTarget;
        var form = doc.querySelector('form[data-product-form]');
        var mainId = form ? parseInt($('input[name="id"]', form).value, 10) : null;
        var items = mainId ? [{ id: mainId, quantity: 1 }] : [];
        $$('input[data-set-variant]:checked', set).forEach(function (c) { items.push({ id: parseInt(c.dataset.setVariant, 10), quantity: 1 }); });
        addToCart(items, b).catch(function () {});
      });
    });
  }


  /* ---------- Dispatch estimate (business days, store time zone) ---------- */
  function initDispatch(ctx) {
    $$('[data-dispatch]', ctx).forEach(function (el) {
      var days = parseInt(el.dataset.days, 10) || 0;
      if (!days) return;
      var off = el.dataset.offset || '+0000';
      var mins = (off[0] === '-' ? -1 : 1) * (parseInt(off.slice(1, 3), 10) * 60 + parseInt(off.slice(3, 5), 10));
      var now = new Date(Date.now() + (mins + new Date().getTimezoneOffset()) * 60000);
      var d = new Date(now);
      if (now.getHours() >= (parseInt(el.dataset.cutoff, 10) || 0)) d.setDate(d.getDate() + 1);
      var added = 0;
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
      while (added < days - 1) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) added++; }
      var lang = root.lang || 'en';
      var txt = d.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' });
      $('span', el).innerHTML = el.dataset.label + ' <strong>' + escapeHTML(txt) + '</strong>';
      el.hidden = false;
    });
  }
  function escapeHTML(str) { return String(str).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- Welcome back (returning visitors, own history only) ---------- */
  (function () {
    var wb = $('[data-welcome-back]');
    if (!wb) return;
    var last = storeGet('luxe:lastseen', 0);
    storeSet('luxe:lastseen', Date.now());
    var seen = false; try { seen = sessionStorage.getItem('luxe:wb'); } catch (e) {}
    var viewed = storeGet('luxe:viewed', []);
    if (seen || !last || Date.now() - last < 30 * 60000 || !viewed.length) return;
    fetchJSON(L.routes.root.replace(/\/$/, '') + '/products/' + encodeURIComponent(viewed[0]) + '.js').then(function (p) {
      if (!p || !p.available) return;
      $$('[data-wb-link]', wb).forEach(function (a) { a.href = p.url; });
      $('[data-wb-title]', wb).textContent = p.title;
      var price = $('[data-wb-price]', wb); if (price) price.textContent = formatMoney(p.price);
      var img = $('[data-wb-img]', wb);
      if (p.featured_image) { img.src = p.featured_image + (p.featured_image.indexOf('?') > -1 ? '&' : '?') + 'width=600'; img.alt = ''; }
      wb.hidden = false;
      try { sessionStorage.setItem('luxe:wb', '1'); } catch (e) {}
      setTimeout(function () {
        if ($('.drawer.is-open, .popup.is-open, .search-overlay.is-open, .menu-overlay.is-open')) return;
        openDrawer('WelcomeBack');
      }, 2500);
    }).catch(function () {});
  })();

  /* ---------- Section editor support ---------- */
  on(doc, 'shopify:section:load', function (e) { prepareStories(); prepareRunways(); initSets(e.target); initDispatch(e.target); initReveals(e.target); initRails(e.target); initProduct(e.target); initWishButtons(e.target); collectParallax(); $$('[data-reveal], [data-split]', e.target).forEach(function (el) { el.classList.add('is-in'); }); });
  on(doc, 'shopify:block:select', function (e) {
    var slide = e.target.closest('.hero__slide');
    if (slide) { var hero = slide.closest('[data-slideshow]'); var dots = $$('.hero__dot', hero); var idx = $$('.hero__slide', hero).indexOf(slide); if (dots[idx]) dots[idx].click(); }
  });

  /* ---------- Header search: live results under the search bar ---------- */
  $$('[data-header-search]').forEach(function (form) {
    var input = $('[data-search-input]', form), pop = $('[data-search-pop]', form);
    var idle = $('[data-search-idle]', form), results = $('[data-search-results]', form);
    if (!input || !pop) return;
    var timer, last = '', ctrl;
    var S = window.Luxe.searchStrings || {};
    function open() { pop.hidden = false; input.setAttribute('aria-expanded', 'true'); form.classList.add('is-open'); }
    function close() { pop.hidden = true; input.setAttribute('aria-expanded', 'false'); form.classList.remove('is-open'); }
    function money(v) { var n = typeof v === 'string' ? Math.round(parseFloat(v) * 100) : v; return formatMoney(n); }
    function hl(text, q) { var t = escapeHTML(text); if (!q) return t; var i = t.toLowerCase().indexOf(q.toLowerCase()); return i < 0 ? t : t.slice(0, i) + '<mark>' + t.slice(i, i + q.length) + '</mark>' + t.slice(i + q.length); }
    function render(q, data) {
      var r = (data && data.resources && data.resources.results) || {};
      var prods = r.products || [], cols = r.collections || [], qs = r.queries || [];
      var url = L.routes.root.replace(/\/$/, '') + '/search?q=' + encodeURIComponent(q) + '&options%5Bprefix%5D=last&type=product';
      var html = '';
      if (!prods.length && !cols.length && !qs.length) {
        html = '<p class="search-pop__empty">' + escapeHTML((S.none || '').replace('%TERMS%', q)) + '</p>';
      } else {
        html += '<div class="search-pop__cols">';
        html += '<div>';
        if (qs.length) { html += '<p class="search-pop__label">' + escapeHTML(S.suggestions || '') + '</p><ul class="search-pop__queries" role="list">' + qs.slice(0, 5).map(function (x) { return '<li><a href="' + x.url + '">' + hl(x.text, q) + '</a></li>'; }).join('') + '</ul>'; }
        if (cols.length) { html += '<p class="search-pop__label">' + escapeHTML(S.collections || '') + '</p><div class="search-pop__chips">' + cols.slice(0, 4).map(function (c) { return '<a class="search-chip" href="' + c.url + '">' + escapeHTML(c.title) + '</a>'; }).join('') + '</div>'; }
        html += '</div>';
        if (prods.length) {
          html += '<div><p class="search-pop__label">' + escapeHTML(S.products || '') + '</p><ul class="search-pop__products" role="list">' + prods.slice(0, 6).map(function (p) {
            var img = p.featured_image && p.featured_image.url ? p.featured_image.url : p.image;
            img = img ? img + (img.indexOf('?') > -1 ? '&' : '?') + 'width=160' : '';
            return '<li><a href="' + p.url + '"><span class="search-pop__img">' + (img ? '<img src="' + img + '" alt="" width="64" height="64" loading="lazy">' : '') + '</span><span class="search-pop__name">' + hl(p.title, q) + '</span><strong>' + money(p.price) + '</strong></a></li>';
          }).join('') + '</ul></div>';
        }
        html += '</div>';
      }
      html += '<a class="search-pop__all" href="' + url + '">' + escapeHTML((S.all || '').replace('%TERMS%', q)) + ' &rarr;</a>';
      results.innerHTML = html;
      idle.hidden = true; results.hidden = false;
    }
    function search(q) {
      if (ctrl) ctrl.abort();
      ctrl = 'AbortController' in window ? new AbortController() : null;
      var u = L.routes.predictiveSearch + '.json?q=' + encodeURIComponent(q) + '&resources[type]=product,collection,query&resources[limit]=6&resources[options][unavailable_products]=last';
      form.classList.add('is-loading');
      fetch(u, { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined }).then(function (r) { return r.json(); }).then(function (d) { if (input.value.trim() === q) render(q, d); }).catch(function () {}).finally(function () { form.classList.remove('is-loading'); });
    }
    on(input, 'focus', open);
    on(input, 'input', function () {
      var q = input.value.trim();
      open();
      clearTimeout(timer);
      if (q.length < 2) { results.hidden = true; idle.hidden = false; last = ''; return; }
      if (q === last) return;
      timer = setTimeout(function () { last = q; search(q); }, 180);
    });
    on(form, 'keydown', function (e) {
      if (e.key === 'Escape') { close(); input.blur(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        var links = $$('a', pop).filter(function (a) { return a.offsetParent !== null; });
        if (!links.length) return;
        e.preventDefault();
        var i = links.indexOf(doc.activeElement);
        var n = e.key === 'ArrowDown' ? (i + 1) % links.length : (i <= 0 ? links.length - 1 : i - 1);
        links[n].focus();
      }
    });
    on(doc, 'click', function (e) { if (!form.contains(e.target)) close(); });
    on(form, 'focusout', function (e) { if (e.relatedTarget && !form.contains(e.relatedTarget)) close(); });
  });

  /* ---------- Track order: open the carrier-neutral tracker with the number filled in ---------- */
  on(doc, 'submit', function (e) {
    var f = e.target.closest && e.target.closest('[data-track-form]');
    if (!f) return;
    e.preventDefault();
    var n = (f.elements.q.value || '').trim();
    if (n) window.open('https://t.17track.net/en#nums=' + encodeURIComponent(n), '_blank', 'noopener');
  });

  /* ---------- Gentle fade-up for cards and tiles as they scroll in ---------- */
  (function () {
    if (reduceMotion || !('IntersectionObserver' in window)) return;
    var sel = '.promo__tile, .promo__side, .dept, .budget2__tile, .deal, .helpc__card, .promise, .review-card, .post-card, .why__list li, .pdp__set, .glance, .track__steps li, .coll-hero, .signup__band, .section-products .card';
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target, sib = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
        el.style.transitionDelay = Math.min(sib, 6) * 60 + 'ms';
        el.classList.add('is-shown'); io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    function watch(ctx) { $$(sel, ctx).forEach(function (el) { if (el.dataset.fx) return; el.dataset.fx = '1'; if (el.getBoundingClientRect().top < window.innerHeight) return; el.classList.add('fx'); io.observe(el); }); }
    watch(doc);
    window.LuxeWatchFx = watch;
  })();

  /* ---------- Footer menus start collapsed on phones ---------- */
  // Footer menus: folded on phones, always open on larger screens (also after resizing or rotating).
  (function () {
    var mq = window.matchMedia('(max-width: 989px)');
    function sync() { $$('.footer__accordion').forEach(function (d) { d.open = !mq.matches; }); }
    sync();
    if (mq.addEventListener) mq.addEventListener('change', sync); else if (mq.addListener) mq.addListener(sync);
  })();

  /* ---------- Blog post: reading progress and table of contents ---------- */
  (function () {
    var post = $('[data-post]'); if (!post) return;
    var bar = $('[data-read-progress]'), content = $('[data-post-content]', post);
    if (bar) on(window, 'scroll', function () {
      var r = post.getBoundingClientRect(), total = r.height - window.innerHeight;
      bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, -r.top / Math.max(total, 1))) + ')';
    }, { passive: true });
    // Drop cap on the first real paragraph (not a short "Published by" line).
    if (content) { var lead = $$(':scope > p', content).filter(function (p) { return p.textContent.trim().length > 120 && !/^(published|by |written)/i.test(p.textContent.trim()); })[0]; if (lead) lead.classList.add('is-lead'); }
    var hs = content ? $$('h2', content) : [];
    var toc = $('[data-toc]'), list = $('[data-toc-list]');
    if (!toc || hs.length < 3) return;
    hs.forEach(function (h, i) {
      if (!h.id) h.id = 'section-' + (i + 1);
      var li = doc.createElement('li'); li.innerHTML = '<a href="#' + h.id + '">' + escapeHTML(h.textContent.trim()) + '</a>'; list.appendChild(li);
    });
    toc.hidden = false;
    var links = $$('a', list);
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) { en.forEach(function (x) { if (x.isIntersecting) { links.forEach(function (l) { l.classList.toggle('is-active', l.getAttribute('href') === '#' + x.target.id); }); } }); }, { rootMargin: '0px 0px -70% 0px' });
      hs.forEach(function (h) { io.observe(h); });
    }
  })();

  /* ---------- Promo slider ---------- */
  $$('[data-promo-slider]').forEach(function (wrap) {
    var slides = $$('.promo-slide', wrap), dots = $$('[data-promo-dot]', wrap);
    if (slides.length < 2) return;
    var i = 0, sec = wrap.closest('.shopify-section'), timer;
    var delay = 6000;
    function go(n) {
      i = (n + slides.length) % slides.length;
      slides.forEach(function (s, k) { s.classList.toggle('is-active', k === i); });
      dots.forEach(function (d, k) { d.classList.toggle('is-active', k === i); });
    }
    function play() { clearInterval(timer); if (root.dataset.motion === 'off') return; timer = setInterval(function () { if (!doc.hidden) go(i + 1); }, delay); }
    dots.forEach(function (d, k) { on(d, 'click', function () { go(k); play(); }); });
    on($('[data-promo-prev]', wrap), 'click', function () { go(i - 1); play(); });
    on($('[data-promo-next]', wrap), 'click', function () { go(i + 1); play(); });
    on(wrap, 'mouseenter', function () { clearInterval(timer); });
    on(wrap, 'mouseleave', play);
    var x0 = null;
    on(wrap, 'touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    on(wrap, 'touchend', function (e) { if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) { go(i + (dx < 0 ? 1 : -1)); play(); } x0 = null; });
    play();
  });

  /* ---------- No repeated photos ----------
     Banners and product rows register the products they show. A row then
     skips any product already shown higher up the page and fills its
     place from the spare cards rendered after it. */
  function dedupeProducts() {
    var seen = {};
    $$('[data-pid]').forEach(function (el) {
      if (el.classList.contains('card')) return;
      seen[el.getAttribute('data-pid')] = true;
    });
    $$('[data-dedupe]').forEach(function (panel) {
      var limit = parseInt(panel.getAttribute('data-dedupe'), 10) || 8;
      var shown = 0;
      $$('.card[data-pid]', panel).forEach(function (card) {
        var id = card.getAttribute('data-pid');
        if (seen[id] || shown >= limit) { card.remove(); return; }
        seen[id] = true; shown++;
        card.hidden = false; card.removeAttribute('data-extra');
      });
    });
  }

  /* ---------- Init ---------- */
  dedupeProducts();
  prepareStories();
  prepareRunways();
  initReveals();
  initRails();
  initProduct();
  initSets();
  initDispatch();
  initWishButtons();
  collectParallax();
  onScroll();
})();
