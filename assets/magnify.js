// Universal In-Box Image Zoom Controller (Full HD + prevents modal-opener from firing)
function setupInBoxZoom() {
  const containers = document.querySelectorAll(
    'modal-opener.product__inbox-zoom-wrapper:not([data-in-box-zoom-bound])'
  );

  containers.forEach((container) => {
    container.dataset.inBoxZoomBound = 'true';

    const mediaBox = container.querySelector('.product__media') || container;
    const img = container.querySelector('img');
    if (!img || !mediaBox) return;

    container.style.cursor = 'zoom-in';

    let zoomOverlay = null;
    let spinner = null;

    const getFullHdUrl = (src) => {
      if (!src) return '';
      let fullUrl = src;
      if (fullUrl.startsWith('//')) {
        fullUrl = window.location.protocol + fullUrl;
      }
      // Request max resolution from Shopify CDN
      return fullUrl.replace(/_([0-9]+)x([0-9]*)/g, '_2500x').replace(/width=[0-9]+/g, 'width=2500');
    };

    const updatePosition = (clientX, clientY) => {
      if (!zoomOverlay) return;
      const rect = mediaBox.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const xPercent = Math.max(0, Math.min(100, (x / rect.width) * 100));
      const yPercent = Math.max(0, Math.min(100, (y / rect.height) * 100));
      zoomOverlay.style.backgroundPosition = `${xPercent}% ${yPercent}%`;
    };

    const removeZoom = () => {
      if (spinner) { spinner.remove(); spinner = null; }
      if (zoomOverlay) {
        zoomOverlay.remove();
        zoomOverlay = null;
        container.style.cursor = 'zoom-in';
      }
    };

    const toggleZoom = (e) => {
      // Don't intercept variant selector clicks
      if (e.target.closest('variant-selects, .product-form, select, input, button:not(.product__media-toggle)')) return;

      // Prevent modal-opener from opening the full-screen modal
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (zoomOverlay || spinner) {
        removeZoom();
      } else {
        const rawSrc = container.dataset.zoomSrc || img.currentSrc || img.src;
        const zoomSrc = getFullHdUrl(rawSrc);

        // Show loading spinner
        spinner = document.createElement('div');
        spinner.className = 'in-box-zoom-loader';
        mediaBox.style.position = 'relative';
        mediaBox.appendChild(spinner);

        // Create zoom overlay (invisible until HD image loads)
        zoomOverlay = document.createElement('div');
        zoomOverlay.className = 'in-box-zoom-overlay';
        zoomOverlay.style.cssText = `
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          height: 100% !important;
          z-index: 999999 !important;
          background-size: 250% !important;
          background-repeat: no-repeat !important;
          background-color: #ffffff !important;
          border-radius: inherit !important;
          cursor: zoom-out !important;
          box-sizing: border-box !important;
          pointer-events: auto !important;
          opacity: 0;
          transition: opacity 0.25s ease !important;
        `;

        mediaBox.style.position = 'relative';
        mediaBox.style.overflow = 'hidden';
        mediaBox.appendChild(zoomOverlay);
        container.style.cursor = 'zoom-out';

        updatePosition(e.clientX, e.clientY);

        // Preload Full HD 2500px image
        const imgPreloader = new Image();
        imgPreloader.onload = function () {
          if (spinner) { spinner.remove(); spinner = null; }
          if (zoomOverlay) {
            zoomOverlay.style.backgroundImage = `url("${zoomSrc}")`;
            zoomOverlay.style.opacity = '1';
          }
        };
        imgPreloader.onerror = function () {
          if (spinner) { spinner.remove(); spinner = null; }
          if (zoomOverlay) {
            zoomOverlay.style.backgroundImage = `url("${img.currentSrc || img.src}")`;
            zoomOverlay.style.opacity = '1';
          }
        };
        imgPreloader.src = zoomSrc;

        // Click on overlay = zoom out
        zoomOverlay.addEventListener('click', (ze) => {
          ze.preventDefault();
          ze.stopPropagation();
          removeZoom();
        }, true);
      }
    };

    // Capture phase so we intercept before modal-opener's own click handler
    container.addEventListener('click', toggleZoom, true);

    container.addEventListener('mousemove', (e) => {
      if (zoomOverlay) updatePosition(e.clientX, e.clientY);
    });

    container.addEventListener('mouseleave', () => removeZoom());
  });
}

// Initial setup
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupInBoxZoom);
} else {
  setupInBoxZoom();
}

// Re-run when Shopify section reloads
document.addEventListener('shopify:section:load', setupInBoxZoom);

// Use MutationObserver to catch new images added by variant switching
const zoomObserver = new MutationObserver(() => setupInBoxZoom());
zoomObserver.observe(document.body, { childList: true, subtree: true });
