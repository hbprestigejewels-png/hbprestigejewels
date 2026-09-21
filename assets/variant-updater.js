/**
 * Instant Client-Side Variant Updater
 * Reads all variants from data-product-variants JSON already rendered on the page.
 * When an option changes, finds the matching variant instantly and updates:
 *  - Price (sale + regular + compare)
 *  - Active media image in gallery
 *  - Browser URL (?variant=ID)
 *  - Add to Cart button availability
 *  - Variant input in product form
 */
(function () {
  'use strict';

  /**
   * Format a price integer (in cents) to money string.
   * Uses Shopify's money_format if available, otherwise falls back to division.
   */
  function formatMoney(cents) {
    if (window.Shopify && typeof window.Shopify.formatMoney === 'function') {
      return window.Shopify.formatMoney(cents, window.Shopify.money_format || '{{amount}}');
    }
    // Fallback: simple two-decimal format
    const amount = (cents / 100).toFixed(2);
    // Try to match currency symbol from existing price on page
    const existingPrice = document.querySelector('.price-item--regular, .price-item--sale');
    if (existingPrice) {
      const text = existingPrice.textContent.trim();
      const match = text.match(/^([^0-9\s]+)/);
      if (match) return match[1] + amount;
    }
    return '$' + amount;
  }

  function initVariantUpdater() {
    const variantSelectsEl = document.querySelector('variant-selects');
    if (!variantSelectsEl) return;

    // Get all variants from the JSON blob rendered on page
    const variantsScript = variantSelectsEl.querySelector('script[data-product-variants]');
    if (!variantsScript) return;

    let allVariants;
    try {
      allVariants = JSON.parse(variantsScript.textContent);
    } catch (e) {
      console.error('[VariantUpdater] Could not parse product variants JSON', e);
      return;
    }

    if (!allVariants || !allVariants.length) return;

    // Find the section ID from variant-selects data attribute
    const sectionId = variantSelectsEl.dataset.section;

    /**
     * Get currently selected option values ordered by option position (1-based).
     *
     * Special handling for combined-metal radio buttons:
     *   Each swatch input carries data-option1 (metal) and data-option2 (color)
     *   with data-mat-pos and data-col-pos for their respective option positions.
     *   These override hidden selects for the same positions.
     */
    function getCurrentOptions() {
      const byPosition = {};

      // ── 1. Read combined-metal radio (highest priority for option1 & option2) ──
      const checkedMetal = variantSelectsEl.querySelector(
        'input[type="radio"][data-option1]:checked, input[type="radio"][data-mat-pos]:checked'
      );
      if (checkedMetal) {
        const matPos = parseInt(checkedMetal.dataset.matPos || checkedMetal.dataset.optionPosition, 10) || 1;
        const colPos = parseInt(checkedMetal.dataset.colPos, 10) || 2;
        const opt1 = checkedMetal.dataset.option1;
        const opt2 = checkedMetal.dataset.option2;
        if (opt1) byPosition[matPos] = opt1;
        if (opt2) byPosition[colPos] = opt2;

        // Keep hidden selects in sync so Shopify form value is correct
        syncHiddenSelect(matPos, opt1);
        syncHiddenSelect(colPos, opt2);
      }

      // ── 2. Read remaining selects (ring size etc.) by data-option-position ──
      variantSelectsEl.querySelectorAll('select').forEach((sel) => {
        let pos = parseInt(sel.dataset.optionPosition, 10);
        if (!pos) {
          // Fallback: parse from id like "Option-SECTION-2" → position 3
          const m = sel.id?.match(/-(\d+)$/);
          if (m) pos = parseInt(m[1], 10) + 1;
        }
        if (!pos || !sel.value) return;
        // Only write if not already set by the metal radio
        if (!byPosition[pos]) {
          byPosition[pos] = sel.value;
        }
      });

      // ── 3. Fallback: regular radio fieldsets (non-combined) ──
      if (!checkedMetal) {
        variantSelectsEl.querySelectorAll('fieldset input[type="radio"]:checked').forEach((input) => {
          const pos = parseInt(input.dataset.optionPosition, 10);
          if (pos && !byPosition[pos]) byPosition[pos] = input.value;
        });
      }

      if (!Object.keys(byPosition).length) return [];

      return Object.keys(byPosition)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => byPosition[k]);
    }

    /**
     * Sync a hidden <select> for the given option position to the given value,
     * so Shopify's native form submission and other JS listeners stay correct.
     */
    function syncHiddenSelect(position, value) {
      if (!position || !value) return;
      const sel = variantSelectsEl.querySelector(
        `select[data-option-position="${position}"]`
      );
      if (sel && sel.value !== value) {
        sel.value = value;
        // Do NOT dispatchEvent to avoid race conditions with global.js
      }
    }

    /**
     * Find matching variant from allVariants based on selected options
     */
    function findMatchingVariant(selectedOptions) {
      return allVariants.find((variant) => {
        return variant.options.every((opt, idx) => {
          return selectedOptions[idx] === undefined || selectedOptions[idx] === opt;
        });
      }) || null;
    }

    /**
     * Update the price DOM elements directly with variant price data
     */
    function updatePrice(variant) {
      if (!variant) return;

      const priceWrapper = document.getElementById(`price-${sectionId}`) || document.querySelector(`[id^="price-${sectionId}"]`);
      if (!priceWrapper) return;

      const priceEl = priceWrapper.querySelector('.price');
      if (!priceEl) return;

      const price = variant.price;
      // MRP = compare_at_price if set, else admin price
      const mrpPrice = (variant.compare_at_price && variant.compare_at_price > price)
        ? variant.compare_at_price
        : price;
      const sellingPrice = Math.round(mrpPrice * 0.70);
      const discountPercent = 30;
      const available = variant.available;

      // Update price classes
      priceEl.classList.toggle('price--sold-out', !available);
      priceEl.classList.add('price--on-sale');

      // Make sure the sale container is visible
      const saleContainer = priceEl.querySelector('.price__sale');
      if (saleContainer) saleContainer.style.display = '';

      // Sale / Selling price = 30% off MRP
      const salePriceEl = priceEl.querySelector('.price__sale .price-item--sale, .price-item--sale');
      if (salePriceEl) {
        salePriceEl.innerHTML = formatMoney(sellingPrice);
      }

      // Compare at price (strikethrough) = MRP
      const compareEls = priceEl.querySelectorAll('.price-item--regular s, s.price-item--regular, .price__sale s');
      compareEls.forEach((el) => {
        el.innerHTML = formatMoney(mrpPrice);
        const parentSpan = el.closest('span');
        if (parentSpan) parentSpan.classList.remove('hidden');
      });

      // Discount badge — always 30% OFF
      const discountBadgeEl = priceEl.querySelector('[data-discount-badge], .price__badge-discount');
      if (discountBadgeEl) {
        discountBadgeEl.innerHTML = `${discountPercent}% OFF`;
      }
    }

    /**
     * Update the active media/image in the gallery
     */
    function updateMedia(variant) {
      if (!variant) return;
      const featuredMedia = variant.featured_media || variant.featured_image;
      if (!featuredMedia || !featuredMedia.id) return;

      const mediaGallery = document.querySelector('media-gallery');
      if (!mediaGallery) return;

      const mediaId = `${sectionId}-${featuredMedia.id}`;
      if (typeof mediaGallery.setActiveMedia === 'function') {
        mediaGallery.setActiveMedia(mediaId, false);
      }
    }

    /**
     * Update browser URL with variant ID
     */
    function updateURL(variant) {
      if (!variant) return;
      const url = window.location.pathname;
      const newUrl = `${url}?variant=${variant.id}`;
      window.history.replaceState({}, '', newUrl);
    }

    /**
     * Update variant hidden input in product form
     */
    function updateVariantInput(variant) {
      const input = document.querySelector(`#product-form-${sectionId} input[name="id"]`);
      if (input) {
        input.value = variant ? variant.id : '';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    /**
     * Update Add to Cart button state
     */
    function updateButton(variant) {
      const btn = document.getElementById(`ProductSubmitButton-${sectionId}`);
      if (!btn) return;

      if (!variant || !variant.available) {
        btn.disabled = true;
        const btnText = btn.querySelector('span');
        if (btnText) {
          btnText.textContent = !variant
            ? (window.variantStrings?.unavailable || 'Unavailable')
            : (window.variantStrings?.soldOut || 'Sold Out');
        }
      } else {
        btn.disabled = false;
        const btnText = btn.querySelector('span');
        if (btnText) {
          btnText.textContent = window.variantStrings?.addToCart || 'Add to cart';
        }
      }
    }

    /**
     * Main handler: called whenever any option changes
     */
    function onOptionChange() {
      const selectedOptions = getCurrentOptions();
      if (!selectedOptions.length) return;

      const variant = findMatchingVariant(selectedOptions);

      updatePrice(variant);
      updateMedia(variant);
      updateURL(variant);
      updateVariantInput(variant);
      updateButton(variant);
    }

    // Listen for changes on all fieldsets (radio buttons) and selects inside variant-selects
    variantSelectsEl.addEventListener('change', onOptionChange);

    // Also listen for custom pubsub events if available
    if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
      subscribe(PUB_SUB_EVENTS.optionValueSelectionChange, ({ data }) => {
        if (!variantSelectsEl.contains(data?.event?.target)) return;
        onOptionChange();
      });
    }

    console.log('[VariantUpdater] Initialized with', allVariants.length, 'variants');
  }

  // Run after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVariantUpdater);
  } else {
    initVariantUpdater();
  }

  // Re-init on Shopify section load (theme editor)
  document.addEventListener('shopify:section:load', initVariantUpdater);
})();
