class Our8CsPromise {
  constructor() {
    this.init();
  }

  init() {
    // Find all instances of the section on the page
    const sections = document.querySelectorAll('.our-8-cs-promise');
    
    sections.forEach((section, index) => {
      // Use a unique ID for each section instance
      const sectionId = section.classList[1]?.replace('section-', '') || index;
      
      const textCarousel = section.querySelector('.text-carousel');
      const mediaSlider = section.querySelector('.media-slider');
      const textSlides = section.querySelectorAll('.carousel-slide');
      const mediaSlides = section.querySelectorAll('.media-slide');
      const buttons = section.querySelectorAll('.usp-button');
      const prevButtons = section.querySelectorAll('.carousel-prev, .media-prev');
      const nextButtons = section.querySelectorAll('.carousel-next, .media-next');
      const dotsContainer = section.querySelector('.media-dots');
      
      if (!textCarousel || !mediaSlider || textSlides.length === 0) return;
      
      let currentIndex = 1; // Start with first C (index 1, skip intro)
      
      // Create dots
      this.createDots(dotsContainer, mediaSlides.length, currentIndex, (index) => {
        this.slideTo(index, textSlides, mediaSlides, textCarousel, mediaSlider, buttons, section);
      });
      
      // Set initial slide
      this.slideTo(currentIndex, textSlides, mediaSlides, textCarousel, mediaSlider, buttons, section);
      
      // Add event listeners to buttons
      buttons.forEach(button => {
        button.addEventListener('click', (e) => {
          e.preventDefault();
          const target = button.dataset.target;
          let index = target === 'intro' ? 0 : parseInt(target, 10);
          this.slideTo(index, textSlides, mediaSlides, textCarousel, mediaSlider, buttons, section);
        });
      });
      
      // Add event listeners to prev/next buttons
      prevButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          currentIndex = (currentIndex - 1 + textSlides.length) % textSlides.length;
          this.slideTo(currentIndex, textSlides, mediaSlides, textCarousel, mediaSlider, buttons, section);
        });
      });
      
      nextButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          currentIndex = (currentIndex + 1) % textSlides.length;
          this.slideTo(currentIndex, textSlides, mediaSlides, textCarousel, mediaSlider, buttons, section);
        });
      });
      
      // Handle video playback
      this.setupVideoHandling(section);
    });
  }
  
  slideTo(index, textSlides, mediaSlides, textCarousel, mediaSlider, buttons, section) {
    if (index < 0) index = 0;
    if (index >= textSlides.length) index = textSlides.length - 1;
    
    // Calculate slide width
    const textSlideWidth = textSlides[0]?.offsetWidth || 604;
    const mediaSlideWidth = mediaSlides[0]?.offsetWidth || 456;
    
    // Apply transforms
    textCarousel.style.transform = `translateX(-${index * textSlideWidth}px)`;
    mediaSlider.style.transform = `translateX(-${index * mediaSlideWidth}px)`;
    
    // Update active button
    buttons.forEach(btn => {
      btn.classList.remove('active');
      const target = btn.dataset.target;
      if ((index === 0 && target === 'intro') || target === index.toString()) {
        btn.classList.add('active');
      }
    });
    
    // Update dots
    const dots = section.querySelectorAll('.media-dots li');
    dots.forEach((dot, i) => {
      if (i === index) {
        dot.classList.add('slick-active');
      } else {
        dot.classList.remove('slick-active');
      }
    });
    
    // Handle video playback
    const currentMediaSlide = mediaSlides[index];
    const video = currentMediaSlide?.querySelector('video');
    
    // Pause all videos
    mediaSlides.forEach(slide => {
      const vid = slide.querySelector('video');
      if (vid) vid.pause();
    });
    
    // Play current video if exists
    if (video) {
      video.play().catch(() => {}); // Ignore autoplay errors
    }
  }
  
  createDots(container, count, activeIndex, onClick) {
    if (!container) return;
    
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const li = document.createElement('li');
      li.className = i === activeIndex ? 'slick-active' : '';
      
      const button = document.createElement('button');
      button.textContent = i + 1;
      button.setAttribute('aria-label', `Go to slide ${i + 1}`);
      
      button.addEventListener('click', () => onClick(i));
      
      li.appendChild(button);
      container.appendChild(li);
    }
  }
  
  setupVideoHandling(section) {
    const videos = section.querySelectorAll('video');
    
    videos.forEach(video => {
      // Add video attributes for better performance
      video.setAttribute('playsinline', '');
      video.setAttribute('preload', 'none');
      
      // Pause video when not in view
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting && !video.paused) {
            video.pause();
          }
        });
      }, { threshold: 0.5 });
      
      observer.observe(video);
    });
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new Our8CsPromise();
  });
} else {
  new Our8CsPromise();
}

