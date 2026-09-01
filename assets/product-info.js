if (!customElements.get('product-info')) {
  customElements.define(
    'product-info',
    class ProductInfo extends HTMLElement {
      quantityInput = undefined;
      quantityForm = undefined;
      onVariantChangeUnsubscriber = undefined;
      cartUpdateUnsubscriber = undefined;
      abortController = undefined;
      pendingRequestUrl = null;
      preProcessHtmlCallbacks = [];
      postProcessHtmlCallbacks = [];

      constructor() {
        super();

        this.quantityInput = this.querySelector('.quantity__input');
      }

      connectedCallback() {
        this.initializeProductSwapUtility();

        this.onVariantChangeUnsubscriber = subscribe(
          PUB_SUB_EVENTS.optionValueSelectionChange,
          this.handleOptionValueChange.bind(this)
        );

        this.initQuantityHandlers();
        this.dispatchEvent(new CustomEvent('product-info:loaded', { bubbles: true }));
      }

      addPreProcessCallback(callback) {
        this.preProcessHtmlCallbacks.push(callback);
      }

      initQuantityHandlers() {
        if (!this.quantityInput) return;

        this.quantityForm = this.querySelector('.product-form__quantity');
        if (!this.quantityForm) return;

        this.setQuantityBoundries();
        if (!this.dataset.originalSection) {
          this.cartUpdateUnsubscriber = subscribe(PUB_SUB_EVENTS.cartUpdate, this.fetchQuantityRules.bind(this));
        }
      }

      disconnectedCallback() {
        this.onVariantChangeUnsubscriber();
        this.cartUpdateUnsubscriber?.();
      }

      initializeProductSwapUtility() {
        this.preProcessHtmlCallbacks.push((html) =>
          html.querySelectorAll('.scroll-trigger').forEach((element) => element.classList.add('scroll-trigger--cancel'))
        );
        this.postProcessHtmlCallbacks.push((newNode) => {
          window?.Shopify?.PaymentButton?.init();
          window?.ProductModel?.loadShopifyXR();
        });
      }

      handleOptionValueChange({ data: { event, target, selectedOptionValues, currentVariant, variantId } }) {
        if (!this.contains(event.target)) return;

        this.resetProductFormState();

        const rawProductUrl = target.dataset.productUrl || this.pendingRequestUrl || this.dataset.url;
        this.pendingRequestUrl = rawProductUrl;
        
        // Compare pathnames only (ignore query parameters like ?variant=ID) to detect actual product swap
        const currentPathname = new URL(this.dataset.url || window.location.pathname, window.location.origin).pathname;
        const targetPathname = new URL(rawProductUrl || window.location.href, window.location.origin).pathname;
        const shouldSwapProduct = currentPathname !== targetPathname;
        const shouldFetchFullPage = this.dataset.updateUrl === 'true' && shouldSwapProduct;

        // Clean product URL without query params for URL bar updates
        const productUrl = targetPathname;

        // For same-product variant changes: use instant client-side update
        if (!shouldSwapProduct) {
          const variant = currentVariant || this.variantSelectors?.currentVariant;
          this.clientSideVariantUpdate(variant, rawProductUrl);
          return;
        }

        // Fallback: AJAX fetch (only used for actual product swaps across handles)
        const effectiveVariantId = variantId || currentVariant?.id;
        this.renderProductInfo({
          requestUrl: this.buildRequestUrlWithParams(productUrl, selectedOptionValues, shouldFetchFullPage, effectiveVariantId),
          targetId: target.id,
          callback: shouldSwapProduct
            ? this.handleSwapProduct(productUrl, shouldFetchFullPage)
            : this.handleUpdateProductInfo(productUrl),
        });
      }

      /**
       * Instantly update page with variant data without any AJAX fetch.
       * Uses the variant JSON pre-loaded in data-product-variants script tag.
       */
      clientSideVariantUpdate(variant, productUrl) {
        const sectionId = this.dataset.section;

        // 1. Update URL
        this.updateURL(productUrl, variant?.id);

        // 2. Update variant form input
        this.updateVariantInputs(variant?.id);

        // 3. Update pickup availability
        this.pickupAvailability?.update(variant);

        // 4. Handle unavailable vs available variant
        if (!variant) {
          this.setUnavailable();
          return;
        }

        // Unhide price and variant info elements
        const priceWrapper =
          document.getElementById(`price-${sectionId}`) ||
          document.querySelector(`[id^="price-${sectionId}"]`);
        if (priceWrapper) {
          priceWrapper.classList.remove('hidden');
          priceWrapper.style.display = '';
        }

        const selectors = ['Inventory', 'Sku', 'Price-Per-Item', 'Volume-Note', 'Volume', 'Quantity-Rules']
          .map((id) => `#${id}-${sectionId}`)
          .join(', ');
        document.querySelectorAll(selectors).forEach(({ classList }) => classList.remove('hidden'));

        // 5. Update Add to Cart button
        if (this.productForm) {
          const isDisabled = !variant.available;
          this.productForm.toggleSubmitButton(isDisabled, window.variantStrings?.soldOut || 'Sold out');
        }

        // 6. Update media gallery image
        const featuredMedia = variant.featured_media || variant.featured_image;
        if (featuredMedia && featuredMedia.id) {
          const mediaId = `${sectionId}-${featuredMedia.id}`;
          const mediaGallery = this.querySelector('media-gallery') || document.querySelector('media-gallery');
          if (mediaGallery && typeof mediaGallery.setActiveMedia === 'function') {
            mediaGallery.setActiveMedia(mediaId, false);
          }
        }

        // 7. Update price display
        this.updatePriceDOM(variant, sectionId);

        // 8. Publish variant change event for other subscribers
        publish(PUB_SUB_EVENTS.variantChange, {
          data: {
            sectionId: this.sectionId,
            html: null,
            variant,
          },
        });
      }

      /**
       * Directly update price elements in the DOM from variant data.
       * Uses shop.money_format set in theme.liquid for correct currency symbol.
       */
      updatePriceDOM(variant, sectionId) {
        const priceWrapper =
          document.getElementById(`price-${sectionId}`) ||
          document.querySelector(`[id^="price-${sectionId}"]`);
        if (!priceWrapper) return;

        const price = variant.price;
        const compareAtPrice = variant.compare_at_price;
        const available = variant.available;
        const isOnSale = compareAtPrice && compareAtPrice > price;

        /**
         * Full implementation of Shopify's formatMoney function.
         * Handles: {{amount}}, {{amount_no_decimals}}, {{amount_with_comma_separator}}, etc.
         */
        const formatMoney = (cents) => {
          // Use Shopify's native formatMoney if available
          if (window.Shopify && typeof window.Shopify.formatMoney === 'function') {
            const fmt = window.Shopify.currency_code_enabled
              ? window.Shopify.money_with_currency_format
              : window.Shopify.money_format;
            return window.Shopify.formatMoney(cents, fmt);
          }

          // Implement format parser ourselves
          const moneyFormat = window.Shopify?.currency_code_enabled
            ? window.Shopify?.money_with_currency_format
            : window.Shopify?.money_format;

          if (!moneyFormat) {
            // Last resort fallback: read symbol from existing price on page
            const existingPrice = priceWrapper.querySelector('.price-item');
            const existingText = existingPrice?.textContent?.trim() || '';
            const symbol = existingText.match(/^[^\d\s,\.]+/)?.[0] || '';
            return symbol + (cents / 100).toFixed(2);
          }

          const value = cents / 100;
          const formatParts = moneyFormat.match(/\{\{(\w+)\}\}/);
          if (!formatParts) return moneyFormat;

          const formatType = formatParts[1];
          let formattedValue;

          switch (formatType) {
            case 'amount':
              formattedValue = value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
              break;
            case 'amount_no_decimals':
              formattedValue = Math.floor(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
              break;
            case 'amount_with_comma_separator':
              formattedValue = value.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
              break;
            case 'amount_no_decimals_with_comma_separator':
              formattedValue = Math.floor(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
              break;
            case 'amount_with_apostrophe_separator':
              formattedValue = value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
              break;
            default:
              formattedValue = value.toFixed(2);
          }

          return moneyFormat.replace(/\{\{\w+\}\}/, formattedValue);
        };

        const priceEl = priceWrapper.querySelector('.price');
        if (!priceEl) return;

        const calcCompareAtPrice = (compareAtPrice && compareAtPrice > price)
          ? compareAtPrice
          : Math.round(price * 100 / 70);
        const discountPercent = Math.round((calcCompareAtPrice - price) * 100 / calcCompareAtPrice);

        // Toggle sale/sold-out classes
        priceEl.classList.toggle('price--sold-out', !available);
        priceEl.classList.add('price--on-sale');

        const formattedPrice = formatMoney(price);
        const formattedCompare = formatMoney(calcCompareAtPrice);

        // Update price text in sale container (.price__sale)
        const saleContainer = priceEl.querySelector('.price__sale');
        if (saleContainer) saleContainer.style.display = '';

        const salePriceEl = priceEl.querySelector('.price__sale .price-item--sale, .price-item--sale');
        if (salePriceEl) salePriceEl.textContent = formattedPrice;

        // Show compare-at (strikethrough)
        const compareEls = priceEl.querySelectorAll('s.price-item--regular, .price__sale s');
        compareEls.forEach((el) => {
          el.textContent = formattedCompare;
          el.closest('span')?.classList.remove('hidden');
        });

        // Update discount badge
        const discountBadgeEl = priceEl.querySelector('[data-discount-badge], .price__badge-discount');
        if (discountBadgeEl) {
          discountBadgeEl.textContent = `${discountPercent}% OFF`;
        }
      }

      resetProductFormState() {
        const productForm = this.productForm;
        productForm?.toggleSubmitButton(true);
        productForm?.handleErrorMessage();
      }

      handleSwapProduct(productUrl, updateFullPage) {
        return (html) => {
          this.productModal?.remove();

          const selector = updateFullPage ? "product-info[id^='MainProduct']" : 'product-info';
          const variant = this.getSelectedVariant(html.querySelector(selector)) || this.variantSelectors?.currentVariant;
          this.updateURL(productUrl, variant?.id);

          if (updateFullPage) {
            document.querySelector('head title').innerHTML = html.querySelector('head title').innerHTML;

            HTMLUpdateUtility.viewTransition(
              document.querySelector('main'),
              html.querySelector('main'),
              this.preProcessHtmlCallbacks,
              this.postProcessHtmlCallbacks
            );
          } else {
            HTMLUpdateUtility.viewTransition(
              this,
              html.querySelector('product-info'),
              this.preProcessHtmlCallbacks,
              this.postProcessHtmlCallbacks
            );
          }
        };
      }

      renderProductInfo({ requestUrl, targetId, callback }) {
        this.abortController?.abort();
        this.abortController = new AbortController();

        fetch(requestUrl, { signal: this.abortController.signal })
          .then((response) => response.text())
          .then((responseText) => {
            this.pendingRequestUrl = null;
            const html = new DOMParser().parseFromString(responseText, 'text/html');
            callback(html);
          })
          .then(() => {
            // set focus to last clicked option value
            document.querySelector(`#${targetId}`)?.focus();
          })
          .catch((error) => {
            if (error.name === 'AbortError') {
              console.log('Fetch aborted by user');
            } else {
              console.error(error);
            }
          });
      }

      getSelectedVariant(productInfoNode) {
        const selectedVariant = productInfoNode.querySelector('variant-selects [data-selected-variant]')?.innerHTML;
        return !!selectedVariant ? JSON.parse(selectedVariant) : null;
      }

      buildRequestUrlWithParams(url, optionValues, shouldFetchFullPage = false, variantId = null) {
        const params = [];

        !shouldFetchFullPage && params.push(`section_id=${this.sectionId}`);

        if (variantId) {
          params.push(`variant=${variantId}`);
        } else if (optionValues && optionValues.length) {
          params.push(`option_values=${optionValues.join(',')}`);
        }

        return `${url}?${params.join('&')}`;
      }

      updateOptionValues(html) {
        const variantSelects = html.querySelector('variant-selects');
        if (variantSelects) {
          HTMLUpdateUtility.viewTransition(this.variantSelectors, variantSelects, this.preProcessHtmlCallbacks);
        }
      }

      handleUpdateProductInfo(productUrl) {
        return (html) => {
          const variant = this.getSelectedVariant(html) || this.variantSelectors?.currentVariant;
          console.log("Selected Variant", variant);
          console.log("Variant Price", variant?.price);
          console.log("Compare Price", variant?.compare_at_price);

          this.pickupAvailability?.update(variant);
          this.updateOptionValues(html);
          this.updateURL(productUrl, variant?.id);
          this.updateVariantInputs(variant?.id);

          if (!variant) {
            this.setUnavailable();
            return;
          }

          this.updateMedia(html, variant?.featured_media?.id);

          // Selected Variants Code
          // Selected Variants Code
if (variant && variant.options) {
  const variantValues = variant.options;

  const mediaGallery = document.querySelector(
    `[id^="MediaGallery-${this.dataset.section}"]`
  );

  if (mediaGallery && mediaGallery.hasAttribute("image-grouping-enabled")) {
    mediaGallery.querySelectorAll("[data-image-group]").forEach((el) => {
      el.classList.add("hide-media");
    });

    variantValues.forEach((value) => {
      mediaGallery
        .querySelectorAll(`[data-image-group="${value}"]`)
        .forEach((el) => {
          el.classList.remove("hide-media");
        });
    });

    mediaGallery.querySelectorAll("slider-component").forEach((slider) => {
      slider.initPages();
    });
  }
}
          // Selected Variants Code end

          const updateSourceFromDestination = (id, shouldHide = (source) => false) => {
            const source =
              html.getElementById(`${id}-${this.sectionId}`) ||
              html.querySelector(`[id^="${id}-${this.sectionId}"]`) ||
              html.querySelector(`#${id}-${this.dataset.section}`);
            const destination =
              this.querySelector(`#${id}-${this.dataset.section}`) ||
              this.querySelector(`[id^="${id}-${this.dataset.section}"]`) ||
              document.querySelector(`#${id}-${this.dataset.section}`);
            if (source && destination) {
              destination.innerHTML = source.innerHTML;
              destination.classList.toggle('hidden', shouldHide(source));
            }
          };

          updateSourceFromDestination('price');
          updateSourceFromDestination('Sku', ({ classList }) => classList.contains('hidden'));
          updateSourceFromDestination('Inventory', ({ innerText }) => innerText === '');
          updateSourceFromDestination('Volume');
          updateSourceFromDestination('Price-Per-Item', ({ classList }) => classList.contains('hidden'));

          this.updateQuantityRules(this.sectionId, html);
          this.querySelector(`#Quantity-Rules-${this.dataset.section}`)?.classList.remove('hidden');
          this.querySelector(`#Volume-Note-${this.dataset.section}`)?.classList.remove('hidden');

          this.productForm?.toggleSubmitButton(
            html.getElementById(`ProductSubmitButton-${this.sectionId}`)?.hasAttribute('disabled') ?? true,
            window.variantStrings.soldOut
          );

          publish(PUB_SUB_EVENTS.variantChange, {
            data: {
              sectionId: this.sectionId,
              html,
              variant,
            },
          });
        };
      }

      updateVariantInputs(variantId) {
        this.querySelectorAll(
          `#product-form-${this.dataset.section}, #product-form-installment-${this.dataset.section}`
        ).forEach((productForm) => {
          const input = productForm.querySelector('input[name="id"]');
          input.value = variantId ?? '';
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }

      updateURL(url, variantId) {
        this.querySelector('share-button')?.updateUrl(
          `${window.shopUrl}${url}${variantId ? `?variant=${variantId}` : ''}`
        );

        if (this.dataset.updateUrl === 'false') return;
        window.history.replaceState({}, '', `${url}${variantId ? `?variant=${variantId}` : ''}`);
      }

      setUnavailable() {
        this.productForm?.toggleSubmitButton(true, window.variantStrings.unavailable);

        const selectors = ['price', 'Inventory', 'Sku', 'Price-Per-Item', 'Volume-Note', 'Volume', 'Quantity-Rules']
          .map((id) => `#${id}-${this.dataset.section}`)
          .join(', ');
        document.querySelectorAll(selectors).forEach(({ classList }) => classList.add('hidden'));
      }

      updateMedia(html, variantFeaturedMediaId) {
        if (!variantFeaturedMediaId) return;

        const mediaGallerySource = this.querySelector('media-gallery ul');
        const mediaGalleryDestination = html.querySelector(`media-gallery ul`);

        const refreshSourceData = () => {
          if (this.hasAttribute('data-zoom-on-hover')) enableZoomOnHover(2);
          const mediaGallerySourceItems = Array.from(mediaGallerySource.querySelectorAll('li[data-media-id]'));
          const sourceSet = new Set(mediaGallerySourceItems.map((item) => item.dataset.mediaId));
          const sourceMap = new Map(
            mediaGallerySourceItems.map((item, index) => [item.dataset.mediaId, { item, index }])
          );
          return [mediaGallerySourceItems, sourceSet, sourceMap];
        };

        if (mediaGallerySource && mediaGalleryDestination) {
          let [mediaGallerySourceItems, sourceSet, sourceMap] = refreshSourceData();
          const mediaGalleryDestinationItems = Array.from(
            mediaGalleryDestination.querySelectorAll('li[data-media-id]')
          );
          const destinationSet = new Set(mediaGalleryDestinationItems.map(({ dataset }) => dataset.mediaId));
          let shouldRefresh = false;

          // add items from new data not present in DOM
          for (let i = mediaGalleryDestinationItems.length - 1; i >= 0; i--) {
            if (!sourceSet.has(mediaGalleryDestinationItems[i].dataset.mediaId)) {
              mediaGallerySource.prepend(mediaGalleryDestinationItems[i]);
              shouldRefresh = true;
            }
          }

          // remove items from DOM not present in new data
          for (let i = 0; i < mediaGallerySourceItems.length; i++) {
            if (!destinationSet.has(mediaGallerySourceItems[i].dataset.mediaId)) {
              mediaGallerySourceItems[i].remove();
              shouldRefresh = true;
            }
          }

          // refresh
          if (shouldRefresh) [mediaGallerySourceItems, sourceSet, sourceMap] = refreshSourceData();

          // if media galleries don't match, sort to match new data order
          mediaGalleryDestinationItems.forEach((destinationItem, destinationIndex) => {
            const sourceData = sourceMap.get(destinationItem.dataset.mediaId);

            if (sourceData && sourceData.index !== destinationIndex) {
              mediaGallerySource.insertBefore(
                sourceData.item,
                mediaGallerySource.querySelector(`li:nth-of-type(${destinationIndex + 1})`)
              );

              // refresh source now that it has been modified
              [mediaGallerySourceItems, sourceSet, sourceMap] = refreshSourceData();
            }
          });
        }

        // set featured media as active in the media gallery
        const mediaGallery = this.querySelector(`media-gallery`) || document.querySelector(`media-gallery`);
        mediaGallery?.setActiveMedia?.(
          `${this.dataset.section}-${variantFeaturedMediaId}`,
          true
        );

        // update media modal
        const modalContent = this.productModal?.querySelector(`.product-media-modal__content`);
        const newModalContent = html.querySelector(`product-modal .product-media-modal__content`);
        if (modalContent && newModalContent) modalContent.innerHTML = newModalContent.innerHTML;
      }

      setQuantityBoundries() {
        const data = {
          cartQuantity: this.quantityInput.dataset.cartQuantity ? parseInt(this.quantityInput.dataset.cartQuantity) : 0,
          min: this.quantityInput.dataset.min ? parseInt(this.quantityInput.dataset.min) : 1,
          max: this.quantityInput.dataset.max ? parseInt(this.quantityInput.dataset.max) : null,
          step: this.quantityInput.step ? parseInt(this.quantityInput.step) : 1,
        };

        let min = data.min;
        const max = data.max === null ? data.max : data.max - data.cartQuantity;
        if (max !== null) min = Math.min(min, max);
        if (data.cartQuantity >= data.min) min = Math.min(min, data.step);

        this.quantityInput.min = min;

        if (max) {
          this.quantityInput.max = max;
        } else {
          this.quantityInput.removeAttribute('max');
        }
        this.quantityInput.value = min;

        publish(PUB_SUB_EVENTS.quantityUpdate, undefined);
      }

      fetchQuantityRules() {
        const currentVariantId = this.productForm?.variantIdInput?.value;
        if (!currentVariantId) return;

        this.querySelector('.quantity__rules-cart .loading__spinner').classList.remove('hidden');
        return fetch(`${this.dataset.url}?variant=${currentVariantId}&section_id=${this.dataset.section}`)
          .then((response) => response.text())
          .then((responseText) => {
            const html = new DOMParser().parseFromString(responseText, 'text/html');
            this.updateQuantityRules(this.dataset.section, html);
          })
          .catch((e) => console.error(e))
          .finally(() => this.querySelector('.quantity__rules-cart .loading__spinner').classList.add('hidden'));
      }

      updateQuantityRules(sectionId, html) {
        if (!this.quantityInput) return;
        this.setQuantityBoundries();

        const quantityFormUpdated = html.getElementById(`Quantity-Form-${sectionId}`);
        const selectors = ['.quantity__input', '.quantity__rules', '.quantity__label'];
        for (let selector of selectors) {
          const current = this.quantityForm.querySelector(selector);
          const updated = quantityFormUpdated.querySelector(selector);
          if (!current || !updated) continue;
          if (selector === '.quantity__input') {
            const attributes = ['data-cart-quantity', 'data-min', 'data-max', 'step'];
            for (let attribute of attributes) {
              const valueUpdated = updated.getAttribute(attribute);
              if (valueUpdated !== null) {
                current.setAttribute(attribute, valueUpdated);
              } else {
                current.removeAttribute(attribute);
              }
            }
          } else {
            current.innerHTML = updated.innerHTML;
            if (selector === '.quantity__label') {
              const updatedAriaLabelledBy = updated.getAttribute('aria-labelledby');
              if (updatedAriaLabelledBy) {
                current.setAttribute('aria-labelledby', updatedAriaLabelledBy);
                // Update the referenced visually hidden element
                const labelId = updatedAriaLabelledBy;
                const currentHiddenLabel = document.getElementById(labelId);
                const updatedHiddenLabel = html.getElementById(labelId);
                if (currentHiddenLabel && updatedHiddenLabel) {
                  currentHiddenLabel.textContent = updatedHiddenLabel.textContent;
                }
              }
            }
          }
        }
      }

      get productForm() {
        return this.querySelector(`product-form`);
      }

      get productModal() {
        return document.querySelector(`#ProductModal-${this.dataset.section}`);
      }

      get pickupAvailability() {
        return this.querySelector(`pickup-availability`);
      }

      get variantSelectors() {
        return this.querySelector('variant-selects');
      }

      get relatedProducts() {
        const relatedProductsSectionId = SectionId.getIdForSection(
          SectionId.parseId(this.sectionId),
          'related-products'
        );
        return document.querySelector(`product-recommendations[data-section-id^="${relatedProductsSectionId}"]`);
      }

      get quickOrderList() {
        const quickOrderListSectionId = SectionId.getIdForSection(
          SectionId.parseId(this.sectionId),
          'quick_order_list'
        );
        return document.querySelector(`quick-order-list[data-id^="${quickOrderListSectionId}"]`);
      }

      get sectionId() {
        return this.dataset.originalSection || this.dataset.section;
      }
    }
  );
}
