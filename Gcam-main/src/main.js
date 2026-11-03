import '@/styles.css';
import {
  ASPECTS,
  DEFAULT_PREFS,
  DEFAULT_SETTINGS,
  DIGITAL_SUPERZOOM_START,
  FLASH_MODES,
  GALLERY_LIMIT,
  GRID_MODES,
  HDR_MODES,
  LENSES,
  MACRO_FOCUS,
  MACRO_ZOOM,
  PROFILES,
  SENSOR_IDS,
  STABILIZATION_LEVELS,
  SUBJECT_FOCUS,
  TIMER_MODES,
  ZOOM_MAX,
  ZOOM_MIN,
} from '@/config.js';
import { createCameraEngine, createMotionSmoother, requestOrientationAccess, startOrientation } from '@/cameraEngine.js';
import { createCaptureController } from '@/captureFlows.js';
import { buildGrade, computeLayout, createImageProcessor } from '@/imageProcessor.js';
import { drawHistogram, drawPip, renderGrid, setLevel } from '@/overlays.js';
import { attachStageGestures } from '@/gestures.js';
import { createGalleryModal, createSettingsModal, createSheet } from '@/modals.js';
import { getDeviceId, loadCaptureHistory, loadPreferences, logCapture, savePreferences } from '@/persistence.js';
import { sanitizePreferences } from '@/preferences.js';
import {
  $,
  $$,
  apertureFromSlider,
  formatEv,
  formatFocus,
  formatShutter,
  isoFromSlider,
  restartAnimation,
  shutterFromSlider,
  showToast,
  sliderFromAperture,
  sliderFromIso,
  sliderFromShutter,
} from '@/ui.js';

const PREVIEW_LONG_SIDE = 1024;
const FRAME_INTERVAL_MS = 1000 / 30;
const PERSIST_DELAY_MS = 400;
const HISTORY_LIMIT = 20;
const HDR_AMOUNT = { off: 0, auto: 0.5, plus: 1 };
const FLASH_CAPTURE_STOPS = { off: 0, auto: 0.3, on: 0.6, light: 0 };
const MODE_LABELS = {
  normal: 'Normal',
  pro: 'Pro',
  portrait: 'Retrato',
  night: 'Noche',
  astro: 'Astro',
  macro: 'Macro',
  video: 'Video',
};
const PANELS = {
  pro: '#panelPro',
  portrait: '#panelPortrait',
  night: '#panelNight',
  astro: '#panelAstro',
  macro: '#panelMacro',
  video: '#panelVideo',
};
const OPTICAL_LENSES = LENSES.filter((lens) => lens.id !== 'super');

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const round1 = (value) => Math.round(value * 10) / 10;
const labelOf = (list, id) => list.find((item) => item.id === id)?.label ?? '';
const nextId = (list, id) => list[(list.findIndex((item) => item.id === id) + 1) % list.length].id;
const formatZoom = (zoom) => (zoom >= 10 ? `${Math.round(zoom)}x` : `${zoom.toFixed(1)}x`);

const state = {
  mode: 'normal',
  zoom: 1,
  ev: 0,
  focus: SUBJECT_FOCUS,
  shutter: 1 / 125,
  iso: 100,
  kelvin: 5500,
  aperture: 1.8,
  lighting: 'natural',
  timer: 'off',
  flash: 'off',
  grid: 'off',
  peaking: false,
  zebra: false,
  level: true,
  focusInfinity: false,
  physicalLens: null,
  histChannels: 'rgb',
  astro: { seconds: 15, stack: 'mean' },
  videoProfile: DEFAULT_PREFS.videoProfile,
  profile: DEFAULT_PREFS.profile,
  aspect: DEFAULT_PREFS.aspect,
  hdr: DEFAULT_PREFS.hdr,
  stabilization: DEFAULT_PREFS.stabilization,
  cameraId: '',
  settings: { ...DEFAULT_SETTINGS },
};

const deviceId = getDeviceId();
const engine = createCameraEngine();
const processor = createImageProcessor();
const smoother = createMotionSmoother();

const stage = $('#stage');
const viewport = $('#viewport');
const view = $('#view');
const gridSvg = $('#grid');
const levelEl = $('#level');
const reticle = $('#reticle');
const histCanvas = $('#histCanvas');
const pipCanvas = $('#pipCanvas');
const evBadge = $('#evBadge');
const thumbImg = $('#thumbImg');
const thumbEmpty = $('#thumbEmpty');

