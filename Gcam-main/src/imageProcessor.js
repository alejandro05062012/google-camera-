import { PROFILES } from '@/config.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const toIndex = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : v | 0);

const LIGHT_STYLES = {
  studio: { op: 'soft-light', center: 'rgba(255,240,222,0.7)', edge: 'rgba(255,240,222,0)' },
  contour: { op: 'multiply', center: '#ffffff', edge: '#4a4a55' },
  stage: { op: 'multiply', center: '#ffffff', edge: '#101018' },
};

export function kelvinToMultipliers(kelvin) {
  const t = clamp((kelvin - 5500) / 2500, -1, 1) * 0.18;
  return [1 + t, 1, 1 - t];
}

export function buildToneLut({ contrast, shadows, highlights, hdr }) {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let y = i / 255;
    y += (shadows + hdr * 0.14) * (1 - y) * (1 - y);
    y += (highlights - hdr * 0.07) * y * y;
    y = (y - 0.5) * contrast + 0.5;
    lut[i] = clamp(y, 0, 1) * 255;
  }
  return lut;
}

export function computeLayout(srcW, srcH, outW, outH, zoom, shift = { x: 0, y: 0 }) {
  const outAspect = outW / outH;
  let cw = srcW;
  let ch = srcH;
  if (srcW / srcH > outAspect) cw = srcH * outAspect;
  else ch = srcW / outAspect;
  const cx0 = (srcW - cw) / 2;
  const cy0 = (srcH - ch) / 2;

  if (zoom >= 1) {
    const vw = cw / zoom;
    const vh = ch / zoom;
    const cx = cx0 + cw / 2 + shift.x * srcW;
    const cy = cy0 + ch / 2 + shift.y * srcH;
    return {
      sx: clamp(cx - vw / 2, cx0, cx0 + cw - vw),
      sy: clamp(cy - vh / 2, cy0, cy0 + ch - vh),
      sw: vw,
      sh: vh,
      dx: 0,
      dy: 0,
      dw: outW,
      dh: outH,
      letterboxed: false,
    };
  }

  const dw = outW * zoom;
  const dh = outH * zoom;
  return {
    sx: cx0,
    sy: cy0,
    sw: cw,
    sh: ch,
    dx: (outW - dw) / 2,
    dy: (outH - dh) / 2,
    dw,
    dh,
    letterboxed: true,
  };
}

function buildVignette(w, h) {
  const map = new Float32Array(w * h);
  const cx = w / 2;
  const cy = h / 2;
  const norm = Math.hypot(cx, cy);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy) / norm;
      const t = clamp((d - 0.35) / 0.65, 0, 1);
      map[y * w + x] = t * t * (3 - 2 * t);
    }
  }
  return map;
}

function createCache() {
  const canvases = {};
  const floats = {};
  let vignette = null;
  let vignetteKey = '';
  return {
    canvas(name, w, h) {
      let c = canvases[name];
      if (!c) {
        c = document.createElement('canvas');
        canvases[name] = c;
      }
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      return c;
    },
    floats(name, n) {
      if (!floats[name] || floats[name].length !== n) floats[name] = new Float32Array(n);
      return floats[name];
    },
    vignette(w, h) {
      const key = `${w}x${h}`;
      if (key !== vignetteKey) {
        vignette = buildVignette(w, h);
        vignetteKey = key;
      }
      return vignette;
    },
  };
}

