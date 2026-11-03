export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function showToast(message) {
  const container = $('#toast');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  container.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

export function restartAnimation(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function haptic(ms = 18) {
  navigator.vibrate?.(ms);
}

export function playShutterSound() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;
  const ctx = new AudioCtor();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 1800;
  gain.gain.setValueAtTime(0.25, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.1);
  setTimeout(() => ctx.close(), 300);
}

export const formatShutter = (seconds) => (seconds >= 1 ? `${seconds}s` : `1/${Math.round(1 / seconds)}`);
export const formatEv = (ev) => `${ev >= 0 ? '+' : ''}${ev.toFixed(1)} EV`;
export const formatFocus = (x) => {
  if (x < 0.02) return 'Macro';
  if (x > 0.98) return '∞';
  return `${(0.1 * 10 ** (x * 2)).toFixed(2)} m`;
};

export const shutterFromSlider = (x) => (1 / 8000) * 256000 ** x;
export const sliderFromShutter = (s) => Math.log(s * 8000) / Math.log(256000);
export const isoFromSlider = (x) => Math.round(100 * 64 ** x);
export const sliderFromIso = (iso) => Math.log(iso / 100) / Math.log(64);
export const apertureFromSlider = (x) => 1.2 * (16 / 1.2) ** x;
export const sliderFromAperture = (f) => Math.log(f / 1.2) / Math.log(16 / 1.2);