let items = [];
let evTimer = null;
let persistTimer = null;
let lastFrameAt = 0;
let orientationReady = false;

function aspectRatio() {
  if (state.mode === 'video') return 16 / 9;
  return ASPECTS.find((aspect) => aspect.id === state.aspect)?.ratio ?? null;
}

function lensIdForZoom(zoom) {
  if (zoom > DIGITAL_SUPERZOOM_START) return 'super';
  return OPTICAL_LENSES.filter((lens) => lens.zoom <= zoom + 1e-6).at(-1).id;
}

function currentLens() {
  if (state.physicalLens) return LENSES.find((lens) => lens.id === state.physicalLens);
  return LENSES.find((lens) => lens.id === lensIdForZoom(state.zoom));
}

function effectiveIso() {
  if (state.mode === 'pro') return state.iso;
  return clamp(Math.round(100 * 2 ** -state.ev), 100, 6400);
}

function exposureStops() {
  if (state.mode !== 'pro') return state.ev;
  return state.ev + Math.log2(state.shutter * 125) + Math.log2(state.iso / 100);
}

function bokehAmount() {
  return clamp((16 - state.aperture) / (16 - 1.2), 0, 1);
}

function stabilizationLevel() {
  return state.mode === 'video' ? STABILIZATION_LEVELS[state.stabilization] : STABILIZATION_LEVELS.off;
}

function stabilizationActive() {
  return stabilizationLevel().crop > 1;
}

function digitalZoom() {
  if (!state.physicalLens) return state.zoom;
  return Math.max(1, state.zoom / LENSES.find((lens) => lens.id === state.physicalLens).zoom);
}

function effectiveZoom() {
  return digitalZoom() * (state.mode === 'macro' ? MACRO_ZOOM : 1) * stabilizationLevel().crop;
}

function currentShift() {
  return stabilizationActive() ? smoother.shift(stabilizationLevel()) : { x: 0, y: 0 };
}

function layoutFor(src, w, h) {
  return computeLayout(src.width, src.height, w, h, effectiveZoom(), currentShift());
}

function captureDims(frame) {
  const ratio = aspectRatio();
  if (!ratio) return { w: frame.width, h: frame.height };
  if (frame.width / frame.height > ratio) return { w: Math.round(frame.height * ratio), h: frame.height };
  return { w: frame.width, h: Math.round(frame.width / ratio) };
}

function previewSize() {
  const box = viewport.getBoundingClientRect();
  const longSide = Math.max(box.width, box.height) || 1;
  const scale = Math.min(window.devicePixelRatio || 1, PREVIEW_LONG_SIDE / longSide);
  return {
    w: Math.max(2, Math.round(box.width * scale)),
    h: Math.max(2, Math.round(box.height * scale)),
  };
}

function shutterLabel() {
  if (state.mode === 'pro') return formatShutter(state.shutter);
  if (state.mode === 'night') return '8 × 200 ms';
  if (state.mode === 'astro') return `${state.astro.seconds} s`;
  return 'Auto';
}

function buildMeta(extra = {}) {
  const lens = currentLens();
  const aperture = state.mode === 'portrait' ? state.aperture : lens.aperture;
  return {
    mode: MODE_LABELS[state.mode],
    lens: `${lens.label} · ${lens.equiv}`,
    zoom: Number(state.zoom.toFixed(1)),
    iso: effectiveIso(),
    shutter: shutterLabel(),
    aperture: aperture.toFixed(1),
    profile: PROFILES[state.profile].label,
    kelvin: state.kelvin,
    sensor: SENSOR_IDS[state.settings.sensorId] ?? SENSOR_IDS.auto,
    ...extra,
  };
}

function defocusAmount() {
  if (state.mode === 'macro') return 0.4;
  if (state.mode === 'pro') return clamp(Math.abs(state.focus - SUBJECT_FOCUS) * 0.8, 0, 0.7);
  return 0;
}

function gradeOptions(opts = {}) {
  const capture = Boolean(opts.capture);
  const hdrAmount =
    opts.hdr ?? (state.hdr === 'auto' && !state.settings.autoHdr ? 0 : HDR_AMOUNT[state.hdr]);
  const flashStops = capture ? FLASH_CAPTURE_STOPS[state.flash] : 0;
  const baseNoise = clamp(((effectiveIso() - 400) / 6400) * 10, 0, 10);
  return buildGrade({
    profile: state.profile,
    stops: clamp(exposureStops() + (opts.extraStops ?? 0) + flashStops, -6, 6),
    kelvin: state.kelvin,
    hdr: hdrAmount,
    noise: opts.noise ?? baseNoise * (state.settings.noiseModel ? 0.5 : 1),
    zebra: state.zebra && !capture,
    peaking: state.peaking && !capture,
    bokeh: state.mode === 'portrait' ? bokehAmount() : 0,
    defocus: defocusAmount(),
    light: state.mode === 'portrait' && state.lighting !== 'natural' ? state.lighting : null,
  });
}