function gradeImage(img, g, cache, meterRect) {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const luma = cache.floats('luma', n);
  const vig = g.vignette > 0 ? cache.vignette(w, h) : null;
  const [wr, wg, wb] = g.wb;
  const [tr, tg, tb] = g.tint;
  const { lut, gain, saturation: sat, skin, noise } = g;
  const hist = {
    r: new Uint32Array(256),
    g: new Uint32Array(256),
    b: new Uint32Array(256),
    l: new Uint32Array(256),
  };
  let sum = 0;

  for (let p = 0, i = 0; p < n; p++, i += 4) {
    let r = lut[toIndex(data[i] * gain * wr)];
    let gr = lut[toIndex(data[i + 1] * gain * wg)];
    let b = lut[toIndex(data[i + 2] * gain * wb)];

    const l0 = 0.299 * r + 0.587 * gr + 0.114 * b;
    if (sat !== 1) {
      r = l0 + (r - l0) * sat;
      gr = l0 + (gr - l0) * sat;
      b = l0 + (b - l0) * sat;
    }
    if (skin > 0 && r > gr && gr > b) r += skin * 6;
    r += tr;
    gr += tg;
    b += tb;
    if (vig) {
      const f = 1 - g.vignette * vig[p];
      r *= f;
      gr *= f;
      b *= f;
    }
    if (noise > 0) {
      const nz = (Math.random() - 0.5) * noise;
      r += nz;
      gr += nz;
      b += nz;
    }

    data[i] = r;
    data[i + 1] = gr;
    data[i + 2] = b;
    const R = data[i];
    const G = data[i + 1];
    const B = data[i + 2];
    const y = 0.299 * R + 0.587 * G + 0.114 * B;
    luma[p] = y;
    sum += y;
    hist.r[R]++;
    hist.g[G]++;
    hist.b[B]++;
    hist.l[y | 0]++;
  }

  if (g.zebra) {
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      if (luma[p] < 244) continue;
      const stripe = ((p % w) + ((p / w) | 0)) >> 3;
      if (stripe & 1) {
        data[i] = 255;
        data[i + 1] = 40;
        data[i + 2] = 40;
      }
    }
  }

  if (g.peaking && w > 2 && h > 2) {
    const mag = cache.floats('mag', n);
    mag.fill(0);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        const gx =
          -luma[p - w - 1] - 2 * luma[p - 1] - luma[p + w - 1] + luma[p - w + 1] + 2 * luma[p + 1] + luma[p + w + 1];
        const gy =
          -luma[p - w - 1] - 2 * luma[p - w] - luma[p - w + 1] + luma[p + w - 1] + 2 * luma[p + w] + luma[p + w + 1];
        mag[p] = Math.abs(gx) + Math.abs(gy);
      }
    }
    const thr = g.peakThreshold;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      if (mag[p] <= thr) continue;
      if (mag[p] > thr * 2.2) {
        data[i] = 255;
        data[i + 1] = 40;
        data[i + 2] = 40;
      } else {
        data[i] = 40;
        data[i + 1] = 255;
        data[i + 2] = 110;
      }
    }
  }

  let meter = null;
  if (meterRect) {
    let ms = 0;
    let mc = 0;
    const x0 = clamp(meterRect.x0, 0, w - 1);
    const x1 = clamp(meterRect.x1, 0, w - 1);
    const y0 = clamp(meterRect.y0, 0, h - 1);
    const y1 = clamp(meterRect.y1, 0, h - 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        ms += luma[y * w + x];
        mc++;
      }
    }
    meter = mc > 0 ? ms / mc : null;
  }

  return { avg: sum / n, meter, hist };
}

export function buildGrade(opts) {
  const profile = PROFILES[opts.profile] ?? PROFILES.gcam;
  return {
    gain: 2 ** opts.stops,
    wb: kelvinToMultipliers(opts.kelvin),
    lut: buildToneLut({
      contrast: profile.contrast,
      shadows: profile.shadows,
      highlights: profile.highlights,
      hdr: opts.hdr,
    }),
    saturation: profile.saturation,
    tint: profile.tint,
    vignette: profile.vignette,
    skin: profile.skin,
    noise: opts.noise ?? 0,
    zebra: Boolean(opts.zebra),
    peaking: Boolean(opts.peaking),
    peakThreshold: 110,
    bokeh: opts.bokeh ?? 0,
    defocus: opts.defocus ?? 0,
    light: opts.light ?? null,
  };
}

