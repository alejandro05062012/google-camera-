const SIM_WIDTH = 960;
const SIM_HEIGHT = 540;
const SIM_STAR_COUNT = 220;

function pseudoRandom(seed) {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function createSimulatedScene() {
  const canvas = document.createElement('canvas');
  canvas.width = SIM_WIDTH;
  canvas.height = SIM_HEIGHT;
  const ctx = canvas.getContext('2d');
  const stars = Array.from({ length: SIM_STAR_COUNT }, (_, i) => ({
    x: pseudoRandom(i * 2 + 1) * SIM_WIDTH,
    y: pseudoRandom(i * 2 + 2) * SIM_HEIGHT * 0.7,
    r: 0.6 + pseudoRandom(i + 99) * 1.6,
    phase: pseudoRandom(i + 7) * Math.PI * 2,
  }));

  return {
    canvas,
    draw(time) {
      const brightness = 0.55 + 0.35 * Math.sin(time / 6);
      const sky = ctx.createLinearGradient(0, 0, 0, SIM_HEIGHT);
      sky.addColorStop(0, '#0b1d33');
      sky.addColorStop(1, '#22302c');
      ctx.globalAlpha = 1;
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, SIM_WIDTH, SIM_HEIGHT);

      ctx.fillStyle = '#ffffff';
      for (const star of stars) {
        const twinkle = 0.6 + 0.4 * Math.sin(time * 2 + star.phase);
        ctx.globalAlpha = Math.min(1, brightness * twinkle);
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }

      const moonX = 720 + Math.sin(time / 20) * 40;
      ctx.globalAlpha = brightness;
      ctx.fillStyle = '#f3e3b0';
      ctx.beginPath();
      ctx.arc(moonX, 120, 38, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = '#05080c';
      ctx.beginPath();
      ctx.moveTo(0, SIM_HEIGHT);
      for (let x = 0; x <= SIM_WIDTH; x += 40) {
        ctx.lineTo(x, SIM_HEIGHT * 0.78 + Math.sin(x * 0.02) * 18 + Math.sin(x * 0.07) * 8);
      }
      ctx.lineTo(SIM_WIDTH, SIM_HEIGHT);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = 0.5 + 0.3 * brightness;
      ctx.fillStyle = '#d6aa82';
      ctx.beginPath();
      ctx.arc(380, 220, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#2a3e52';
      ctx.beginPath();
      ctx.ellipse(380, 380, 70, 150, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    },
  };
}

export function createCameraEngine() {
  let stream = null;
  let video = null;
  let scene = null;
  let mode = 'simulation';

  function stopStream() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (video) {
      video.srcObject = null;
      video = null;
    }
  }

  function useSimulation() {
    stopStream();
    mode = 'simulation';
    scene ??= createSimulatedScene();
  }

  function currentTrack() {
    return stream?.getVideoTracks()[0] ?? null;
  }

  return {
    get mode() {
      return mode;
    },

    async start(deviceId = '') {
      if (!navigator.mediaDevices?.getUserMedia) {
        useSimulation();
        return 'UnsupportedError';
      }
      stopStream();
      const video2d = { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } };
      if (deviceId) video2d.deviceId = { exact: deviceId };
      else video2d.facingMode = 'environment';
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: video2d });
        const el = document.createElement('video');
        el.muted = true;
        el.playsInline = true;
        el.srcObject = stream;
        await el.play();
        video = el;
        mode = 'camera';
        return null;
      } catch (error) {
        useSimulation();
        return error.name || 'Error';
      }
    },

    async listCameras() {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((device) => device.kind === 'videoinput')
        .map((device, index) => ({ id: device.deviceId, label: device.label || `Cámara ${index + 1}` }));
    },

    getSource(timeSeconds) {
      if (mode === 'camera') {
        if (!video || video.readyState < 2 || video.videoWidth === 0) return null;
        return { el: video, width: video.videoWidth, height: video.videoHeight };
      }
      scene.draw(timeSeconds);
      return { el: scene.canvas, width: SIM_WIDTH, height: SIM_HEIGHT };
    },

    setTorch(on) {
      const track = currentTrack();
      if (!track?.getCapabilities?.()?.torch) return;
      track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {});
    },

    focusAt(nx, ny) {
      const track = currentTrack();
      if (!track?.getCapabilities?.()?.focusMode) return;
      track
        .applyConstraints({ advanced: [{ focusMode: 'single-shot', pointsOfInterest: [{ x: nx, y: ny }] }] })
        .catch(() => {});
    },

    async setInfinityFocus(on) {
      const track = currentTrack();
      const caps = track?.getCapabilities?.();
      if (!caps?.focusDistance) return false;
      const constraint = on
        ? { focusMode: 'manual', focusDistance: caps.focusDistance.min }
        : { focusMode: 'continuous' };
      await track.applyConstraints({ advanced: [constraint] }).catch(() => {});
      return true;
    },
  };
}

export function startOrientation(onChange) {
  const handler = (event) => {
    if (event.gamma == null) return;
    onChange({ roll: event.gamma, pitch: event.beta ?? 0 });
  };
  window.addEventListener('deviceorientation', handler);
  return () => window.removeEventListener('deviceorientation', handler);
}

export async function requestOrientationAccess() {
  const OrientationEvent = window.DeviceOrientationEvent;
  if (typeof OrientationEvent?.requestPermission === 'function') {
    try {
      return (await OrientationEvent.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }
  return Boolean(OrientationEvent);
}

const MOTION_SMOOTHING = 0.05;

export function createMotionSmoother() {
  let raw = { x: 0, y: 0 };
  let smooth = { x: 0, y: 0 };
  return {
    push(x, y) {
      raw = { x, y };
      smooth = {
        x: smooth.x + (x - smooth.x) * MOTION_SMOOTHING,
        y: smooth.y + (y - smooth.y) * MOTION_SMOOTHING,
      };
    },
    shift({ gain, maxShift }) {
      const clampShift = (v) => Math.max(-maxShift, Math.min(maxShift, v));
      return {
        x: clampShift(-(raw.x - smooth.x) * gain),
        y: clampShift(-(raw.y - smooth.y) * gain),
      };
    },
  };
}