function toPreferences() {
  return {
    profile: state.profile,
    aspect: state.aspect,
    hdr: state.hdr,
    videoProfile: state.videoProfile,
    grid: state.grid,
    stabilization: state.stabilization,
    cameraId: state.cameraId,
    settings: state.settings,
  };
}

async function persistNow() {
  try {
    await savePreferences(deviceId, toPreferences());
  } catch (error) {
    console.error(error);
    showToast('No se pudieron guardar tus preferencias');
  }
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, PERSIST_DELAY_MS);
}

function applyTorch() {
  engine.setTorch(state.flash === 'light');
}

function updateSourceNote(error) {
  const note = $('#sourceNote');
  const simulated = engine.mode === 'simulation';
  note.classList.toggle('hidden', !simulated);
  if (!simulated) return;
  note.textContent =
    error === 'NotAllowedError'
      ? 'Permiso de cámara denegado: vista previa simulada'
      : 'Sin cámara disponible: vista previa simulada';
}

async function ensureOrientation({ silent = false } = {}) {
  if (orientationReady) return true;
  const granted = await requestOrientationAccess();
  if (!granted) {
    if (!silent) showToast('El sensor de movimiento no está disponible');
    return false;
  }
  orientationReady = true;
  startOrientation(({ roll, pitch }) => {
    smoother.push(roll, pitch);
    setLevel(levelEl, roll);
  });
  return true;
}

function setActive(el, active) {
  el.classList.toggle('active', active);
  el.setAttribute('aria-pressed', String(active));
}

function syncInput(el, value) {
  if (document.activeElement !== el) el.value = String(value);
}

function layoutViewport() {
  const ratio = aspectRatio();
  if (!ratio) {
    viewport.style.width = '';
    viewport.style.height = '';
    return;
  }
  const rect = stage.getBoundingClientRect();
  let width = rect.width;
  let height = width / ratio;
  if (height > rect.height) {
    height = rect.height;
    width = height * ratio;
  }
  viewport.style.width = `${Math.floor(width)}px`;
  viewport.style.height = `${Math.floor(height)}px`;
}

function aspectLabel() {
  return ASPECTS.find((aspect) => aspect.id === state.aspect)?.label ?? '';
}