export function createImageProcessor() {
  const cache = createCache();

  function drawBackdrop(ctx, source, w, h) {
    const small = cache.canvas('backdrop', Math.max(1, w >> 3), Math.max(1, h >> 3));
    small.getContext('2d').drawImage(source.el, 0, 0, small.width, small.height);
    ctx.drawImage(small, 0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, w, h);
  }

  function blurInto(ctx, w, h, factor, alpha) {
    const small = cache.canvas('blurSmall', Math.max(1, Math.round(w / factor)), Math.max(1, Math.round(h / factor)));
    small.getContext('2d').drawImage(ctx.canvas, 0, 0, small.width, small.height);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(small, 0, 0, w, h);
    ctx.restore();
  }

  function applyBokeh(ctx, w, h, amount) {
    const sharp = cache.canvas('sharp', w, h);
    const sctx = sharp.getContext('2d');
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, w, h);
    sctx.drawImage(ctx.canvas, 0, 0);

    blurInto(ctx, w, h, 4 + amount * 28, 1);

    const mask = cache.canvas('mask', w, h);
    const mctx = mask.getContext('2d');
    mctx.clearRect(0, 0, w, h);
    mctx.save();
    mctx.translate(w * 0.5, h * 0.46);
    mctx.scale(1, 1.3);
    const radius = Math.min(w, h) * 0.36;
    const grad = mctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    grad.addColorStop(0, '#000');
    grad.addColorStop(0.72, '#000');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    mctx.fillStyle = grad;
    mctx.fillRect(-w * 2, -h * 2, w * 4, h * 4);
    mctx.restore();

    sctx.globalCompositeOperation = 'destination-in';
    sctx.drawImage(mask, 0, 0);
    sctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(sharp, 0, 0);
  }

  function applyLighting(ctx, w, h, light) {
    const style = LIGHT_STYLES[light];
    if (!style) return;
    const grad = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, Math.max(w, h) * 0.6);
    grad.addColorStop(0, style.center);
    grad.addColorStop(1, style.edge);
    ctx.save();
    ctx.globalCompositeOperation = style.op;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function prepare(out, source, lay) {
    const w = out.width;
    const h = out.height;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    if (lay.letterboxed) drawBackdrop(ctx, source, w, h);
    ctx.drawImage(source.el, lay.sx, lay.sy, lay.sw, lay.sh, lay.dx, lay.dy, lay.dw, lay.dh);
    return { ctx, w, h };
  }

  return {
    drawRaw(out, source, lay) {
      prepare(out, source, lay);
    },

    renderFrame(out, source, lay, grade, meterRect = null) {
      const { ctx, w, h } = prepare(out, source, lay);
      if (grade.bokeh > 0) applyBokeh(ctx, w, h, grade.bokeh);
      if (grade.defocus > 0) blurInto(ctx, w, h, 6, clamp(grade.defocus, 0, 0.85));
      if (grade.light) applyLighting(ctx, w, h, grade.light);
      const img = ctx.getImageData(0, 0, w, h);
      const stats = gradeImage(img, grade, cache, meterRect);
      ctx.putImageData(img, 0, 0);
      return stats;
    },
  };
}

export function refineImage(canvas, { noiseReduction, sharpness }) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (noiseReduction > 0) {
    const tmp = document.createElement('canvas');
    tmp.width = Math.max(1, w >> 1);
    tmp.height = Math.max(1, h >> 1);
    tmp.getContext('2d').drawImage(canvas, 0, 0, tmp.width, tmp.height);
    ctx.save();
    ctx.globalAlpha = noiseReduction;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmp, 0, 0, w, h);
    ctx.restore();
  }

  if (sharpness > 0) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const src = new Uint8ClampedArray(d);
    const s = sharpness * 0.5;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const center = src[i + c];
          const around = src[i - 4 + c] + src[i + 4 + c] + src[i - w * 4 + c] + src[i + w * 4 + c];
          d[i + c] = center + (4 * center - around) * s;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}

export function stampFrame(canvas, { watermark, info }) {
  const ctx = canvas.getContext('2d');
  const barH = Math.round(canvas.height * 0.085);
  const y = canvas.height - barH;
  const pad = Math.round(canvas.width * 0.03);
  const fontSize = Math.round(barH * 0.36);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, y, canvas.width, barH);
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#E8B923';
  ctx.fillText(watermark, pad, y + barH / 2);
  ctx.font = `500 ${Math.round(fontSize * 0.8)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#a1a1aa';
  ctx.fillText(info, canvas.width - pad, y + barH / 2);
}
