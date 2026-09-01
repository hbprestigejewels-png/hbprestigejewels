if (!customElements.get('media-gallery')) {
  customElements.define(
    'media-gallery',
    class MediaGallery extends HTMLElement {
      constructor() {
        super();
        this.elements = {
          liveRegion: this.querySelector('[id^="GalleryStatus"]'),
          viewer: this.querySelector('[id^="GalleryViewer"]'),
          thumbnails: this.querySelector('[id^="GalleryThumbnails"]'),
        };
        this.mql = window.matchMedia('(min-width: 750px)');
        if (!this.elements.thumbnails) return;

        const safeDebounce = typeof debounce === 'function' ? debounce : (fn, delay) => {
          let timeout;
          return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), delay);
          };
        };

        if (this.elements.viewer) {
          // Ensure at least one item has is-active (Liquid may have set it already)
          let activeItem = this.elements.viewer.querySelector('.product__media-item.is-active, [data-media-id].is-active');
          if (!activeItem) {
            activeItem = this.elements.viewer.querySelector('.product__media-item') || this.elements.viewer.querySelector('[data-media-id]');
            if (activeItem) activeItem.classList.add('is-active');
          }

          // On page load: instantly scroll main viewer to the active item (no smooth, no jump to first)
          if (activeItem) {
            // Use requestAnimationFrame so layout is complete before scrolling
            requestAnimationFrame(() => {
              const li = activeItem.closest('.product__media-item') || activeItem;
              // Scroll the slider list to the active item
              const sliderList = this.elements.viewer.querySelector('ul') || this.elements.viewer;
              sliderList.scrollTo({ left: li.offsetLeft, behavior: 'instant' });

              // Also sync thumbnail strip to active item
              if (this.elements.thumbnails) {
                const mediaId = li.dataset.mediaId || activeItem.dataset.mediaId;
                if (mediaId) {
                  const activeThumbnail = this.elements.thumbnails.querySelector(`[data-target="${mediaId}"]`);
                  if (activeThumbnail) {
                    this.setActiveThumbnail(activeThumbnail);
                  }
                }
              }
            });
          }

          this.elements.viewer.addEventListener('slideChanged', safeDebounce(this.onSlideChanged.bind(this), 200));
        }

        this.elements.thumbnails.querySelectorAll('[data-target]').forEach((mediaToSwitch) => {
          mediaToSwitch.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = mediaToSwitch.dataset.target;
            if (targetId) this.setActiveMedia(targetId, false);
          });

          const btn = mediaToSwitch.querySelector('button');
          if (btn) {
            btn.addEventListener('click', (e) => {
              e.preventDefault();
              const targetId = mediaToSwitch.dataset.target;
              if (targetId) this.setActiveMedia(targetId, false);
            });
          }
        });

        if (this.dataset.desktopLayout && this.dataset.desktopLayout.includes('thumbnail') && this.mql.matches) {
          this.removeListSemantic();
        }
      }

      onSlideChanged(event) {
        if (!this.elements.thumbnails || !event.detail || !event.detail.currentElement) return;
        const thumbnail = this.elements.thumbnails.querySelector(
          `[data-target="${event.detail.currentElement.dataset.mediaId}"]`
        );
        if (thumbnail) this.setActiveThumbnail(thumbnail);
      }

      setActiveMedia(mediaId, prepend) {
        const activeMedia =
          this.elements.viewer.querySelector(`[data-media-id="${mediaId}"]`) ||
          this.elements.viewer.querySelector('[data-media-id]');
        if (!activeMedia) return;

        this.elements.viewer.querySelectorAll('.in-box-zoom-overlay').forEach((ov) => ov.remove());

        this.elements.viewer.querySelectorAll('[data-media-id]').forEach((element) => {
          element.classList.remove('is-active');
        });
        activeMedia.classList.add('is-active');

        // Remove offscreen animation class so newly active image is immediately visible
        activeMedia.classList.remove('scroll-trigger--offscreen');
        const activeMediaItem = activeMedia.closest('.product__media-item') || activeMedia;
        if (activeMediaItem) {
          activeMediaItem.classList.remove('scroll-trigger--offscreen');
        }

        const activeItem = activeMedia.closest('.product__media-item') || activeMedia;
        if (activeItem && this.elements.viewer) {
          // Scroll main gallery slider to the active item - use sliderList (ul) not the wrapper
          const sliderList = this.elements.viewer.querySelector('ul') || this.elements.viewer;
          sliderList.scrollTo({
            left: activeItem.offsetLeft,
            behavior: 'smooth',
          });
          const sliderComponent = this.elements.viewer.closest('slider-component') || this.elements.viewer;
          if (sliderComponent && typeof sliderComponent.update === 'function') {
            sliderComponent.update();
          }
        }

        // Do NOT prepend - keep all images in their original fixed positions
        // prepend: true from product-info.js is intentionally ignored here

        this.preventStickyHeader();
        window.setTimeout(() => {
          const activeMediaRect = activeMedia.getBoundingClientRect();
          // Don't scroll page if the image is already in view
          if (activeMediaRect.top > -0.5) return;
          const top = activeMediaRect.top + window.scrollY;
          window.scrollTo({ top: top, behavior: 'smooth' });
        });
        this.playActiveMedia(activeMedia);

        if (!this.elements.thumbnails) return;
        const activeThumbnail = this.elements.thumbnails.querySelector(`[data-target="${mediaId}"]`);
        if (activeThumbnail) {
          this.setActiveThumbnail(activeThumbnail);
          this.announceLiveRegion(activeMedia, activeThumbnail.dataset.mediaPosition);
        }
      }

      setActiveThumbnail(thumbnail) {
        if (!this.elements.thumbnails || !thumbnail) return;

        this.elements.thumbnails
          .querySelectorAll('button')
          .forEach((element) => element.removeAttribute('aria-current'));
        thumbnail.querySelector('button')?.setAttribute('aria-current', 'true');
        if (typeof this.elements.thumbnails.isSlideVisible === 'function' && this.elements.thumbnails.isSlideVisible(thumbnail, 10)) return;

        const slider = this.elements.thumbnails.slider || this.elements.thumbnails.querySelector('ul') || this.elements.thumbnails;
        if (slider && typeof slider.scrollTo === 'function') {
          slider.scrollTo({ left: thumbnail.offsetLeft, behavior: 'smooth' });
        }
      }

      announceLiveRegion(activeItem, position) {
        const image = activeItem.querySelector('.product__modal-opener--image img, .product__inbox-zoom-wrapper img');
        if (!image) return;
        image.onload = () => {
          this.elements.liveRegion.setAttribute('aria-hidden', false);
          this.elements.liveRegion.innerHTML = window.accessibilityStrings.imageAvailable.replace('[index]', position);
          setTimeout(() => {
            this.elements.liveRegion.setAttribute('aria-hidden', true);
          }, 200);
        };
        image.src = image.src;
      }

      playActiveMedia(activeItem) {
        window.pauseAllMedia();
        const deferredMedia = activeItem.querySelector('.deferred-media');
        if (deferredMedia) deferredMedia.loadContent(false);
      }

      preventStickyHeader() {
        this.stickyHeader = this.stickyHeader || document.querySelector('sticky-header');
        if (!this.stickyHeader) return;
        this.stickyHeader.dispatchEvent(new Event('preventHeaderReveal'));
      }

      removeListSemantic() {
        if (!this.elements.viewer.slider) return;
        this.elements.viewer.slider.setAttribute('role', 'presentation');
        this.elements.viewer.sliderItems.forEach((slide) => slide.setAttribute('role', 'presentation'));
      }
    }
  );
}

document.addEventListener('variant-change', function (event) {
  const variant = event?.detail?.variant || event?.detail?.data?.variant;
  if (!variant) return;

  const mediaGallery = document.querySelector('media-gallery');
  if (mediaGallery) {
    const featuredMedia = variant.featured_media || variant.featured_image;
    if (featuredMedia && featuredMedia.id) {
      const sectionId = mediaGallery.dataset.section || mediaGallery.id.replace('MediaGallery-', '');
      const mediaId = `${sectionId}-${featuredMedia.id}`;
      if (typeof mediaGallery.setActiveMedia === 'function') {
        mediaGallery.setActiveMedia(mediaId, false);
      }
    }
  }
});