function render() {
  const lens = currentLens();
  $('#zoomReadout').textContent = formatZoom(state.zoom);
  $$('#lensDial [data-lens]').forEach((btn) => setActive(btn, btn.dataset.lens === lens.id));
  $$('#modes [data-mode]').forEach((btn) => setActive(btn, btn.dataset.mode === state.mode));
  for (const [mode, selector] of Object.entries(PANELS)) {
    $(selector).classList.toggle('hidden', mode !== state.mode);
  }
  $('#videoProfile').value = state.videoProfile;
  $$('#profiles [data-profile]').forEach((btn) => setActive(btn, btn.dataset.profile === state.profile));
  $$('#aspectSeg [data-aspect]').forEach((btn) => setActive(btn, btn.dataset.aspect === state.aspect));
  $$('#lightingSeg [data-light]').forEach((btn) => setActive(btn, btn.dataset.light === state.lighting));
  $$('#astroSeconds [data-seconds]').forEach((btn) => setActive(btn, Number(btn.dataset.seconds) === state.astro.seconds));
  $$('#astroStack [data-stack]').forEach((btn) => setActive(btn, btn.dataset.stack === state.astro.stack));
  $$('#wbPresets [data-kelvin]').forEach((btn) => setActive(btn, Number(btn.dataset.kelvin) === state.kelvin));

  setActive($('#flashBtn'), state.flash !== 'off');
  $('#flashBtn').title = `Flash ${labelOf(FLASH_MODES, state.flash)}`;
  setActive($('#hdrBtn'), state.hdr !== 'off');
  $('#hdrBtn').title = `HDR ${labelOf(HDR_MODES, state.hdr)}`;
  setActive($('#timerBtn'), state.timer !== 'off');
  $('#timerValue').textContent = state.timer === 'off' ? '' : labelOf(TIMER_MODES, state.timer);
  $('#timerBtn').title = `Temporizador ${labelOf(TIMER_MODES, state.timer)}`;
  $('#lookLabel').textContent = brandName(state.profile);
  document.querySelectorAll('#lookMenu [data-profile]').forEach((btn) => setActive(btn, btn.dataset.profile === state.profile));
  setActive($('#infinityBtn'), state.focusInfinity);
  $('#infinityBtn').textContent = state.focusInfinity ? 'Bloqueado' : 'Automático';
  $('#gridBtn').textContent = `Rejilla ${labelOf(GRID_MODES, state.grid)}`;
  setActive($('#gridBtn'), state.grid !== 'off');
  setActive($('#peakBtn'), state.peaking);
  setActive($('#zebraBtn'), state.zebra);
  setActive($('#levelBtn'), state.level);
  document.querySelectorAll('#stabSeg [data-stab]').forEach((btn) => setActive(btn, btn.dataset.stab === state.stabilization));
  $('#resultTag').textContent = `${PROFILES[state.profile].label} · ${aspectLabel()} · ${currentLens().label}`;
  levelEl.classList.toggle('hidden', !state.level);
  renderGrid(gridSvg, state.grid);
  $('#histLabel').textContent = state.histChannels === 'rgb' ? 'RGB' : 'Luminancia';
  $('#pip').classList.toggle('hidden', state.zoom <= DIGITAL_SUPERZOOM_START);

  syncInput($('#mfSlider'), state.focus);
  $('#mfOut').textContent = formatFocus(state.focus);
  syncInput($('#shutterSlider'), sliderFromShutter(state.shutter));
  $('#shutterOut').textContent = formatShutter(state.shutter);
  syncInput($('#isoSlider'), sliderFromIso(state.iso));
  $('#isoOut').textContent = `ISO ${state.iso}`;
  syncInput($('#wbSlider'), state.kelvin);
  $('#wbOut').textContent = `${state.kelvin} K`;
  syncInput($('#evSlider'), state.ev);
  $('#evOut').textContent = formatEv(state.ev);
  syncInput($('#apertureSlider'), sliderFromAperture(state.aperture));
  $('#apertureOut').textContent = `f/${state.aperture.toFixed(1)}`;
}

function showEvBadge() {
  evBadge.textContent = formatEv(state.ev);
  evBadge.classList.add('show');
  clearTimeout(evTimer);
  evTimer = setTimeout(() => evBadge.classList.remove('show'), 900);
}

function setMode(mode) {
  if (state.mode === mode) return;
  capture.stopAll();
  state.mode = mode;
  layoutViewport();
  render();
}

function setAspect(aspect) {
  state.aspect = aspect;
  layoutViewport();
  schedulePersist();
  render();
}

function findLensCamera(cameras, lens) {
  if (!lens.pattern) return null;
  return cameras.find((camera) => lens.pattern.test(camera.label)) ?? null;
}

function brandName(profile) {
  if (profile === 'authentic' || profile === 'vibrant') return 'Leica';
  if (profile === 'xpan') return 'Hasselblad';
  if (profile === 'zeiss') return 'Zeiss';
  return 'Neutral';
}

async function setLens(lensId) {
  const lens = LENSES.find((item) => item.id === lensId);
  const match = findLensCamera(await engine.listCameras(), lens);
  state.zoom = lens.zoom;
  if (match) {
    state.physicalLens = lens.id;
    if (state.cameraId === match.id) render();
    else await switchCamera(match.id);
    return;
  }
  const hadPhysical = state.physicalLens !== null;
  state.physicalLens = null;
  if (lens.pattern) showToast(`Tu navegador no expone la lente ${lens.label}: se usa zoom digital`);
  if (hadPhysical) await switchCamera('');
  else render();
}

function setLookMenu(open) {
  $('#lookMenu').classList.toggle('hidden', !open);
  $('#lookBtn').setAttribute('aria-expanded', String(open));
}

function selectLook(profileId) {
  const look = PROFILES[profileId];
  state.profile = profileId;
  state.aspect = look.aspect;
  state.hdr = look.hdr;
  setLookMenu(false);
  layoutViewport();
  schedulePersist();
  render();
}

async function toggleInfinity() {
  const next = !state.focusInfinity;
  const supported = await engine.setInfinityFocus(next);
  if (supported) state.focusInfinity = next;
  else showToast('Este dispositivo no permite bloquear el enfoque');
  render();
}

