/**
 * lazy-background
 * ---------------
 * Defers decorative CSS background images until their section is near the
 * viewport.
 *
 * An inline `style="background-image: url(...)"` is fetched as soon as the
 * element is styled, no matter where it sits on the page. On the home page that
 * meant three large decorative backgrounds (~220 KB) downloading in parallel
 * with the hero image - on a 3G connection they take bandwidth directly from
 * the LCP element for artwork the visitor cannot see yet.
 *
 * Usage: put the URL in data-bg instead of an inline background-image.
 *   <div class="thing" data-bg="https://.../image.jpg?width=1440"></div>
 *
 * Elements are loaded 300px before they scroll into view, so the image is in
 * place by the time it matters. With no IntersectionObserver support every
 * background is applied immediately, matching the old behaviour.
 */
(function () {
  const SELECTOR = '[data-bg]';

  function apply(el) {
    const url = el.dataset.bg;
    if (!url) return;
    el.style.backgroundImage = "url('" + url + "')";
    delete el.dataset.bg;
  }

  function init() {
    const elements = document.querySelectorAll(SELECTOR);
    if (elements.length === 0) return;

    if (!('IntersectionObserver' in window)) {
      elements.forEach(apply);
      return;
    }

    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          apply(entry.target);
          obs.unobserve(entry.target);
        });
      },
      { rootMargin: '300px 0px' }
    );

    elements.forEach((el) => observer.observe(el));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
