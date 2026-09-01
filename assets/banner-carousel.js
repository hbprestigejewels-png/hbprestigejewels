/**
 * banner-carousel
 * ---------------
 * Zero-dependency replacement for the Swiper hero slider.
 *
 * Why this exists: the hero previously pulled swiper-bundle (~150 KB JS +
 * ~18 KB CSS) from a third-party CDN, which added a DNS + TLS handshake and a
 * large parse/compile task to the critical path before the LCP image could be
 * painted. Everything the hero actually used - a crossfade, autoplay, dots and
 * per-slide video sync - fits in the file below.
 *
 * Markup contract (rendered by sections/main-banner-swiper.liquid):
 *   <banner-carousel data-autoplay="5000">
 *     <div class="banner-carousel__track">
 *       <div class="banner-carousel__slide is-active">…</div>
 *     </div>
 *     <div class="banner-carousel__dots">
 *       <button class="banner-carousel__dot is-active" data-index="0"></button>
 *     </div>
 *   </banner-carousel>
 *
 * The first slide ships with `is-active` already applied server-side, so the
 * hero is fully painted before this script parses. Nothing here is required
 * for the LCP element to render.
 */
/**
 * True on connections where rotating the hero would cost the visitor more than
 * it gives them.
 *
 * Auto-advancing swaps in a second full-bleed image. On a slow link that paint
 * lands very late, and because it is the biggest thing on screen it becomes the
 * page's Largest Contentful Paint - so the carousel itself ends up defining the
 * headline metric. Holding still on 2G/3G, or when the visitor has asked for
 * reduced data, avoids that and saves the download entirely.
 */
function isSlowConnection() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return false;
  if (c.saveData) return true;
  return ['slow-2g', '2g', '3g'].includes(c.effectiveType);
}

/** How long after window load the hero waits before it starts advancing. */
const AUTOPLAY_START_GRACE_MS = 2000;

class BannerCarousel extends HTMLElement {
  connectedCallback() {
    this.slides = Array.from(this.querySelectorAll('.banner-carousel__slide'));
    if (this.slides.length === 0) return;

    this.dots = Array.from(this.querySelectorAll('.banner-carousel__dot'));
    this.index = Math.max(
      0,
      this.slides.findIndex((slide) => slide.classList.contains('is-active'))
    );
    this.autoplayDelay = parseInt(this.dataset.autoplay, 10) || 0;
    this.timer = null;
    this.visible = true;

    // A single slide needs no controls, no autoplay and no listeners.
    if (this.slides.length < 2) {
      this.syncVideos();
      return;
    }

    this.bindControls();
    this.observeVisibility();
    this.syncVideos();
    this.scheduleMediaPromotion();
  }

  disconnectedCallback() {
    this.stop();
    this.observer?.disconnect();
  }