function renderThumb() {
  const latest = items[0];
  if (!latest) {
    thumbImg.hidden = true;
    thumbImg.removeAttribute('src');
    thumbEmpty.textContent = '';
    return;
  }
  if (latest.kind === 'photo') {
    thumbImg.src = latest.url;
    thumbImg.hidden = false;
    thumbEmpty.textContent = '';
  } else {
    thumbImg.hidden = true;
    thumbEmpty.textContent = 'VIDEO';
  }
}

function handleCaptured({ kind, blob, name, meta }) {
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    blob,
    name,
    meta,
    url: URL.createObjectURL(blob),
  };
  items = [item, ...items];
  for (const removed of items.splice(GALLERY_LIMIT)) URL.revokeObjectURL(removed.url);
  renderThumb();
  logCapture(deviceId, meta).catch((error) => {
    console.error(error);
    showToast('La captura no se registró en tu historial');
  });
}

const api = {
  frame: () => engine.getSource(performance.now() / 1000),
  captureSize: captureDims,
  layoutFor,
  grade: gradeOptions,
  settings: () => state.settings,
  meta: buildMeta,
  onCaptured: handleCaptured,
  previewSize,
  stabilized: () => stabilizationLevel().label,
};

const capture = createCaptureController({
  processor,
  api,
  getState: () => ({ mode: state.mode, timer: state.timer, videoProfile: state.videoProfile, astro: state.astro }),
});

function renderPreview(time) {
  const src = engine.getSource(time);
  if (!src) return;
  const { w, h } = previewSize();
  if (view.width !== w || view.height !== h) {
    view.width = w;
    view.height = h;
  }
  const layout = layoutFor(src, w, h);
  const stats = processor.renderFrame(view, src, layout, gradeOptions());
  drawHistogram(histCanvas, stats.hist, state.histChannels === 'rgb' ? ['r', 'g', 'b'] : ['l']);
  if (state.zoom > DIGITAL_SUPERZOOM_START) drawPip(pipCanvas, src, layout);
}

function tick(now) {
  requestAnimationFrame(tick);
  if (now - lastFrameAt < FRAME_INTERVAL_MS) return;
  lastFrameAt = now;
  renderPreview(now / 1000);
}

async function switchCamera(cameraId) {
  const error = await engine.start(cameraId);
  state.cameraId = cameraId;
  updateSourceNote(error);
  applyTorch();
  if (state.focusInfinity) await engine.setInfinityFocus(true);
  schedulePersist();
  render();
}

async function flipCamera() {
  const cameras = await engine.listCameras();
  if (cameras.length < 2) {
    showToast('Solo hay una cámara disponible');
    return;
  }
  const index = cameras.findIndex((camera) => camera.id === state.cameraId);
  state.physicalLens = null;
  await switchCamera(cameras[(index + 1) % cameras.length].id);
}

function applySavedPreferences(saved) {
  const clean = sanitizePreferences(saved);
  Object.assign(state, clean);
  if (clean.settings) state.settings = clean.settings;
}

async function loadSavedPreferences() {
  try {
    const saved = await loadPreferences(deviceId);
    if (saved) applySavedPreferences(saved);
  } catch (error) {
    console.error(error);
    showToast('No se pudieron cargar tus preferencias');
  }
}

const galleryModal = createGalleryModal({
  root: $('#galleryModal'),
  loadHistory: () => loadCaptureHistory(deviceId, HISTORY_LIMIT),
});

const settingsModal = createSettingsModal({
  root: $('#settingsModal'),
  onSave: async ({ settings, cameraId }) => {
    state.settings = settings;
    if (cameraId !== state.cameraId) await switchCamera(cameraId);
    schedulePersist();
    render();
    showToast('Ajustes guardados');
    return true;
  },
});

const controlsSheet = createSheet($('#controlsModal'));

async function openTechSettings() {
  controlsSheet.close();
  settingsModal.open({
    settings: state.settings,
    cameras: await engine.listCameras(),
    cameraId: state.cameraId,
  });
}

function cycleChip(key, list) {
  state[key] = nextId(list, state[key]);
}

