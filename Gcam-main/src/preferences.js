import {
  ASPECTS,
  DEFAULT_SETTINGS,
  GRID_MODES,
  HDR_MODES,
  PROFILES,
  STABILIZATION_LEVELS,
  VIDEO_PROFILES,
} from '@/config.js';

const hasOption = (list, value) => list.some((item) => item.id === value);

export function sanitizePreferences(saved) {
  const clean = {};
  if (Object.hasOwn(PROFILES, saved.profile)) clean.profile = saved.profile;
  if (ASPECTS.some((aspect) => aspect.id === saved.aspect)) clean.aspect = saved.aspect;
  if (hasOption(HDR_MODES, saved.hdr)) clean.hdr = saved.hdr;
  if (Object.hasOwn(VIDEO_PROFILES, saved.videoProfile)) clean.videoProfile = saved.videoProfile;
  if (hasOption(GRID_MODES, saved.grid)) clean.grid = saved.grid;
  if (Object.hasOwn(STABILIZATION_LEVELS, saved.stabilization)) clean.stabilization = saved.stabilization;
  if (typeof saved.cameraId === 'string') clean.cameraId = saved.cameraId;
  if (saved.settings && typeof saved.settings === 'object') {
    const known = Object.keys(DEFAULT_SETTINGS).filter((key) => Object.hasOwn(saved.settings, key));
    clean.settings = { ...DEFAULT_SETTINGS, ...Object.fromEntries(known.map((key) => [key, saved.settings[key]])) };
  }
  return clean;
}