  bindControls() {
    this.dots.forEach((dot) => {
      dot.addEventListener('click', () => {
        this.goTo(Number(dot.dataset.index));
        this.restart();
      });
    });

    // Keyboard support for the dot group.
    this.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') this.goTo(this.index + 1);
      else if (event.key === 'ArrowLeft') this.goTo(this.index - 1);
      else return;
      this.restart();
    });

    // Touch / pointer swipe. Listeners are passive so they never block scrolling.
    let startX = null;
    this.addEventListener(
      'touchstart',
      (event) => {
        startX = event.changedTouches[0].clientX;
      },
      { passive: true }
    );
    this.addEventListener(
      'touchend',
      (event) => {
        if (startX === null) return;
        const delta = event.changedTouches[0].clientX - startX;
        startX = null;
        if (Math.abs(delta) < 40) return;
        this.goTo(delta < 0 ? this.index + 1 : this.index - 1);
        this.restart();
      },
      { passive: true }
    );

    this.addEventListener('mouseenter', () => this.stop());
    this.addEventListener('mouseleave', () => this.start());
    this.addEventListener('focusin', () => this.stop());
    this.addEventListener('focusout', () => this.start());

    // Never burn CPU animating a tab nobody is looking at.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else this.start();
    });
  }

  /** Autoplay only runs while the hero is actually on screen. */
  observeVisibility() {
    if (!('IntersectionObserver' in window)) {
      this.start();
      return;
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        this.visible = entries[0].isIntersecting;
        if (this.visible) this.start();
        else this.stop();
      },
      { threshold: 0.2 }
    );
    this.observer.observe(this);
  }

  /**
   * Slides after the first ship with data-src / data-srcset so they cannot
   * compete with the LCP image for bandwidth. Promote them to real attributes
   * once the page has finished loading - or immediately, if the visitor gets
   * to a slide before that happens.
   */
  scheduleMediaPromotion() {
    const promoteAll = () => this.slides.forEach((slide) => this.promoteMedia(slide));

    // If the carousel will never advance on its own, there is no reason to
    // fetch the other slides at all until the visitor asks for one. On a slow
    // connection that saves the entire weight of every slide but the first.
    if (!this.autoplayDelay || isSlowConnection()) {
      ['pointerdown', 'keydown', 'touchstart'].forEach((evt) =>
        this.addEventListener(evt, promoteAll, { once: true, passive: true })
      );
      return;
    }

    if (document.readyState === 'complete') {
      requestIdleCallbackShim(promoteAll);
    } else {
      window.addEventListener('load', () => requestIdleCallbackShim(promoteAll), { once: true });
    }
  }

  promoteMedia(slide) {
    slide.querySelectorAll('img[data-src], img[data-srcset], source[data-srcset]').forEach((el) => {
      // <source> must be set before the <img> so the browser picks the right
      // candidate the first time rather than fetching the fallback and then
      // re-evaluating.
      if (el.dataset.srcset) {
        el.srcset = el.dataset.srcset;
        delete el.dataset.srcset;
      }
      if (el.dataset.src) {
        el.src = el.dataset.src;
        delete el.dataset.src;
      }
    });
  }

  goTo(rawIndex) {
    const count = this.slides.length;
    const next = ((rawIndex % count) + count) % count;
    if (next === this.index) return;

    // Make sure the incoming slide has its media before it fades in.
    this.promoteMedia(this.slides[next]);

    this.slides[this.index].classList.remove('is-active');
    this.slides[this.index].setAttribute('aria-hidden', 'true');
    this.dots[this.index]?.classList.remove('is-active');
    this.dots[this.index]?.setAttribute('aria-selected', 'false');

    this.index = next;

    this.slides[next].classList.add('is-active');
    this.slides[next].removeAttribute('aria-hidden');
    this.dots[next]?.classList.add('is-active');
    this.dots[next]?.setAttribute('aria-selected', 'true');

    this.syncVideos();
  }

  /** Play the active slide's video (if it opted into autoplay), pause the rest. */
  syncVideos() {
    const videos = this.querySelectorAll('video');
    if (videos.length === 0) return;

    videos.forEach((video) => {
      const slide = video.closest('.banner-carousel__slide');
      const isActive = slide && slide.classList.contains('is-active');

      if (isActive && video.hasAttribute('autoplay')) {
        // Browsers require the muted *property*, not just the attribute.
        if (video.hasAttribute('muted')) video.muted = true;
        video.play()?.catch(() => {
          /* autoplay blocked - nothing to do */
        });
      } else if (!isActive) {
        video.pause();
        if (!video.loop) video.currentTime = 0;
      }
    });
  }

  start() {
    if (this.timer || !this.autoplayDelay || !this.visible || document.hidden) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (isSlowConnection()) return;

    // Hold autoplay until the page has finished loading. Advancing the hero
    // while the rest of the page is still arriving competes for bandwidth and
    // main thread, and swapping in a second full-bleed image mid-load makes
    // that late paint the page's Largest Contentful Paint. Nothing above the
    // fold needs the carousel to be moving in the first seconds of a visit.
    if (!this.readyToAutoplay) {
      this.waitForLoad();
      return;
    }

    this.timer = setInterval(() => this.goTo(this.index + 1), this.autoplayDelay);
  }

  waitForLoad() {
    if (this.waitingForLoad) return;
    this.waitingForLoad = true;

    const begin = () => {
      this.readyToAutoplay = true;
      this.waitingForLoad = false;
      this.start();
    };

    if (document.readyState === 'complete') {
      setTimeout(begin, AUTOPLAY_START_GRACE_MS);
    } else {
      window.addEventListener('load', () => setTimeout(begin, AUTOPLAY_START_GRACE_MS), { once: true });
    }
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  restart() {
    this.stop();
    this.start();
  }
}

if (!customElements.get('banner-carousel')) {
  customElements.define('banner-carousel', BannerCarousel);
}

/** requestIdleCallback is still unimplemented in Safari; fall back to a timeout. */
function requestIdleCallbackShim(callback) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(callback, { timeout: 2000 });
  } else {
    setTimeout(callback, 200);
  }
}
