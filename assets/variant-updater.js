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
     * Get currently selected option values ordered by option position (1-based)
     */
    function getCurrentOptions() {
      const byPosition = {};

      variantSelectsEl.querySelectorAll('fieldset input[type="radio"]:checked').forEach((input) => {
        const pos = parseInt(input.dataset.optionPosition, 10);
        if (pos) byPosition[pos] = input.value;
      });

      variantSelectsEl.querySelectorAll('select').forEach((select) => {
        let pos = parseInt(select.dataset.optionPosition, 10);
        if (!pos) {
          const match = select.id?.match(/-(\d+)$/);
          if (match) pos = parseInt(match[1], 10) + 1;
        }
        if (pos && select.value) {
          byPosition[pos] = select.value;
        }
      });

      if (!Object.keys(byPosition).length) {
        const fieldsetVals = Array.from(variantSelectsEl.querySelectorAll('fieldset')).map((f) =>
          Array.from(f.querySelectorAll('input')).find((r) => r.checked)?.value
        );
        const selectVals = Array.from(variantSelectsEl.querySelectorAll('select')).map((s) => s.value);
        return [...fieldsetVals, ...selectVals].filter((v) => v !== undefined);
      }

      return Object.keys(byPosition)
        .sort((a, b) => a - b)
        .map((k) => byPosition[k]);
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
      const compareAtPrice = variant.compare_at_price;
      const available = variant.available;
      const isOnSale = compareAtPrice && compareAtPrice > price;

      // Update price classes
      priceEl.classList.toggle('price--sold-out', !available);
      priceEl.classList.toggle('price--on-sale', !!isOnSale);

      // Regular price (shown when not on sale)
      const regularPriceEls = priceEl.querySelectorAll('.price__regular .price-item--regular');
      regularPriceEls.forEach((el) => {
        el.textContent = formatMoney(price);
      });

      // Sale price
      const salePriceEl = priceEl.querySelector('.price__sale .price-item--sale');
      if (salePriceEl) {
        salePriceEl.textContent = formatMoney(price);
      }

      // Compare at price (strikethrough)
      const compareEls = priceEl.querySelectorAll('.price-item--regular s, s.price-item--regular');
      compareEls.forEach((el) => {
        if (isOnSale) {
          el.textContent = formatMoney(compareAtPrice);
          el.closest('span')?.classList.remove('hidden');
        } else {
          el.closest('span')?.classList.add('hidden');
        }
      });

      // Show/hide sale vs regular containers
      const saleContainer = priceEl.querySelector('.price__sale');
      const regularContainer = priceEl.querySelector('.price__regular');
      if (saleContainer && regularContainer) {
        if (isOnSale) {
          regularContainer.style.display = 'none';
          saleContainer.style.display = '';
        } else {
          regularContainer.style.display = '';
          saleContainer.style.display = 'none';
        }
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
