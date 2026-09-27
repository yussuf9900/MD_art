import {
  createIcons,
  Volume2,
  VolumeX,
  ArrowDown,
  ArrowRight,
  Gem,
  Eye,
  ZoomIn,
  Maximize2,
  Sparkles,
  Home,
  Search,
  ShieldCheck,
  Award,
  PackageCheck,
  RefreshCw,
  ShoppingBag,
  MessageCircle,
  Sliders,
  X,
  CheckCircle,
  Lock,
  Check
} from 'lucide';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Initialize Lucide icons
function renderIcons() {
  createIcons({
    icons: {
      Volume2,
      VolumeX,
      ArrowDown,
      ArrowRight,
      Gem,
      Eye,
      ZoomIn,
      Maximize2,
      Sparkles,
      Home,
      Search,
      ShieldCheck,
      Award,
      PackageCheck,
      RefreshCw,
      ShoppingBag,
      MessageCircle,
      Sliders,
      X,
      CheckCircle,
      Lock,
      Check
    }
  });
}

/* ==========================================================================
   PAINTING CATALOG DATA
   ========================================================================== */
const ARTWORKS = {
  '1': {
    id: '1',
    title: 'Le Guerrier au Crépuscule',
    price: '2 400 €',
    img: '/assets/peinture.jpeg',
    dimensions: '80 × 120 cm',
    medium: 'Acrylique, huile & pigments chauds sur lin',
    status: 'Disponible'
  },
  '2': {
    id: '2',
    title: 'Reine d\'Or et d\'Indigo',
    price: '2 850 €',
    img: '/assets/peinture2.jpg',
    dimensions: '75 × 100 cm',
    medium: 'Huile sur lin, parures feuille d\'or & cobalt',
    status: 'Disponible'
  },
  '3': {
    id: '3',
    title: 'La Danseuse du Feu Céleste',
    price: '3 100 €',
    img: '/assets/peinture3.jpg',
    dimensions: '90 × 130 cm',
    medium: 'Empâtement au couteau, flammes d\'ambre',
    status: 'Réservé'
  }
};

/* ==========================================================================
   SMOOTH SCROLL (LENIS)
   ========================================================================== */
const lenis = new Lenis({
  duration: 1.2,
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  orientation: 'vertical',
  gestureOrientation: 'vertical',
  smoothWheel: true,
  touchMultiplier: 2,
});

function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

// Connect Lenis to GSAP ScrollTrigger
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((time) => {
  lenis.raf(time * 1000);
});
gsap.ticker.lagSmoothing(0);

/* ==========================================================================
   IMAGE SEQUENCE PRELOADER & CANVAS VIDEO SCROLL
   ========================================================================== */
const TOTAL_FRAMES = 120;
const frameImages = [];
let loadedCount = 0;

