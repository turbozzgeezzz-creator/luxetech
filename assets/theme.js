/* LuxeTech theme behaviour.
   Every interactive part is a custom element, so markup loaded later
   (quick add, filtered grids, recommendations) wires itself up on insert.
   Without JavaScript the theme still works: links navigate, forms post. */
(function () {
  'use strict';

  var theme = window.LuxeTech || { routes: {}, cartType: 'drawer' };
  var routes = theme.routes || {};
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var desktopQuery = window.matchMedia('(min-width: 990px)');

  /* ------------------------------------------------------------------ */
  /* Helpers                                                            */
  /* ------------------------------------------------------------------ */
  function debounce(fn, wait) {
    var t;
    return function () {
      var args = arguments;
      var ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  function parseHTML(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function announce(message) {
    var region = document.getElementById('A11yStatus');
    if (!region) return;
    region.textContent = '';
    setTimeout(function () { region.textContent = message; }, 50);
  }

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary';

  function trapFocus(container, event) {
    if (event.key !== 'Tab') return;
    var items = Array.prototype.filter.call(container.querySelectorAll(FOCUSABLE), function (el) {
      return el.offsetParent !== null || el === document.activeElement;
    });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  var scrollLocks = 0;
  function lockScroll() {
    scrollLocks += 1;
    document.documentElement.style.overflow = 'hidden';
  }
  function unlockScroll() {
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks === 0) document.documentElement.style.overflow = '';
  }

  function fetchJSON(url, options) {
    return fetch(url, options).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || data.status) {
          var err = new Error(data.description || data.message || 'Request failed');
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function sectionsUrl() {
    return window.location.pathname;
  }

  /* ------------------------------------------------------------------ */
  /* Drawers: menu (left), cart (right), filters (bottom sheet)         */
  /* ------------------------------------------------------------------ */
  var openDrawerEl = null;

  class BaseDrawer extends HTMLElement {
    connectedCallback() {
      this.addEventListener('click', (e) => {
        if (e.target.closest('[data-drawer-close]')) this.close();
      });
      this.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          this.close();
        } else {
          var panel = this.querySelector('[role="dialog"]');
          if (panel && this.isOpen()) trapFocus(panel, e);
        }
      });
    }
    isOpen() { return !this.hasAttribute('hidden'); }
    open(trigger) {
      if (openDrawerEl && openDrawerEl !== this) openDrawerEl.close();
      this.trigger = trigger || document.activeElement;
      this.removeAttribute('hidden');
      if (this.trigger && this.trigger.setAttribute) this.trigger.setAttribute('aria-expanded', 'true');
      lockScroll();
      openDrawerEl = this;
      var panel = this.querySelector('[role="dialog"]');
      if (panel) requestAnimationFrame(function () { panel.focus(); });
    }
    close() {
      if (!this.isOpen()) return;
      this.setAttribute('hidden', '');
      if (this.trigger && this.trigger.setAttribute) {
        this.trigger.setAttribute('aria-expanded', 'false');
        if (document.body.contains(this.trigger)) this.trigger.focus();
      }
      unlockScroll();
      if (openDrawerEl === this) openDrawerEl = null;
    }
  }

  class MenuDrawer extends BaseDrawer {
    connectedCallback() {
      super.connectedCallback();
      desktopQuery.addEventListener('change', (e) => { if (e.matches) this.close(); });
    }
  }
  customElements.define('menu-drawer', MenuDrawer);

  class CartDrawer extends BaseDrawer {
    renderFromHTML(html) {
      var doc = parseHTML(html);
      var fresh = doc.getElementById('CartDrawerInner');
      var current = this.querySelector('#CartDrawerInner');
      if (fresh && current) {
        current.replaceWith(fresh);
        updateCartCount(fresh.dataset.cartCount, fresh.dataset.cartTotal);
      }
    }
  }
  customElements.define('cart-drawer', CartDrawer);

  /* Filters: a sidebar on desktop, a bottom sheet on mobile. */
  class FacetDrawer extends BaseDrawer {
    isOpen() { return this.classList.contains('is-open'); }
    open(trigger) {
      if (desktopQuery.matches) return;
      if (openDrawerEl && openDrawerEl !== this) openDrawerEl.close();
      this.trigger = trigger || document.activeElement;
      this.classList.add('is-open');
      if (this.trigger) this.trigger.setAttribute('aria-expanded', 'true');
      var panel = this.querySelector('[role="dialog"]');
      if (panel) {
        panel.setAttribute('aria-modal', 'true');
        requestAnimationFrame(function () { panel.focus(); });
      }
      lockScroll();
      openDrawerEl = this;
    }
    close() {
      if (!this.isOpen()) return;
      this.classList.remove('is-open');
      var panel = this.querySelector('[role="dialog"]');
      if (panel) panel.setAttribute('aria-modal', 'false');
      if (this.trigger) {
        this.trigger.setAttribute('aria-expanded', 'false');
        if (document.body.contains(this.trigger)) this.trigger.focus();
      }
      unlockScroll();
      if (openDrawerEl === this) openDrawerEl = null;
    }
    connectedCallback() {
      super.connectedCallback();
      desktopQuery.addEventListener('change', (e) => { if (e.matches) this.close(); });
    }
  }
  customElements.define('facet-drawer', FacetDrawer);

  document.addEventListener('click', function (e) {
    var opener = e.target.closest('[data-drawer-open]');
    if (opener) {
      var drawer = document.getElementById(opener.getAttribute('data-drawer-open'));
      if (drawer && drawer.open) {
        e.preventDefault();
        drawer.open(opener);
      }
      return;
    }
    var cartToggle = e.target.closest('[data-cart-toggle]');
    if (cartToggle) {
      var cartDrawer = document.getElementById('CartDrawer');
      var onCartPage = document.body.classList.contains('template-cart');
      if (cartDrawer && theme.cartType === 'drawer' && !onCartPage) {
        e.preventDefault();
        cartDrawer.open(cartToggle);
      }
    }
  });

  function updateCartCount(count, total) {
    count = parseInt(count, 10) || 0;
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      if (el.id === 'CartDrawerInner') return;
      el.textContent = count;
      el.hidden = count === 0;
    });
    document.querySelectorAll('[data-cart-toggle]').forEach(function (el) {
      el.setAttribute('aria-label', 'Cart, ' + count + (count === 1 ? ' item' : ' items'));
      var small = el.querySelector('.header__icon-label small');
      if (small && total) small.innerHTML = total;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Mega menu                                                          */
  /* ------------------------------------------------------------------ */
  class MegaMenu extends HTMLElement {
    connectedCallback() {
      this.buttons = Array.prototype.slice.call(this.querySelectorAll('button.mega-nav__top[aria-controls]'));
      this.openTimer = null;
      this.closeTimer = null;
      var canHover = window.matchMedia('(hover: hover)').matches;

      this.buttons.forEach((btn) => {
        var item = btn.closest('.mega-nav__item');
        btn.addEventListener('click', () => {
          var expanded = btn.getAttribute('aria-expanded') === 'true';
          if (expanded) this.closeAll(); else this.openPanel(btn);
        });
        if (canHover) {
          item.addEventListener('mouseenter', () => {
            clearTimeout(this.closeTimer);
            clearTimeout(this.openTimer);
            var anyOpen = this.buttons.some(function (b) { return b.getAttribute('aria-expanded') === 'true'; });
            this.openTimer = setTimeout(() => this.openPanel(btn), anyOpen ? 0 : 140);
          });
          item.addEventListener('mouseleave', () => {
            clearTimeout(this.openTimer);
            this.closeTimer = setTimeout(() => this.closeAll(), 220);
          });
        }
      });

      this.querySelectorAll('.mega-nav__item').forEach((item) => {
        if (!item.querySelector('button.mega-nav__top') && canHover) {
          item.addEventListener('mouseenter', () => {
            clearTimeout(this.openTimer);
            this.closeTimer = setTimeout(() => this.closeAll(), 120);
          });
        }
      });

      this.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          var open = this.buttons.find(function (b) { return b.getAttribute('aria-expanded') === 'true'; });
          if (open) {
            this.closeAll();
            open.focus();
          }
        }
      });
      this.addEventListener('focusout', (e) => {
        if (e.relatedTarget && !this.contains(e.relatedTarget)) this.closeAll();
      });
      document.addEventListener('click', (e) => {
        if (!this.contains(e.target)) this.closeAll();
      });
    }
    openPanel(btn) {
      this.buttons.forEach(function (b) {
        if (b !== btn) {
          b.setAttribute('aria-expanded', 'false');
          var p = document.getElementById(b.getAttribute('aria-controls'));
          if (p) p.hidden = true;
        }
      });
      btn.setAttribute('aria-expanded', 'true');
      var panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (panel) panel.hidden = false;
    }
    closeAll() {
      this.buttons.forEach(function (b) {
        b.setAttribute('aria-expanded', 'false');
        var p = document.getElementById(b.getAttribute('aria-controls'));
        if (p) p.hidden = true;
      });
    }
  }
  customElements.define('mega-menu', MegaMenu);

  /* ------------------------------------------------------------------ */
  /* Predictive search                                                  */
  /* ------------------------------------------------------------------ */
  class PredictiveSearch extends HTMLElement {
    connectedCallback() {
      if (this.dataset.enabled !== 'true' || !routes.predictiveSearch) return;
      this.input = this.querySelector('input[type="search"]');
      this.results = this.querySelector('.predictive');
      this.abort = null;
      this.input.addEventListener('input', debounce(() => this.onInput(), 250));
      this.input.addEventListener('focus', () => { if (this.results.innerHTML.trim() && this.input.value.trim().length > 1) this.show(); });
      this.addEventListener('keydown', (e) => this.onKeydown(e));
      this.addEventListener('focusout', () => {
        setTimeout(() => { if (!this.contains(document.activeElement)) this.hide(); }, 0);
      });
      document.addEventListener('click', (e) => { if (!this.contains(e.target)) this.hide(); });
    }
    onInput() {
      var term = this.input.value.trim();
      if (term.length < 2) {
        this.hide();
        return;
      }
      if (this.abort) this.abort.abort();
      this.abort = new AbortController();
      var url = routes.predictiveSearch + '?q=' + encodeURIComponent(term) +
        '&resources[type]=product,collection&resources[limit]=6&resources[options][unavailable_products]=last&section_id=predictive-search';
      fetch(url, { signal: this.abort.signal })
        .then(function (res) { return res.text(); })
        .then((html) => {
          var doc = parseHTML(html);
          var inner = doc.querySelector('.predictive__inner');
          this.results.innerHTML = inner ? inner.outerHTML : '';
          if (inner) this.show(); else this.hide();
        })
        .catch(function () {});
    }
    options() { return Array.prototype.slice.call(this.results.querySelectorAll('[role="option"]')); }
    onKeydown(e) {
      if (e.key === 'Escape') {
        this.hide();
        this.input.focus();
        return;
      }
      if (this.results.hidden) return;
      var opts = this.options();
      if (!opts.length) return;
      var idx = opts.findIndex(function (o) { return o.getAttribute('aria-selected') === 'true'; });
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        idx = e.key === 'ArrowDown' ? (idx + 1) % opts.length : (idx <= 0 ? opts.length - 1 : idx - 1);
        opts.forEach(function (o, i) { o.setAttribute('aria-selected', i === idx ? 'true' : 'false'); });
        this.input.setAttribute('aria-activedescendant', opts[idx].id);
      } else if (e.key === 'Enter' && idx > -1) {
        e.preventDefault();
        var link = opts[idx].querySelector('a');
        if (link) window.location.href = link.href;
      }
    }
    show() {
      this.results.hidden = false;
      this.input.setAttribute('aria-expanded', 'true');
    }
    hide() {
      if (!this.results) return;
      this.results.hidden = true;
      this.input.setAttribute('aria-expanded', 'false');
      this.input.removeAttribute('aria-activedescendant');
    }
  }
  customElements.define('predictive-search', PredictiveSearch);

  /* ------------------------------------------------------------------ */
  /* Hero slideshow                                                     */
  /* ------------------------------------------------------------------ */
  class SlideShow extends HTMLElement {
    connectedCallback() {
      this.track = this.querySelector('.slideshow__track');
      this.slides = Array.prototype.slice.call(this.querySelectorAll('.slide'));
      this.dots = Array.prototype.slice.call(this.querySelectorAll('[data-slide-to]'));
      this.index = 0;
      this.userPaused = false;
      this.hovering = false;
      this.focused = false;
      if (this.slides.length < 2) return;

      this.slides.forEach(function (s) {
        s.querySelectorAll('[tabindex="-1"]').forEach(function (el) { el.removeAttribute('tabindex'); });
      });

      this.querySelector('[data-slide-prev]').addEventListener('click', () => this.go(this.index - 1, true));
      this.querySelector('[data-slide-next]').addEventListener('click', () => this.go(this.index + 1, true));
      this.dots.forEach((dot) => dot.addEventListener('click', () => this.go(parseInt(dot.dataset.slideTo, 10), true)));

      this.toggle = this.querySelector('[data-slide-toggle]');
      if (this.toggle) {
        this.toggle.addEventListener('click', () => {
          this.userPaused = !this.userPaused;
          this.updateAutoplay();
        });
      }

      this.addEventListener('mouseenter', () => { this.hovering = true; this.updateAutoplay(); });
      this.addEventListener('mouseleave', () => { this.hovering = false; this.updateAutoplay(); });
      this.addEventListener('focusin', () => { this.focused = true; this.updateAutoplay(); });
      this.addEventListener('focusout', (e) => {
        if (!this.contains(e.relatedTarget)) { this.focused = false; this.updateAutoplay(); }
      });
      this.addEventListener('keydown', (e) => {
        if (e.target.closest('input, textarea')) return;
        if (e.key === 'ArrowLeft') this.go(this.index - 1, true);
        if (e.key === 'ArrowRight') this.go(this.index + 1, true);
      });
      document.addEventListener('visibilitychange', () => this.updateAutoplay());
      reducedMotion.addEventListener('change', () => this.updateAutoplay());

      /* Swipe */
      var viewport = this.querySelector('.slideshow__viewport');
      var startX = null;
      var startY = null;
      viewport.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse') return;
        startX = e.clientX;
        startY = e.clientY;
      });
      viewport.addEventListener('pointerup', (e) => {
        if (startX === null) return;
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        startX = null;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) this.go(this.index + (dx < 0 ? 1 : -1), true);
      });
      viewport.addEventListener('pointercancel', function () { startX = null; });

      this.render();
      this.updateAutoplay();
    }
    disconnectedCallback() { clearInterval(this.timer); }
    go(i, fromUser) {
      var n = this.slides.length;
      this.index = (i + n) % n;
      this.render();
      if (fromUser) this.restartTimer();
    }
    render() {
      this.track.style.transform = 'translateX(' + (-100 * this.index) + '%)';
      this.slides.forEach((s, i) => {
        var active = i === this.index;
        s.toggleAttribute('inert', !active);
        s.setAttribute('aria-hidden', active ? 'false' : 'true');
      });
      this.dots.forEach((d, i) => {
        if (i === this.index) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current');
      });
    }
    canAutoplay() {
      return this.dataset.autoplay === 'true' && !reducedMotion.matches;
    }
    updateAutoplay() {
      var running = this.canAutoplay() && !this.userPaused && !this.hovering && !this.focused && !document.hidden;
      this.classList.toggle('is-paused', !this.canAutoplay() || this.userPaused);
      if (this.toggle) {
        this.toggle.setAttribute('aria-label', this.userPaused ? 'Play slideshow' : 'Pause slideshow');
        this.toggle.hidden = !this.canAutoplay();
      }
      clearInterval(this.timer);
      if (running) {
        this.timer = setInterval(() => this.go(this.index + 1, false), parseInt(this.dataset.speed, 10) || 6000);
      }
    }
    restartTimer() { this.updateAutoplay(); }
  }
  customElements.define('slide-show', SlideShow);

  /* ------------------------------------------------------------------ */
  /* Product rails (horizontal scrollers with arrows)                   */
  /* ------------------------------------------------------------------ */
  class ProductRail extends HTMLElement {
    connectedCallback() {
      this.track = this.querySelector('.rail__track');
      var scope = this.closest('.container') || this.parentElement;
      this.arrows = scope ? scope.querySelector('[data-rail-arrows]') : null;
      if (!this.track || !this.arrows) return;
      this.prev = this.arrows.querySelector('[data-rail-prev]');
      this.next = this.arrows.querySelector('[data-rail-next]');
      this.prev.addEventListener('click', () => this.scrollByPage(-1));
      this.next.addEventListener('click', () => this.scrollByPage(1));
      this.track.addEventListener('scroll', debounce(() => this.update(), 60), { passive: true });
      this.resizeObserver = new ResizeObserver(() => this.update());
      this.resizeObserver.observe(this.track);
      this.update();
    }
    disconnectedCallback() { if (this.resizeObserver) this.resizeObserver.disconnect(); }
    scrollByPage(dir) {
      this.track.scrollBy({ left: dir * this.track.clientWidth * 0.9, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
    update() {
      var max = this.track.scrollWidth - this.track.clientWidth;
      this.arrows.hidden = max <= 4;
      this.prev.disabled = this.track.scrollLeft <= 4;
      this.next.disabled = this.track.scrollLeft >= max - 4;
    }
  }
  customElements.define('product-rail', ProductRail);

  /* ------------------------------------------------------------------ */
  /* Product gallery + lightbox                                         */
  /* ------------------------------------------------------------------ */
  class MediaGallery extends HTMLElement {
    connectedCallback() {
      this.main = this.querySelector('.gallery__main');
      this.slides = Array.prototype.slice.call(this.querySelectorAll('.gallery__slide'));
      this.thumbs = Array.prototype.slice.call(this.querySelectorAll('[data-thumb]'));
      this.lightbox = this.querySelector('.lightbox');
      this.index = Math.max(0, this.slides.findIndex(function (s) { return s.classList.contains('is-active'); }));
      if (!this.main || !this.slides.length) return;

      if (this.index > 0) this.show(this.index, true);

      /* Up to 7 photos: dots under the image. More than that: a "3 / 24" counter on the image. */
      if (this.slides.length > 7) {
        this.counter = document.createElement('span');
        this.counter.className = 'gallery__counter';
        this.counter.setAttribute('aria-hidden', 'true');
        this.counter.textContent = (this.index + 1) + ' / ' + this.slides.length;
        (this.main.closest('.gallery__wrap') || this.main.parentElement).appendChild(this.counter);
      } else if (this.slides.length > 1) {
        this.dots = document.createElement('div');
        this.dots.className = 'gallery__dots';
        this.dots.setAttribute('aria-hidden', 'true');
        this.dots.innerHTML = this.slides.map(function () { return '<span></span>'; }).join('');
        (this.main.closest('.gallery__wrap') || this.main).insertAdjacentElement('afterend', this.dots);
        this.dots.children[this.index].classList.add('is-active');
      }

      this.thumbs.forEach((t) => t.addEventListener('click', () => this.show(parseInt(t.dataset.thumb, 10))));
      var prev = this.querySelector('[data-gallery-prev]');
      var next = this.querySelector('[data-gallery-next]');
      if (prev) prev.addEventListener('click', () => this.show(Math.max(0, this.index - 1)));
      if (next) next.addEventListener('click', () => this.show(Math.min(this.slides.length - 1, this.index + 1)));
      /* Mouse users can drag the photo sideways to change it, like swiping on a phone. */
      var dragX = null, dragged = false;
      this.main.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button === 0) { dragX = e.clientX; dragged = false; } });
      this.main.addEventListener('pointermove', (e) => { if (dragX !== null && Math.abs(e.clientX - dragX) > 6) dragged = true; });
      window.addEventListener('pointerup', (e) => {
        if (dragX === null) return;
        var dx = e.clientX - dragX; dragX = null;
        if (Math.abs(dx) > 40) this.show(Math.max(0, Math.min(this.slides.length - 1, this.index + (dx < 0 ? 1 : -1))));
      });
      this.main.addEventListener('click', (e) => { if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; } }, true);
      this.main.addEventListener('dragstart', (e) => e.preventDefault());
      this.main.addEventListener('scroll', debounce(() => {
        var i = Math.round(this.main.scrollLeft / this.main.clientWidth);
        if (i !== this.index) this.setActive(i);
      }, 80), { passive: true });

      if (this.lightbox) this.initLightbox();
    }
    show(i, instant) {
      var slide = this.slides[i];
      if (!slide) return;
      this.main.scrollTo({ left: slide.offsetLeft, behavior: instant || reducedMotion.matches ? 'auto' : 'smooth' });
      this.setActive(i);
    }
    showMedia(mediaId) {
      var i = this.slides.findIndex(function (s) { return s.dataset.mediaId === String(mediaId); });
      if (i > -1) this.show(i);
    }
    setActive(i) {
      this.index = i;
      this.slides.forEach(function (s, n) { s.classList.toggle('is-active', n === i); });
      if (this.dots) Array.prototype.forEach.call(this.dots.children, function (d, n) { d.classList.toggle('is-active', n === i); });
      if (this.counter) this.counter.textContent = (i + 1) + ' / ' + this.slides.length;
      this.thumbs.forEach(function (t, n) {
        t.classList.toggle('is-active', n === i);
        if (n === i) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current');
      });
      var active = this.thumbs[i];
      if (active && active.parentElement && active.parentElement.parentElement) {
        var rail = active.parentElement.parentElement;
        var li = active.parentElement;
        if (rail.scrollWidth > rail.clientWidth) rail.scrollTo({ left: li.offsetLeft - rail.clientWidth / 2 + li.clientWidth / 2, behavior: 'auto' });
      }
    }
    initLightbox() {
      try {
        this.items = JSON.parse(this.lightbox.querySelector('[data-lightbox-json]').textContent);
      } catch (e) {
        this.items = [];
      }
      this.lbImg = this.lightbox.querySelector('[data-lightbox-img]');
      this.lbCount = this.lightbox.querySelector('[data-lightbox-count]');
      this.addEventListener('click', (e) => {
        var opener = e.target.closest('[data-lightbox-open]');
        if (opener) this.openLightbox(parseInt(opener.dataset.lightboxOpen, 10));
      });
      this.lightbox.querySelector('[data-lightbox-close]').addEventListener('click', () => this.lightbox.close());
      var p = this.lightbox.querySelector('[data-lightbox-prev]');
      var n = this.lightbox.querySelector('[data-lightbox-next]');
      if (p) p.addEventListener('click', () => this.lightboxStep(-1));
      if (n) n.addEventListener('click', () => this.lightboxStep(1));
      this.lightbox.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') this.lightboxStep(-1);
        if (e.key === 'ArrowRight') this.lightboxStep(1);
      });
      this.lightbox.addEventListener('click', (e) => {
        if (e.target === this.lightbox || e.target.classList.contains('lightbox__stage')) this.lightbox.close();
      });
      this.lightbox.addEventListener('close', () => {
        unlockScroll();
        this.show(this.lbIndex, true);
        var opener = this.querySelector('[data-lightbox-open="' + this.lbIndex + '"]');
        if (opener) opener.focus();
      });
    }
    openLightbox(i) {
      if (!this.items.length || typeof this.lightbox.showModal !== 'function') return;
      this.renderLightbox(i);
      this.lightbox.showModal();
      lockScroll();
    }
    lightboxStep(dir) {
      var n = this.items.length;
      this.renderLightbox((this.lbIndex + dir + n) % n);
    }
    renderLightbox(i) {
      var item = this.items[i];
      if (!item) return;
      this.lbIndex = i;
      this.lbImg.src = item.src;
      this.lbImg.alt = item.alt || '';
      this.lbImg.width = item.w;
      this.lbImg.height = item.h;
      if (this.lbCount) this.lbCount.textContent = (i + 1) + ' / ' + this.items.length;
    }
  }
  customElements.define('media-gallery', MediaGallery);

  /* ------------------------------------------------------------------ */
  /* Quantity stepper                                                   */
  /* ------------------------------------------------------------------ */
  class QuantityInput extends HTMLElement {
    connectedCallback() {
      this.input = this.querySelector('input');
      this.addEventListener('click', (e) => {
        var btn = e.target.closest('button');
        if (!btn) return;
        var min = parseInt(this.input.min, 10);
        if (isNaN(min)) min = 1;
        var value = parseInt(this.input.value, 10) || 0;
        var next = btn.name === 'plus' ? value + 1 : Math.max(min, value - 1);
        if (next === value) return;
        this.input.value = next;
        this.input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
  }
  customElements.define('quantity-input', QuantityInput);

  /* ------------------------------------------------------------------ */
  /* Variant picker (product page and quick add)                        */
  /* ------------------------------------------------------------------ */
  class ProductInfo extends HTMLElement {
    connectedCallback() {
      var json = this.querySelector('[data-variant-json]');
      if (!json) return;
      try {
        this.variants = JSON.parse(json.textContent);
      } catch (e) {
        return;
      }
      this.picker = this.querySelector('[data-variant-picker]');
      if (!this.picker) return;
      this.fieldsets = Array.prototype.slice.call(this.picker.querySelectorAll('fieldset.option'));
      this.picker.addEventListener('change', () => this.onChange());
      this.markAvailability();
    }
    selectedOptions() {
      return this.fieldsets.map(function (fs) {
        var checked = fs.querySelector('input:checked');
        return checked ? checked.value : null;
      });
    }
    findVariant(options) {
      return this.variants.find(function (v) {
        return options.every(function (val, i) { return v.options[i] === val; });
      });
    }
    onChange() {
      var options = this.selectedOptions();
      this.fieldsets.forEach(function (fs, i) {
        var label = fs.querySelector('[data-selected-value]');
        if (label) label.textContent = options[i] || '';
      });
      var variant = this.findVariant(options);
      this.markAvailability();
      this.update(variant);
    }
    markAvailability() {
      var selected = this.selectedOptions();
      var variants = this.variants;
      this.fieldsets.forEach(function (fs, index) {
        fs.querySelectorAll('input').forEach(function (input) {
          var ok = variants.some(function (v) {
            if (!v.available || v.options[index] !== input.value) return false;
            return selected.every(function (val, i) { return i === index || i > index || v.options[i] === val; });
          });
          input.classList.toggle('is-unavailable', !ok);
        });
      });
    }
    update(variant) {
      var idInput = this.querySelector('[data-variant-id]');
      var addBtn = this.querySelector('[data-add-button]');
      var addLabel = this.querySelector('[data-add-label]');
      var priceSlot = this.querySelector('[data-price-slot]');
      var stockSlot = this.querySelector('[data-stock-slot]');
      var sku = this.querySelector('[data-sku]');

      if (!variant) {
        if (addBtn) addBtn.disabled = true;
        if (addLabel) addLabel.textContent = 'Unavailable';
        if (stockSlot) stockSlot.innerHTML = '<p class="stock stock--out"><span class="stock__dot" aria-hidden="true"></span><span class="stock__text">This combination is unavailable</span></p>';
        return;
      }

      if (idInput) {
        idInput.value = variant.id;
        idInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (priceSlot) priceSlot.innerHTML = variant.priceHtml;
      if (stockSlot) stockSlot.innerHTML = variant.stockHtml;
      if (sku) {
        sku.textContent = variant.sku || '';
        sku.parentElement.hidden = !variant.sku;
      }
      if (addBtn) addBtn.disabled = !variant.available;
      if (addLabel) addLabel.textContent = variant.available ? 'Add to cart' : 'Sold out';

      var variantGallery = this.querySelector('media-gallery');
      /* Variants without their own photo: show the photo in the same position (variant 2 shows photo 2). */
      if (!variant.media && variant.position && variantGallery && variantGallery.slides && variantGallery.slides.length > 1) {
        variantGallery.show(Math.min(variant.position - 1, variantGallery.slides.length - 1));
      }
      if (variant.media) {
        var gallery = variantGallery;
        if (gallery && gallery.showMedia) gallery.showMedia(variant.media);
        var quickImg = this.querySelector('.quick-add__img');
        var mediaJson = this.querySelector('[data-media-json]');
        if (quickImg && mediaJson) {
          try {
            var map = JSON.parse(mediaJson.textContent);
            if (map[variant.media]) {
              quickImg.removeAttribute('srcset');
              quickImg.src = map[variant.media];
            }
          } catch (e) { /* ignore */ }
        }
      }

      if (this.dataset.updateUrl === 'true' && window.history.replaceState) {
        var url = new URL(window.location.href);
        url.searchParams.set('variant', variant.id);
        window.history.replaceState({}, '', url.toString());
      }
    }
  }
  customElements.define('product-info', ProductInfo);

  /* Sticky mobile add-to-cart: mirrors the main buy box button. */
  class StickyAtc extends HTMLElement {
    connectedCallback() {
      var info = this.closest('product-info');
      this.mainBtn = info && info.querySelector('[data-add-button]');
      if (!this.mainBtn) return;
      this.btn = this.querySelector('[data-sticky-add]');
      this.price = this.querySelector('[data-sticky-price]');
      this.btn.addEventListener('click', () => {
        if (this.mainBtn.disabled) {
          this.mainBtn.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center' });
          return;
        }
        this.mainBtn.click();
      });
      var mobile = window.matchMedia('(max-width: 749px)');
      var ticking = false;
      this.check = () => {
        ticking = false;
        /* Show only once the main button has scrolled up out of view. */
        this.hidden = !mobile.matches || this.mainBtn.getBoundingClientRect().bottom > 0;
      };
      this.onScroll = () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(this.check);
        }
      };
      window.addEventListener('scroll', this.onScroll, { passive: true });
      window.addEventListener('resize', this.onScroll);
      this.check();
      info.addEventListener('change', () => {
        setTimeout(() => {
          var current = info.querySelector('[data-price-slot] .price__current');
          if (current && this.price) this.price.textContent = current.textContent.replace(/^\s*(Sale price|Price)\s*/, '').trim();
          this.btn.disabled = this.mainBtn.disabled;
          this.btn.textContent = this.mainBtn.disabled ? 'Unavailable' : 'Add to cart';
        }, 0);
      });
    }
    disconnectedCallback() {
      window.removeEventListener('scroll', this.onScroll);
      window.removeEventListener('resize', this.onScroll);
    }
  }
  customElements.define('sticky-atc', StickyAtc);

  /* ------------------------------------------------------------------ */
  /* AJAX add to cart                                                   */
  /* ------------------------------------------------------------------ */
  class ProductForm extends HTMLElement {
    connectedCallback() {
      this.form = this.querySelector('form');
      if (!this.form) return;
      this.form.addEventListener('submit', (e) => this.onSubmit(e));
    }
    onSubmit(e) {
      if (theme.cartType === 'page') return; /* let the form post normally */
      e.preventDefault();
      var btn = this.form.querySelector('[type="submit"]');
      var errorEl = this.form.querySelector('.form-error');
      if (!btn || btn.disabled || btn.classList.contains('is-loading')) return;
      if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
      btn.classList.add('is-loading');
      btn.setAttribute('aria-busy', 'true');

      var body = new FormData(this.form);
      body.append('sections', 'cart-drawer');
      body.append('sections_url', sectionsUrl());

      fetchJSON(routes.cartAdd + '.js', {
        method: 'POST',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: body
      })
        .then((data) => {
          var drawer = document.getElementById('CartDrawer');
          if (!drawer || !data.sections || !data.sections['cart-drawer']) {
            window.location.href = routes.cart;
            return;
          }
          drawer.renderFromHTML(data.sections['cart-drawer']);
          var modal = this.closest('dialog');
          if (modal && modal.open) modal.close();
          announce((data.product_title || 'Item') + ' added to cart');
          if (!document.body.classList.contains('template-cart')) {
            drawer.open(btn);
          } else {
            window.location.reload();
          }
        })
        .catch((err) => {
          if (errorEl) {
            errorEl.textContent = err.message || 'This item could not be added. Please try again.';
            errorEl.hidden = false;
          }
        })
        .finally(function () {
          btn.classList.remove('is-loading');
          btn.removeAttribute('aria-busy');
        });
    }
  }
  customElements.define('product-form', ProductForm);

  /* ------------------------------------------------------------------ */
  /* Quick add dialog                                                   */
  /* ------------------------------------------------------------------ */
  class QuickAddModal extends HTMLElement {
    connectedCallback() {
      this.dialog = this.querySelector('dialog');
      this.content = this.querySelector('[data-modal-content]');
      this.loading = this.content.innerHTML;
      this.querySelector('[data-modal-close]').addEventListener('click', () => this.dialog.close());
      this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
      this.dialog.addEventListener('close', () => {
        unlockScroll();
        this.content.innerHTML = this.loading;
        if (this.trigger && document.body.contains(this.trigger)) this.trigger.focus();
      });
      document.addEventListener('click', (e) => {
        var btn = e.target.closest('[data-quick-add]');
        if (!btn) return;
        e.preventDefault();
        this.open(btn);
      });
    }
    open(btn) {
      if (typeof this.dialog.showModal !== 'function') {
        window.location.href = btn.dataset.quickAdd;
        return;
      }
      this.trigger = btn;
      this.dialog.showModal();
      lockScroll();
      var url = btn.dataset.quickAdd + (btn.dataset.quickAdd.indexOf('?') > -1 ? '&' : '?') + 'section_id=quick-add';
      fetch(url)
        .then(function (res) {
          if (!res.ok) throw new Error('Failed');
          return res.text();
        })
        .then((html) => {
          var doc = parseHTML(html);
          var qa = doc.querySelector('.quick-add');
          if (!qa) throw new Error('Missing');
          this.content.innerHTML = '';
          this.content.appendChild(document.importNode(qa, true));
          var title = this.content.querySelector('.buybox__title');
          if (title) this.dialog.setAttribute('aria-label', title.textContent.trim());
          var first = this.content.querySelector('.option__input, [data-add-button]');
          if (first) first.focus();
        })
        .catch(() => { window.location.href = btn.dataset.quickAdd; });
    }
  }
  customElements.define('quick-add-modal', QuickAddModal);

  /* ------------------------------------------------------------------ */
  /* Cart lines (drawer and cart page)                                  */
  /* ------------------------------------------------------------------ */
  var cartRequest = Promise.resolve();

  function changeLine(line, quantity, sourceEl) {
    var sectionIds = ['cart-drawer'];
    var mainCart = document.querySelector('cart-items[data-section-id]');
    if (mainCart) sectionIds.push(mainCart.dataset.sectionId);
    var busy = document.querySelectorAll('cart-items');
    busy.forEach(function (el) { el.classList.add('is-loading'); });

    cartRequest = cartRequest.then(function () {
      return fetchJSON(routes.cartChange + '.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ line: line, quantity: quantity, sections: sectionIds, sections_url: sectionsUrl() })
      })
        .then(function (cart) {
          renderCartSections(cart.sections || {}, mainCart);
          announce('Cart updated. ' + cart.item_count + (cart.item_count === 1 ? ' item' : ' items') + '.');
        })
        .catch(function (err) {
          busy.forEach(function (el) { el.classList.remove('is-loading'); });
          var host = sourceEl && sourceEl.closest('.cart-line');
          if (host) {
            var msg = host.querySelector('.form-error') || document.createElement('p');
            msg.className = 'form-error';
            msg.setAttribute('role', 'alert');
            msg.textContent = err.message || 'Could not update quantity.';
            host.querySelector('.cart-line__info').appendChild(msg);
          }
          return fetchJSON(routes.cart + '.js').then(function (cart) {
            var input = host && host.querySelector('[data-line-qty]');
            var item = cart.items[line - 1];
            if (input && item) input.value = item.quantity;
          }).catch(function () {});
        });
    });
  }

  function renderCartSections(sections, mainCart) {
    var drawer = document.getElementById('CartDrawer');
    if (drawer && sections['cart-drawer']) {
      var wasOpen = drawer.isOpen && drawer.isOpen();
      var active = document.activeElement && document.activeElement.id;
      drawer.renderFromHTML(sections['cart-drawer']);
      if (wasOpen && active) {
        var again = document.getElementById(active);
        if (again) again.focus();
      }
    }
    if (mainCart && sections[mainCart.dataset.sectionId]) {
      var doc = parseHTML(sections[mainCart.dataset.sectionId]);
      var fresh = doc.getElementById('MainCart');
      var current = document.getElementById('MainCart');
      if (fresh && current) {
        var focusId = document.activeElement && document.activeElement.id;
        current.innerHTML = fresh.innerHTML;
        if (focusId) {
          var el = document.getElementById(focusId);
          if (el) el.focus();
        }
      }
    }
  }

  class CartItems extends HTMLElement {
    connectedCallback() {
      this.addEventListener('change', debounce((e) => {
        var input = e.target.closest('[data-line-qty]');
        if (!input) return;
        var qty = Math.max(0, parseInt(input.value, 10) || 0);
        changeLine(parseInt(input.dataset.lineQty, 10), qty, input);
      }, 300));
      this.addEventListener('click', (e) => {
        var remove = e.target.closest('[data-line-remove]');
        if (!remove) return;
        e.preventDefault();
        changeLine(parseInt(remove.dataset.lineRemove, 10), 0, remove);
      });
    }
  }
  customElements.define('cart-items', CartItems);

  /* Order note saves as the shopper types. */
  document.addEventListener('input', debounce(function (e) {
    if (!e.target.matches('[data-cart-note]')) return;
    fetch(routes.cartUpdate + '.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ note: e.target.value })
    }).catch(function () {});
  }, 500));

  /* ------------------------------------------------------------------ */
  /* Product detail tabs                                                */
  /* ------------------------------------------------------------------ */
  class ProductTabs extends HTMLElement {
    connectedCallback() {
      this.tabs = Array.prototype.slice.call(this.querySelectorAll('[role="tab"]'));
      if (!this.tabs.length) return;
      this.tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => this.select(i, false));
        tab.addEventListener('keydown', (e) => {
          var n = this.tabs.length;
          if (e.key === 'ArrowRight') this.select((i + 1) % n, true);
          else if (e.key === 'ArrowLeft') this.select((i - 1 + n) % n, true);
          else if (e.key === 'Home') this.select(0, true);
          else if (e.key === 'End') this.select(n - 1, true);
        });
      });
      this.select(0, false);
    }
    select(index, focus) {
      this.tabs.forEach(function (tab, i) {
        var on = i === index;
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(tab.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (focus) this.tabs[index].focus();
    }
  }
  customElements.define('product-tabs', ProductTabs);

  /* ------------------------------------------------------------------ */
  /* Collection and search filtering (Section Rendering API)            */
  /* ------------------------------------------------------------------ */
  class FacetFilters extends HTMLElement {
    connectedCallback() {
      this.sectionId = this.dataset.sectionId;
      this.bind();
      this.onPop = () => this.render(window.location.search, false);
      window.addEventListener('popstate', this.onPop);
    }
    disconnectedCallback() { window.removeEventListener('popstate', this.onPop); }
    bind() {
      if (this.bound) return;
      this.bound = true;
      var debounced = debounce(() => this.submit(), 600);
      this.addEventListener('change', (e) => {
        var form = this.querySelector('[data-facet-form]');
        if (!form || e.target.form !== form) return;
        if (e.target.type === 'number') debounced(); else this.submit();
      });
      this.addEventListener('input', (e) => {
        if (e.target.type === 'number') debounced();
      });
      this.addEventListener('submit', (e) => {
        if (e.target.matches('[data-facet-form]')) {
          e.preventDefault();
          this.submit();
        }
      });
      this.addEventListener('click', (e) => {
        var more = e.target.closest('[data-facet-more]');
        if (more) {
          var fs = more.closest('.facet__values');
          fs.classList.toggle('is-expanded');
          more.textContent = fs.classList.contains('is-expanded') ? 'Show fewer' : 'Show all';
          return;
        }
        var link = e.target.closest('a[data-facet-link]');
        if (link) {
          e.preventDefault();
          this.render(new URL(link.href, window.location.origin).search, true);
        }
      });
    }
    submit() {
      var form = this.querySelector('[data-facet-form]');
      if (!form) return;
      var params = new URLSearchParams();
      new FormData(form).forEach(function (value, key) {
        if (value !== '') params.append(key, value);
      });
      this.render('?' + params.toString(), true);
    }
    render(search, push) {
      var query = search.replace(/^\?/, '');
      var params = new URLSearchParams(query);
      params.delete('page');
      params.delete('section_id');
      var clean = params.toString();
      var pageUrl = window.location.pathname + (clean ? '?' + clean : '');
      var fetchUrl = window.location.pathname + '?' + (clean ? clean + '&' : '') + 'section_id=' + encodeURIComponent(this.sectionId);

      if (this.abort) this.abort.abort();
      this.abort = new AbortController();
      this.classList.add('is-loading');

      fetch(fetchUrl, { signal: this.abort.signal })
        .then(function (res) { return res.text(); })
        .then((html) => {
          var doc = parseHTML(html);
          var openStates = {};
          this.querySelectorAll('details[data-facet-index]').forEach(function (d) { openStates[d.dataset.facetIndex] = d.open; });
          var focusId = document.activeElement && document.activeElement.id;

          this.querySelectorAll('[data-facet-swap][id]').forEach(function (el) {
            var fresh = doc.getElementById(el.id);
            if (fresh) el.replaceWith(fresh);
          });
          var sort = this.querySelector('select[name="sort_by"]');
          var freshSort = sort && doc.getElementById(sort.id);
          if (sort && freshSort) sort.value = freshSort.value;

          this.querySelectorAll('details[data-facet-index]').forEach(function (d) {
            if (d.dataset.facetIndex in openStates) d.open = openStates[d.dataset.facetIndex];
          });
          if (focusId) {
            var el = document.getElementById(focusId);
            if (el) el.focus({ preventScroll: true });
          }
          if (push) window.history.pushState({}, '', pageUrl);
          var count = this.querySelector('.toolbar__count');
          if (count) announce(count.textContent.trim());
        })
        .catch(function (err) {
          if (err.name !== 'AbortError') window.location.href = pageUrl;
        })
        .finally(() => this.classList.remove('is-loading'));
    }
  }
  customElements.define('facet-filters', FacetFilters);

  /* ------------------------------------------------------------------ */
  /* Product recommendations (lazy-loaded)                              */
  /* ------------------------------------------------------------------ */
  class ProductRecommendations extends HTMLElement {
    connectedCallback() {
      if (!this.dataset.url || this.querySelector('.rail__track')) return;
      var load = () => {
        fetch(this.dataset.url)
          .then(function (res) { return res.text(); })
          .then((html) => {
            var doc = parseHTML(html);
            var fresh = doc.querySelector('product-recommendations');
            if (fresh && fresh.querySelector('.rail__track')) {
              this.innerHTML = fresh.innerHTML;
            } else {
              this.remove();
            }
          })
          .catch(() => this.remove());
      };
      if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
          if (entries[0].isIntersecting) {
            io.disconnect();
            load();
          }
        }, { rootMargin: '0px 0px 400px 0px' });
        io.observe(this);
      } else {
        load();
      }
    }
  }
  customElements.define('product-recommendations', ProductRecommendations);

  /* ------------------------------------------------------------------ */
  /* Email popup: once per visitor, after a delay                       */
  /* ------------------------------------------------------------------ */
  var POPUP_KEY = 'luxetech:popup';
  var POPUP_SUBMITTED = 'luxetech:popup-submitted';

  function storageGet(store, key) {
    try { return store.getItem(key); } catch (e) { return null; }
  }
  function storageSet(store, key, value) {
    try { store.setItem(key, value); } catch (e) { /* storage blocked: popup may show again, nothing breaks */ }
  }
  function storageRemove(store, key) {
    try { store.removeItem(key); } catch (e) { /* ignore */ }
  }

  class NewsletterPopup extends HTMLElement {
    connectedCallback() {
      this.dialog = this.querySelector('dialog');
      if (!this.dialog || typeof this.dialog.showModal !== 'function') return;

      this.querySelectorAll('[data-popup-close]').forEach((btn) => btn.addEventListener('click', () => this.dialog.close()));
      this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
      this.dialog.addEventListener('close', () => {
        unlockScroll();
        this.remember('closed');
      });
      var form = this.querySelector('form');
      if (form) {
        form.addEventListener('submit', () => {
          this.remember('subscribed');
          storageSet(window.sessionStorage, POPUP_SUBMITTED, '1');
        });
      }

      /* Back from a popup signup: show the confirmation (and code) once. */
      var justSubmitted = storageGet(window.sessionStorage, POPUP_SUBMITTED) === '1';
      if (justSubmitted && this.querySelector('.form-status')) {
        storageRemove(window.sessionStorage, POPUP_SUBMITTED);
        this.open();
        return;
      }

      if (this.dataset.preview === 'true') {
        this.open();
        return;
      }
      if (!this.shouldShow()) return;
      var delay = parseInt(this.dataset.delay, 10) || 9000;
      var canExit = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      if (this.dataset.trigger === 'exit' && canExit) {
        /* Exit intent: the pointer leaves through the top of the window. Armed after 3s so it can't fire on arrival. */
        this.onLeave = (e) => {
          if (e.relatedTarget || e.clientY > 0) return;
          document.removeEventListener('mouseout', this.onLeave);
          this.openWhenIdle();
        };
        this.timer = setTimeout(() => document.addEventListener('mouseout', this.onLeave), 3000);
      } else {
        this.timer = setTimeout(() => this.openWhenIdle(), delay);
      }
    }
    disconnectedCallback() {
      clearTimeout(this.timer);
      if (this.onLeave) document.removeEventListener('mouseout', this.onLeave);
    }
    shouldShow() {
      var raw = storageGet(window.localStorage, POPUP_KEY);
      if (!raw) return true;
      var record;
      try { record = JSON.parse(raw); } catch (e) { return false; }
      if (record.state === 'subscribed') return false;
      var days = parseInt(this.dataset.repeatDays, 10) || 0;
      if (days === 0) return false;
      return Date.now() - record.at > days * 86400000;
    }
    remember(state) {
      var raw = storageGet(window.localStorage, POPUP_KEY);
      if (raw && state === 'closed') {
        try { if (JSON.parse(raw).state === 'subscribed') return; } catch (e) { /* overwrite */ }
      }
      storageSet(window.localStorage, POPUP_KEY, JSON.stringify({ state: state, at: Date.now() }));
    }
    openWhenIdle() {
      /* Never interrupt an open drawer, quick add or lightbox; try again shortly. */
      var busy = document.querySelector('dialog[open]') || openDrawerEl;
      if (busy) {
        this.timer = setTimeout(() => this.openWhenIdle(), 4000);
        return;
      }
      this.open();
    }
    open() {
      if (this.dialog.open) return;
      this.dialog.showModal();
      lockScroll();
      var input = this.dialog.querySelector('input[type="email"]');
      if (input) input.focus();
    }
  }
  customElements.define('newsletter-popup', NewsletterPopup);

  document.addEventListener('click', function (e) {
    var copy = e.target.closest('[data-copy-code]');
    if (!copy) return;
    var code = copy.dataset.copyCode;
    var done = function () {
      copy.textContent = 'Copied';
      announce('Discount code copied');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done).catch(function () {});
    }
  });

  /* ------------------------------------------------------------------ */
  /* Small page behaviours                                              */
  /* ------------------------------------------------------------------ */
  document.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-toggle-recover]');
    if (toggle) {
      e.preventDefault();
      var recover = document.getElementById('RecoverPassword');
      var login = document.getElementById('CustomerLogin');
      if (recover && login) {
        var showRecover = recover.hidden;
        recover.hidden = !showRecover;
        login.hidden = showRecover;
        var focusTarget = (showRecover ? recover : login).querySelector('input[type="email"]');
        if (focusTarget) focusTarget.focus();
      }
    }
    var confirmBtn = e.target.closest('[data-confirm]');
    if (confirmBtn && !window.confirm(confirmBtn.dataset.confirm)) e.preventDefault();
  });

  document.addEventListener('DOMContentLoaded', function () {
    /* Recover password view after a reset request or #recover link */
    var recover = document.getElementById('RecoverPassword');
    if (recover && (window.location.hash === '#recover' || recover.querySelector('.form-status'))) {
      recover.hidden = false;
      var login = document.getElementById('CustomerLogin');
      if (login) login.hidden = true;
    }
    /* Address forms: preselect saved country */
    document.querySelectorAll('select[data-default]').forEach(function (select) {
      if (select.dataset.default) select.value = select.dataset.default;
    });
  });
})();