function bindEvents() {
  attachStageGestures(viewport, {
    onPinch: (ratio) => {
      state.zoom = clamp(state.zoom * ratio, ZOOM_MIN, ZOOM_MAX);
      render();
    },
    onSwipeEv: (delta) => {
      state.ev = clamp(round1(state.ev + delta), -3, 3);
      showEvBadge();
      render();
    },
    onTap: (x, y) => {
      const rect = viewport.getBoundingClientRect();
      reticle.style.left = `${x - rect.left}px`;
      reticle.style.top = `${y - rect.top}px`;
      restartAnimation(reticle, 'show');
      if (!state.focusInfinity) engine.focusAt((x - rect.left) / rect.width, (y - rect.top) / rect.height);
    },
  });

  $$('#lensDial [data-lens]').forEach((btn) => btn.addEventListener('click', () => setLens(btn.dataset.lens)));
  $$('#modes [data-mode]').forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
  $$('#aspectSeg [data-aspect]').forEach((btn) => btn.addEventListener('click', () => setAspect(btn.dataset.aspect)));
  $$('#lightingSeg [data-light]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.lighting = btn.dataset.light;
      render();
    })
  );
  $$('#wbPresets [data-kelvin]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.kelvin = Number(btn.dataset.kelvin);
      render();
    })
  );
  $$('#astroSeconds [data-seconds]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.astro.seconds = Number(btn.dataset.seconds);
      render();
    })
  );
  document.querySelectorAll('#profiles [data-profile], #lookMenu [data-profile]').forEach((btn) =>
    btn.addEventListener('click', () => selectLook(btn.dataset.profile))
  );
  $('#lookBtn').addEventListener('click', () => setLookMenu($('#lookMenu').classList.contains('hidden')));
  document.addEventListener('click', (event) => {
    if (!$('#lookPicker').contains(event.target)) setLookMenu(false);
  });
  $('#infinityBtn').addEventListener('click', toggleInfinity);
  $$('#astroStack [data-stack]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.astro.stack = btn.dataset.stack;
      render();
    })
  );

  const sliders = [
    ['#mfSlider', (v) => (state.focus = v)],
    ['#shutterSlider', (v) => (state.shutter = shutterFromSlider(v))],
    ['#isoSlider', (v) => (state.iso = isoFromSlider(v))],
    ['#wbSlider', (v) => (state.kelvin = v)],
    ['#evSlider', (v) => (state.ev = round1(v))],
    ['#apertureSlider', (v) => (state.aperture = apertureFromSlider(v))],
  ];
  for (const [selector, apply] of sliders) {
    $(selector).addEventListener('input', (event) => {
      apply(Number(event.target.value));
      render();
    });
  }

  $('#flashBtn').addEventListener('click', () => {
    cycleChip('flash', FLASH_MODES);
    applyTorch();
    render();
  });
  $('#hdrBtn').addEventListener('click', () => {
    cycleChip('hdr', HDR_MODES);
    schedulePersist();
    render();
  });
  $('#timerBtn').addEventListener('click', () => {
    cycleChip('timer', TIMER_MODES);
    render();
  });
  $('#gridBtn').addEventListener('click', () => {
    cycleChip('grid', GRID_MODES);
    schedulePersist();
    render();
  });
  $('#peakBtn').addEventListener('click', () => {
    state.peaking = !state.peaking;
    render();
  });
  $('#zebraBtn').addEventListener('click', () => {
    state.zebra = !state.zebra;
    render();
  });
  $('#levelBtn').addEventListener('click', () => {
    state.level = !state.level;
    if (state.level) ensureOrientation();
    render();
  });
  document.querySelectorAll('#stabSeg [data-stab]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.stabilization = btn.dataset.stab;
      if (state.stabilization !== 'off') ensureOrientation();
      schedulePersist();
      render();
    })
  );
  $('#videoProfile').addEventListener('change', (event) => {
    state.videoProfile = event.target.value;
    schedulePersist();
    render();
  });
  $('#hist').addEventListener('click', () => {
    state.histChannels = state.histChannels === 'rgb' ? 'luma' : 'rgb';
    render();
  });

  $('#shutterBtn').addEventListener('click', () => capture.trigger());
  $('#flipBtn').addEventListener('click', flipCamera);
  $('#galleryBtn').addEventListener('click', () => galleryModal.open(items));
  $('#settingsBtn').addEventListener('click', () => controlsSheet.open());
  $('#techSettingsBtn').addEventListener('click', openTechSettings);

  window.addEventListener('resize', layoutViewport);
}

async function init() {
  await loadSavedPreferences();
  let error = await engine.start(state.cameraId);
  if (error && state.cameraId) {
    state.cameraId = '';
    error = await engine.start('');
  }
  updateSourceNote(error);
  applyTorch();
  if (state.stabilization !== 'off' || state.level) ensureOrientation({ silent: true });
  bindEvents();
  layoutViewport();
  render();
  renderThumb();
  requestAnimationFrame(tick);
}

init();