const canvas = document.getElementById('scrub-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const preloader = document.getElementById('preloader');
const preloaderBar = document.getElementById('preloader-bar');
const preloaderPercent = document.getElementById('preloader-percent');
const hudProgressBar = document.getElementById('canvas-progress');

// Current playhead object for GSAP scrubbing
const frameSequence = {
  frame: 0
};

function getFramePath(index) {
  const paddedIndex = String(index + 1).padStart(4, '0');
  return `/frames/frame_${paddedIndex}.webp`;
}

function resizeCanvas() {
  if (!canvas || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  renderCanvasFrame(frameSequence.frame);
}

function renderCanvasFrame(frameIndex) {
  if (!ctx || !canvas) return;
  const imgIndex = Math.min(Math.max(Math.round(frameIndex), 0), TOTAL_FRAMES - 1);
  const img = frameImages[imgIndex];
  if (!img || !img.complete || img.naturalWidth === 0) return;

  const cWidth = canvas.width;
  const cHeight = canvas.height;
  const imgWidth = img.naturalWidth;
  const imgHeight = img.naturalHeight;

  // Emulate CSS object-fit: cover with high sharpness
  const imgRatio = imgWidth / imgHeight;
  const canvasRatio = cWidth / cHeight;
  let renderWidth, renderHeight, offsetX, offsetY;

  if (canvasRatio > imgRatio) {
    renderWidth = cWidth;
    renderHeight = cWidth / imgRatio;
    offsetX = 0;
    offsetY = (cHeight - renderHeight) / 2;
  } else {
    renderWidth = cHeight * imgRatio;
    renderHeight = cHeight;
    offsetX = (cWidth - renderWidth) / 2;
    offsetY = 0;
  }

  ctx.clearRect(0, 0, cWidth, cHeight);
  ctx.drawImage(img, offsetX, offsetY, renderWidth, renderHeight);
}

function preloadSequence() {
  return new Promise((resolve) => {
    for (let i = 0; i < TOTAL_FRAMES; i++) {
      const img = new Image();
      img.src = getFramePath(i);
      img.onload = () => {
        loadedCount++;
        const percent = Math.round((loadedCount / TOTAL_FRAMES) * 100);
        if (preloaderBar) preloaderBar.style.width = `${percent}%`;
        if (preloaderPercent) preloaderPercent.innerText = `${percent}%`;

        // Render very first frame as soon as it arrives
        if (loadedCount === 1) {
          renderCanvasFrame(0);
        }

        if (loadedCount === TOTAL_FRAMES) {
          resolve();
        }
      };
      img.onerror = () => {
        loadedCount++;
        if (loadedCount === TOTAL_FRAMES) resolve();
      };
      frameImages.push(img);
    }
  });
}

function initScrollyCanvasTrigger() {
  const scrollySection = document.getElementById('experience');
  if (!scrollySection || !canvas) return;

  const storySteps = document.querySelectorAll('.story-step');

  // Master scrubbing animation for the canvas
  gsap.to(frameSequence, {
    frame: TOTAL_FRAMES - 1,
    ease: 'none',
    scrollTrigger: {
      trigger: scrollySection,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.5,
      onUpdate: (self) => {
        renderCanvasFrame(frameSequence.frame);
        if (hudProgressBar) {
          hudProgressBar.style.width = `${Math.round(self.progress * 100)}%`;
        }

        // Active story cards based on camera timeline
        const prog = self.progress;
        storySteps.forEach((step, idx) => {
          // 4 milestones: [0.05-0.25], [0.28-0.50], [0.53-0.75], [0.78-1.0]
          const ranges = [
            [0.03, 0.24],
            [0.26, 0.48],
            [0.50, 0.73],
            [0.75, 1.00]
          ];
          const [min, max] = ranges[idx];
          if (prog >= min && prog <= max) {
            step.classList.add('active');
          } else {
            step.classList.remove('active');
          }
        });
      }
    }
  });
}

/* ==========================================================================
   MODAL INTERACTION LOGIC
   ========================================================================== */

// 1. View in Room Modal
const modalRoom = document.getElementById('modal-room');
const roomArtworkTarget = document.getElementById('room-artwork-target');
const btnCloseRoom = document.getElementById('btn-close-room');
const roomThumbBtns = document.querySelectorAll('.room-thumb-btn');

function openRoomModal(artworkSrc) {
  if (!modalRoom) return;
  if (artworkSrc && roomArtworkTarget) {
    roomArtworkTarget.src = artworkSrc.startsWith('/') ? artworkSrc : `/assets/${artworkSrc}`;
  }
  modalRoom.classList.add('open');
  lenis.stop();
}

function closeRoomModal() {
  if (!modalRoom) return;
  modalRoom.classList.remove('open');
  lenis.start();
}

// 2. High Resolution Loupe Modal
const modalLoupe = document.getElementById('modal-loupe');
const btnCloseLoupe = document.getElementById('btn-close-loupe');
const loupeStage = document.getElementById('loupe-stage');
const loupeLens = document.getElementById('loupe-lens');
const loupeSourceImg = document.getElementById('loupe-source-img');

function openLoupeModal() {
  if (!modalLoupe) return;
  modalLoupe.classList.add('open');
  lenis.stop();
  if (loupeSourceImg && loupeLens) {
    loupeLens.style.backgroundImage = `url('${loupeSourceImg.src}')`;
  }
}

function closeLoupeModal() {
  if (!modalLoupe) return;
  modalLoupe.classList.remove('open');
  lenis.start();
}

function setupLoupeInteraction() {
  if (!loupeStage || !loupeLens || !loupeSourceImg) return;

  const zoomFactor = 2.5;

  loupeStage.addEventListener('mouseenter', () => {
    loupeLens.style.opacity = '1';
    loupeLens.style.backgroundImage = `url('${loupeSourceImg.src}')`;
    const rect = loupeSourceImg.getBoundingClientRect();
    loupeLens.style.backgroundSize = `${rect.width * zoomFactor}px ${rect.height * zoomFactor}px`;
  });

  loupeStage.addEventListener('mouseleave', () => {
    loupeLens.style.opacity = '0';
  });

  loupeStage.addEventListener('mousemove', (e) => {
    const rect = loupeStage.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const lensRadius = loupeLens.offsetWidth / 2;

    loupeLens.style.left = `${x - lensRadius}px`;
    loupeLens.style.top = `${y - lensRadius}px`;

    const bgX = -(x * zoomFactor - lensRadius);
    const bgY = -(y * zoomFactor - lensRadius);

    loupeLens.style.backgroundPosition = `${bgX}px ${bgY}px`;
  });
}

// 3. Purchase & Reservation Modal
const modalPurchase = document.getElementById('modal-purchase');
const btnClosePurchase = document.getElementById('btn-close-purchase');
const purchaseForm = document.getElementById('purchase-form');
const purchaseSuccess = document.getElementById('purchase-success');
const btnCloseSuccess = document.getElementById('btn-close-success');
const modalPaintingTitle = document.getElementById('modal-painting-title');
const modalPaintingThumb = document.getElementById('modal-painting-thumb');
const modalPaintingPrice = document.getElementById('modal-painting-price');

function openPurchaseModal(paintingId = '1') {
  if (!modalPurchase) return;
  const art = ARTWORKS[paintingId] || ARTWORKS['1'];

  if (modalPaintingTitle) modalPaintingTitle.innerText = art.title;
  if (modalPaintingThumb) modalPaintingThumb.src = art.img;
  if (modalPaintingPrice) modalPaintingPrice.innerText = art.price;

  if (purchaseForm) purchaseForm.style.display = 'flex';
  if (purchaseSuccess) purchaseSuccess.classList.add('hidden');

  modalPurchase.classList.add('open');
  lenis.stop();
}

function closePurchaseModal() {
  if (!modalPurchase) return;
  modalPurchase.classList.remove('open');
  lenis.start();
}

/* ==========================================================================
   AMBIENT PIANO AUDIO (Erik Satie - Gymnopédie No. 1)
   ========================================================================== */
let pianoAudio = null;
let isAudioPlaying = false;
const btnSoundToggle = document.getElementById('btn-sound-toggle');

function initPianoAudio() {
  if (!pianoAudio) {
    pianoAudio = new Audio('/assets/piano_ambient.mp3');
    pianoAudio.loop = true;
    pianoAudio.volume = 0;
  }
}

function fadeAudio(targetVolume, duration = 1200) {
  if (!pianoAudio) return;
  const startVolume = pianoAudio.volume;
  const startTime = performance.now();

  function ramp(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    pianoAudio.volume = startVolume + (targetVolume - startVolume) * progress;

    if (progress < 1) {
      requestAnimationFrame(ramp);
    } else if (targetVolume === 0) {
      pianoAudio.pause();
    }
  }

  requestAnimationFrame(ramp);
}

function toggleAmbientAudio() {
  initPianoAudio();

  isAudioPlaying = !isAudioPlaying;

  if (isAudioPlaying) {
    pianoAudio.play().then(() => {
      fadeAudio(0.35, 1500); // Doux et apaisant
      if (btnSoundToggle) {
        btnSoundToggle.innerHTML = '<i data-lucide="volume-2"></i>';
        renderIcons();
      }
      showToast('Ambiance piano de l\'atelier activée (Gymnopédie No. 1)');
    }).catch((err) => {
      console.warn('Audio play error:', err);
    });
  } else {
    fadeAudio(0, 800);
    if (btnSoundToggle) {
      btnSoundToggle.innerHTML = '<i data-lucide="volume-x"></i>';
      renderIcons();
    }
    showToast('Ambiance piano désactivée');
  }
}

/* ==========================================================================
   TOAST HELPER
   ========================================================================== */
const toast = document.getElementById('toast');
let toastTimer = null;
function showToast(msg) {
  if (!toast) return;
  toast.innerText = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}

/* ==========================================================================
   EVENT LISTENERS & BINDINGS
   ========================================================================== */
function setupEventListeners() {
  // Glow cursor movement
  const cursorGlow = document.getElementById('cursor-glow');
  window.addEventListener('pointermove', (e) => {
    if (cursorGlow) {
      cursorGlow.style.left = `${e.clientX}px`;
      cursorGlow.style.top = `${e.clientY}px`;
    }
  });

  // Sticky header background transition
  const header = document.querySelector('.site-header');
  window.addEventListener('scroll', () => {
    if (!header) return;
    if (window.scrollY > 80) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });

  // Sound toggle button
  if (btnSoundToggle) {
    btnSoundToggle.addEventListener('click', toggleAmbientAudio);
  }

  // Hero CTA to open purchase
  const btnHeroOrder = document.getElementById('btn-hero-order');
  if (btnHeroOrder) {
    btnHeroOrder.addEventListener('click', () => openPurchaseModal('1'));
  }

  // All buttons with class .btn-open-purchase
  document.querySelectorAll('.btn-open-purchase').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const paintingId = btn.getAttribute('data-painting-id') || '1';
      openPurchaseModal(paintingId);
    });
  });

  // All buttons with class .btn-open-room
  document.querySelectorAll('.btn-open-room').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const paintingSrc = btn.getAttribute('data-painting') || 'peinture.jpeg';
      openRoomModal(paintingSrc);
    });
  });

  // HUD Triggers
  const btnTriggerZoom = document.getElementById('btn-trigger-zoom');
  if (btnTriggerZoom) {
    btnTriggerZoom.addEventListener('click', openLoupeModal);
  }

  const btnTriggerRoom = document.getElementById('btn-trigger-room');
  if (btnTriggerRoom) {
    btnTriggerRoom.addEventListener('click', () => openRoomModal('peinture.jpeg'));
  }

  // Loupe buttons
  document.querySelectorAll('.btn-open-loupe').forEach((btn) => {
    btn.addEventListener('click', openLoupeModal);
  });

  // Modal Closers
  if (btnCloseRoom) btnCloseRoom.addEventListener('click', closeRoomModal);
  if (btnCloseLoupe) btnCloseLoupe.addEventListener('click', closeLoupeModal);
  if (btnClosePurchase) btnClosePurchase.addEventListener('click', closePurchaseModal);
  if (btnCloseSuccess) btnCloseSuccess.addEventListener('click', closePurchaseModal);

  // Close modals on backdrop click
  [modalRoom, modalLoupe, modalPurchase].forEach((modal) => {
    if (!modal) return;
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('open');
        lenis.start();
      }
    });
  });

  // Room modal thumbnail switches
  roomThumbBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      roomThumbBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const imgPath = btn.getAttribute('data-img');
      if (roomArtworkTarget && imgPath) {
        roomArtworkTarget.src = imgPath;
      }
    });
  });

  // Purchase Form submit
  if (purchaseForm) {
    purchaseForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const clientName = document.getElementById('client-name')?.value || 'Collectionneur';
      if (purchaseForm) purchaseForm.style.display = 'none';
      if (purchaseSuccess) purchaseSuccess.classList.remove('hidden');
      renderIcons();
      showToast(`Merci M./Mme ${clientName}, votre dossier d'acquisition a été créé !`);
    });
  }

  // Window resize handler
  window.addEventListener('resize', resizeCanvas);
}

/* ==========================================================================
   INITIALIZATION
   ========================================================================== */
async function init() {
  renderIcons();
  setupEventListeners();
  setupLoupeInteraction();
  resizeCanvas();

  try {
    await preloadSequence();
  } catch (err) {
    console.warn('Frame preloading warning:', err);
  }

  // Hide preloader with luxury fade-out
  if (preloader) {
    setTimeout(() => {
      preloader.classList.add('hidden');
      initScrollyCanvasTrigger();
      renderIcons();
    }, 600);
  }
}

window.addEventListener('DOMContentLoaded', init);
