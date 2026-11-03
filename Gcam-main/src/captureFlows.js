import { accumulateFrames } from '@/astroEngine.js';
import { computeLayout, refineImage, stampFrame } from '@/imageProcessor.js';
import { NR_LEVELS, VIDEO_PROFILES } from '@/config.js';
import { $, downloadBlob, haptic, playShutterSound, restartAnimation, showToast } from '@/ui.js';

const INTERVAL_MS = 3000;
const INTERVAL_MAX_SHOTS = 20;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatClock = (seconds) => {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const newCanvas = (w, h) => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
};

const toBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo codificar la imagen'))),
      type,
      quality
    );
  });

function geoTag(enabled) {
  if (!enabled || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: +pos.coords.latitude.toFixed(5), lon: +pos.coords.longitude.toFixed(5) }),
      () => resolve(null),
      { timeout: 4000, maximumAge: 60000 }
    );
  });
}

export function createCaptureController({ processor, api, getState }) {
  let busy = false;
  let intervalTimer = null;
  let intervalShots = 0;
  let recorder = null;
  let recordChunks = [];
  let recordTicker = null;
  let recordStartedAt = 0;

  const shutterEl = () => $('#shutterBtn');
  const identityLayout = (w, h) => computeLayout(w, h, w, h, 1);

  function showProgress(title, sub) {
    $('#progress').classList.remove('hidden');
    $('#progressText').textContent = title;
    $('#progressSub').textContent = sub;
    updateProgress(0, '');
  }

  function updateProgress(fraction, label) {
    const arc = $('#progressArc');
    arc.style.strokeDashoffset = String(301.6 * (1 - fraction));
    if (label) $('#progressSub').textContent = label;
  }

  function hideProgress() {
    $('#progress').classList.add('hidden');
  }

  async function countdown(seconds) {
    const el = $('#countdown');
    for (let s = seconds; s > 0; s--) {
      el.textContent = String(s);
      el.classList.remove('hidden');
      restartAnimation(el, 'pop');
      await wait(1000);
    }
    el.classList.add('hidden');
  }

  function infoLine(meta) {
    return `ISO ${meta.iso}  ${meta.shutter}  f/${meta.aperture}  ${meta.profile}  ${meta.lens}`;
  }

  async function finalizePhoto(canvas, extraMeta) {
    const settings = api.settings();
    refineImage(canvas, { noiseReduction: NR_LEVELS[settings.nr] ?? 0, sharpness: settings.sharpness });
    const meta = { ...api.meta(extraMeta), location: await geoTag(settings.geotag), createdAt: new Date().toISOString() };
    stampFrame(canvas, { watermark: settings.watermark, info: infoLine(meta) });

    const isPng = settings.format === 'png';
    const blob = await toBlob(canvas, isPng ? 'image/png' : 'image/jpeg', isPng ? undefined : settings.quality);
    const base = `ultra-camera-${meta.createdAt.replace(/[:.]/g, '-')}`;
    const name = `${base}.${isPng ? 'png' : 'jpg'}`;
    downloadBlob(blob, name);

    if (settings.format === 'raw') {
      const sidecar = new Blob([JSON.stringify({ ...meta, note: 'Sidecar simulado RAW + JPEG' }, null, 2)], {
        type: 'application/json',
      });
      downloadBlob(sidecar, `${base}.json`);
    }
    api.onCaptured({ kind: 'photo', blob, name, meta });
  }

  function fireFeedback() {
    restartAnimation($('#flash'), 'fire');
    haptic();
    if (api.settings().shutterSound) playShutterSound();
  }

  async function capturePhoto() {
    const frame = api.frame();
    if (!frame) return showToast('La cámara todavía no está lista');
    const { w, h } = api.captureSize(frame);
    const out = newCanvas(w, h);
    processor.renderFrame(out, frame, api.layoutFor(frame, w, h), api.grade({ capture: true }));
    fireFeedback();
    await finalizePhoto(out, { mode: 'Foto', width: w, height: h });
  }

  function sampleFromSource(canvas) {
    const src = api.frame();
    if (src) processor.drawRaw(canvas, src, api.layoutFor(src, canvas.width, canvas.height));
  }

  async function captureNight() {
    const { w, h } = api.previewSize();
    showProgress('Capturando luz...', 'No mueva el dispositivo');
    const stacked = await accumulateFrames({
      frames: 8,
      intervalMs: 200,
      width: w,
      height: h,
      mode: 'mean',
      sampleFrame: sampleFromSource,
      onProgress: (p) => updateProgress(p, `${Math.round(p * 100)}%`),
    });
    showProgress('Procesando imagen...', 'Reduciendo ruido y levantando sombras');
    const stackCanvas = newCanvas(w, h);
    stackCanvas.getContext('2d').putImageData(stacked, 0, 0);
    const out = newCanvas(w, h);
    processor.renderFrame(out, { el: stackCanvas }, identityLayout(w, h), api.grade({ capture: true, hdr: 1, noise: 0, extraStops: 1.1 }));
    fireFeedback();
    await finalizePhoto(out, { mode: 'Noche', width: w, height: h });
  }

  async function captureAstro() {
    const { astro } = getState();
    const { w, h } = api.previewSize();
    const trails = astro.stack === 'trails';
    const total = astro.seconds;
    showProgress('Acumulando luz estelar', `Tiempo restante ${formatClock(total)}`);
    const stacked = await accumulateFrames({
      frames: astro.seconds * 5,
      intervalMs: 200,
      width: w,
      height: h,
      mode: trails ? 'trails' : 'mean',
      boost: !trails,
      sampleFrame: sampleFromSource,
      onProgress: (p) => updateProgress(p, `Tiempo restante ${formatClock(total * (1 - p))}`),
    });
    showProgress('Procesando astrofoto...', 'Alineando estrellas y eliminando ruido térmico');
    const stackCanvas = newCanvas(w, h);
    stackCanvas.getContext('2d').putImageData(stacked, 0, 0);
    const out = newCanvas(w, h);
    processor.renderFrame(out, { el: stackCanvas }, identityLayout(w, h), api.grade({ capture: true, hdr: 1, extraStops: 1.2, light: null }));
    fireFeedback();
    await finalizePhoto(out, { mode: trails ? 'Star Trails' : 'Astro', width: w, height: h });
  }

  function setRecordingUi(active) {
    shutterEl().classList.toggle('is-recording', active);
    $('#recBadge').classList.toggle('hidden', !active);
    if (!active) clearInterval(recordTicker);
  }

  function startRecording() {
    if (!window.MediaRecorder) {
      return showToast('La grabación de video no está disponible en este navegador');
    }
    const { videoProfile } = getState();
    const profile = VIDEO_PROFILES[videoProfile];
    const out = newCanvas(profile.width, profile.height);
    if (!out.captureStream) {
      return showToast('La grabación de video no está disponible en este navegador');
    }
    const stream = out.captureStream(profile.fps);
    const mimeType = ['video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
    recordChunks = [];
    let frameHandle = 0;
    const renderVideoFrame = () => {
      const src = api.frame();
      if (src) processor.renderFrame(out, src, api.layoutFor(src, out.width, out.height), api.grade({ capture: true }));
      frameHandle = requestAnimationFrame(renderVideoFrame);
    };
    recorder.ondataavailable = (event) => {
      if (event.data.size) recordChunks.push(event.data);
    };
    recorder.onstop = async () => {
      cancelAnimationFrame(frameHandle);
      const duration = (performance.now() - recordStartedAt) / 1000;
      const blob = new Blob(recordChunks, { type: 'video/webm' });
      const name = `ultra-camera-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
      recorder = null;
      setRecordingUi(false);
      downloadBlob(blob, name);
      const meta = api.meta({
        mode: 'Video',
        videoProfile: profile.label,
        resolution: `${profile.width}×${profile.height}`,
        fps: profile.fps,
        slowMo: profile.slowMo,
        durationSeconds: Math.round(duration),
        stabilization: api.stabilized(),
        createdAt: new Date().toISOString(),
      });
      api.onCaptured({ kind: 'video', blob, name, meta });
    };
    recorder.start(250);
    recordStartedAt = performance.now();
    renderVideoFrame();
    setRecordingUi(true);
    recordTicker = setInterval(() => {
      $('#recTime').textContent = formatClock((performance.now() - recordStartedAt) / 1000);
    }, 500);
  }

  function stopInterval() {
    clearInterval(intervalTimer);
    intervalTimer = null;
    shutterEl().classList.remove('is-recording');
  }

  function startInterval() {
    intervalShots = 0;
    shutterEl().classList.add('is-recording');
    showToast('Intervalómetro activo: pulse de nuevo para detenerlo');
    const tick = async () => {
      if (busy) return;
      intervalShots++;
      await run(capturePhoto);
      if (intervalShots >= INTERVAL_MAX_SHOTS) stopInterval();
    };
    tick();
    intervalTimer = setInterval(tick, INTERVAL_MS);
  }

  async function run(task) {
    if (busy) return;
    busy = true;
    shutterEl().classList.add('is-busy');
    try {
      await task();
    } catch (error) {
      console.error(error);
      showToast('No se pudo completar la captura');
    } finally {
      busy = false;
      shutterEl().classList.remove('is-busy');
      hideProgress();
    }
  }

  return {
    async trigger() {
      const state = getState();
      if (state.mode === 'video') {
        if (recorder) recorder.stop();
        else startRecording();
        return;
      }
      if (intervalTimer) return stopInterval();
      if (busy) return;
      if (state.mode === 'night') return run(captureNight);
      if (state.mode === 'astro') return run(captureAstro);
      if (state.timer === 'interval') return startInterval();
      run(async () => {
        const seconds = Number(state.timer);
        if (seconds > 0) await countdown(seconds);
        await capturePhoto();
      });
    },

    stopAll() {
      if (intervalTimer) stopInterval();
      if (recorder) recorder.stop();
    },
  };
}
