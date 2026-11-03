export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 200;
export const DIGITAL_SUPERZOOM_START = 10;
export const MACRO_ZOOM = 2.5;

export const LENSES = [
  { id: 'uw', label: '.6x', zoom: 0.6, name: 'Ultra Wide', equiv: '13 mm', aperture: 2.2, pattern: /ultra|0\.6|\buw\b/i },
  { id: 'wide', label: '1x', zoom: 1, name: 'Principal', equiv: '26 mm', aperture: 1.8, pattern: null },
  { id: 'tele', label: '3x', zoom: 3, name: 'Telefoto', equiv: '76 mm', aperture: 2.4, pattern: /tele|3x/i },
  { id: 'peri', label: '10x', zoom: 10, name: 'Periscopio', equiv: '240 mm', aperture: 4.9, pattern: /peri|10x/i },
  { id: 'super', label: '200X', zoom: 200, name: 'SuperZoom Híbrido', equiv: 'Recorte digital', aperture: 4.9 },
];

export const ASPECTS = [
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: 'xpan', label: 'XPan', ratio: 65 / 24 },
  { id: 'full', label: 'Full', ratio: null },
];

export const PROFILES = {
  authentic: {
    label: 'Leica Auténtico',
    aspect: '4:3',
    hdr: 'off',
    contrast: 1.2,
    saturation: 0.88,
    tint: [-3, 0, 6],
    vignette: 0.32,
    shadows: 0.03,
    highlights: -0.05,
    skin: 0,
  },
  vibrant: {
    label: 'Leica Vibrante',
    aspect: '4:3',
    hdr: 'auto',
    contrast: 1.06,
    saturation: 1.32,
    tint: [4, 0, -2],
    vignette: 0.08,
    shadows: 0.07,
    highlights: 0,
    skin: 0,
  },
  zeiss: {
    label: 'Zeiss Natural',
    aspect: '4:3',
    hdr: 'auto',
    contrast: 1.05,
    saturation: 0.98,
    tint: [-1, 0, 1],
    vignette: 0.06,
    shadows: 0.02,
    highlights: -0.02,
    skin: 0.15,
  },
  xpan: {
    label: 'Hasselblad XPan',
    aspect: 'xpan',
    hdr: 'auto',
    contrast: 1.08,
    saturation: 0.9,
    tint: [7, 3, -4],
    vignette: 0.2,
    shadows: 0.04,
    highlights: -0.04,
    skin: 0.35,
  },
  gcam: {
    label: 'Neutral',
    aspect: 'full',
    hdr: 'auto',
    contrast: 1,
    saturation: 1,
    tint: [0, 0, 0],
    vignette: 0,
    shadows: 0.03,
    highlights: 0,
    skin: 0,
  },
};

export const LIGHTING = [
  { id: 'natural', label: 'Natural' },
  { id: 'studio', label: 'Studio' },
  { id: 'contour', label: 'Contour' },
  { id: 'stage', label: 'Stage Light' },
];

export const NR_LEVELS = { bajo: 0.12, medio: 0.3, ultra: 0.55 };

export const VIDEO_PROFILES = {
  '4k30': { label: '4K 30 FPS', fps: 30, width: 3840, height: 2160, slowMo: null },
  '4k60': { label: '4K 60 FPS', fps: 60, width: 3840, height: 2160, slowMo: null },
  '8k24': { label: '8K 24 FPS', fps: 24, width: 7680, height: 4320, slowMo: null },
  slow120: { label: 'Cámara lenta 120', fps: 60, width: 1920, height: 1080, slowMo: 120 },
  slow240: { label: 'Cámara lenta 240', fps: 60, width: 1920, height: 1080, slowMo: 240 },
};

export const STABILIZATION_LEVELS = {
  off: { label: 'Off', crop: 1, gain: 0, maxShift: 0 },
  standard: { label: 'Estándar', crop: 1.08, gain: 1 / 60, maxShift: 0.04 },
  super: { label: 'Súper estable', crop: 1.15, gain: 1 / 40, maxShift: 0.07 },
};

export const FLASH_MODES = [
  { id: 'off', label: 'Off' },
  { id: 'auto', label: 'Auto' },
  { id: 'on', label: 'On' },
  { id: 'light', label: 'Luz' },
];

export const HDR_MODES = [
  { id: 'off', label: 'Off' },
  { id: 'auto', label: 'Auto' },
  { id: 'plus', label: 'Plus' },
];

export const TIMER_MODES = [
  { id: 'off', label: 'Off' },
  { id: '2', label: '2s' },
  { id: '5', label: '5s' },
  { id: '10', label: '10s' },
  { id: 'interval', label: 'Intervalo' },
];

export const GRID_MODES = [
  { id: 'off', label: 'Off' },
  { id: 'thirds', label: 'Tercios' },
  { id: 'golden', label: 'Áureo' },
  { id: 'diagonal', label: 'Diagonal' },
  { id: 'cross', label: 'Cruz' },
];

export const SENSOR_IDS = {
  auto: 'Automático',
  'hm3-108mp': 'HM3 108 MP (S21 Ultra)',
  'gn1-50mp': 'GN1 50 MP (Principal)',
  'imx-alt': 'IMX586 48 MP (Alternativo)',
};

export const SUBJECT_FOCUS = 0.6;
export const MACRO_FOCUS = 0.95;

export const DEFAULT_SETTINGS = {
  format: 'jpeg',
  quality: 0.95,
  nr: 'medio',
  watermark: 'GCam Ultra S21 | Leica Hasselblad Edition',
  shutterSound: true,
  geotag: false,
  autoHdr: true,
  sharpness: 0.3,
  noiseModel: true,
  sensorId: 'auto',
};

export const DEFAULT_PREFS = {
  profile: 'gcam',
  aspect: 'full',
  hdr: 'auto',
  videoProfile: '4k30',
  stabilization: 'off',
};

export const GALLERY_LIMIT = 30;
