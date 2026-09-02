if (!customElements.get('product-form')) {
  customElements.define(
    'product-form',
    class ProductForm extends HTMLElement {
      constructor() {
        super();
        this.init();
      }

      connectedCallback() {
        this.init();
      }

      init() {
        this.form = this.querySelector('form');
        if (this.variantIdInput) this.variantIdInput.disabled = false;
        
        if (this.form && !this._hasSubmitListener) {
          this.form.addEventListener('submit', this.onSubmitHandler.bind(this));
          this._hasSubmitListener = true;
        }

        this.cart = document.querySelector('cart-notification') || document.querySelector('cart-drawer');
        this.submitButton = this.querySelector('[type="submit"]');
        this.submitButtonText = this.submitButton ? this.submitButton.querySelector('span') : null;

        if (document.querySelector('cart-drawer') && this.submitButton) {
          this.submitButton.setAttribute('aria-haspopup', 'dialog');
        }

        this.hideErrors = this.dataset.hideErrors === 'true';
      }

      onSubmitHandler(evt) {
        evt.preventDefault();
        if (!this.form) this.form = this.querySelector('form');
        if (!this.submitButton) this.submitButton = this.querySelector('[type="submit"]');
        if (!this.submitButton) return;
        if (this.submitButton.getAttribute('aria-disabled') === 'true') return;

        this.handleErrorMessage();

        this.submitButton.setAttribute('aria-disabled', true);
        this.submitButton.classList.add('loading');
        const spinner = this.querySelector('.loading__spinner');
        if (spinner) spinner.classList.remove('hidden');

        this.cart = this.cart || document.querySelector('cart-notification') || document.querySelector('cart-drawer');

        const config = typeof fetchConfig === 'function' ? fetchConfig('javascript') : {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          }
        };
        config.headers['X-Requested-With'] = 'XMLHttpRequest';
        delete config.headers['Content-Type'];

        const formData = new FormData(this.form);
        if (this.cart && typeof this.cart.getSectionsToRender === 'function') {
          formData.append(
            'sections',
            this.cart.getSectionsToRender().map((section) => section.id)
          );
          formData.append('sections_url', window.location.pathname);
          if (typeof this.cart.setActiveElement === 'function') {
            this.cart.setActiveElement(document.activeElement);
          }
        }
        config.body = formData;

        const cartAddUrl = (window.routes && window.routes.cart_add_url) ? window.routes.cart_add_url : '/cart/add.js';

        fetch(`${cartAddUrl}`, config)
          .then((response) => response.json())
          .then((response) => {
            if (response.status && response.status !== 200) {
              if (typeof publish === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
                publish(PUB_SUB_EVENTS.cartError, {
                  source: 'product-form',
                  productVariantId: formData.get('id'),
                  errors: response.errors || response.description,
                  message: response.message,
                });
              }
              this.handleErrorMessage(response.description);

              const soldOutMessage = this.submitButton.querySelector('.sold-out-message');
              if (!soldOutMessage) return;
              this.submitButton.setAttribute('aria-disabled', true);
              if (this.submitButtonText) this.submitButtonText.classList.add('hidden');
              soldOutMessage.classList.remove('hidden');
              this.error = true;
              return;
            }

            if (typeof publish === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
              publish(PUB_SUB_EVENTS.cartUpdate, {
                source: 'product-form',
                productVariantId: formData.get('id'),
                cartData: response,
              });
            }
            this.error = false;

            const quickAddModal = this.closest('quick-add-modal');
            if (quickAddModal) {
              document.body.addEventListener(
                'modalClosed',
                () => {
                  setTimeout(() => {
                    if (this.cart && typeof this.cart.renderContents === 'function') {
                      this.cart.renderContents(response);
                    }
                  });
                },
                { once: true }
              );
              quickAddModal.hide(true);
            } else if (this.cart && typeof this.cart.renderContents === 'function' && response.sections) {
              this.cart.renderContents(response);
            } else {
              // Direct Drawer Refresh Fallback
              const drawer = document.querySelector('cart-drawer');
              if (drawer) {
                fetch(`${window.location.pathname}?section_id=cart-drawer`)
                  .then(r => r.text())
                  .then(html => {
                    const parsed = new DOMParser().parseFromString(html, 'text/html');
                    const drawerContent = parsed.querySelector('#CartDrawer');
                    const currentDrawer = document.querySelector('#CartDrawer');
                    if (drawerContent && currentDrawer) {
                      currentDrawer.innerHTML = drawerContent.innerHTML;
                    }
                    if (typeof drawer.open === 'function') drawer.open();
                  });
                // Update cart icon bubble
                fetch(`${window.location.pathname}?section_id=cart-icon-bubble`)
                  .then(r => r.text())
                  .then(html => {
                    const parsed = new DOMParser().parseFromString(html, 'text/html');
                    const bubble = parsed.querySelector('#cart-icon-bubble');
                    const curBubble = document.querySelector('#cart-icon-bubble');
                    if (bubble && curBubble) curBubble.innerHTML = bubble.innerHTML;
                  });
              }
            }
          })
          .catch((e) => {
            console.error(e);
          })
          .finally(() => {
            if (this.submitButton) {
              this.submitButton.classList.remove('loading');
              if (!this.error) this.submitButton.removeAttribute('aria-disabled');
            }
            if (this.cart && this.cart.classList.contains('is-empty')) this.cart.classList.remove('is-empty');
            const spinner = this.querySelector('.loading__spinner');
            if (spinner) spinner.classList.add('hidden');
          });
      }

      handleErrorMessage(errorMessage = false) {
        if (this.hideErrors) return;

        this.errorMessageWrapper =
          this.errorMessageWrapper || this.querySelector('.product-form__error-message-wrapper');
        if (!this.errorMessageWrapper) return;
        this.errorMessage = this.errorMessage || this.errorMessageWrapper.querySelector('.product-form__error-message');

        this.errorMessageWrapper.toggleAttribute('hidden', !errorMessage);

        if (errorMessage) {
          this.errorMessage.textContent = errorMessage;
        }
      }

      toggleSubmitButton(disable = true, text) {
        if (disable) {
          if (this.submitButton) this.submitButton.setAttribute('disabled', 'disabled');
          if (text && this.submitButtonText) this.submitButtonText.textContent = text;
        } else {
          if (this.submitButton) this.submitButton.removeAttribute('disabled');
          if (this.submitButtonText) this.submitButtonText.textContent = (window.variantStrings && window.variantStrings.addToCart) || 'Add to cart';
        }
      }

      get variantIdInput() {
        return this.form ? this.form.querySelector('[name=id]') : null;
      }
    }
  );
}
