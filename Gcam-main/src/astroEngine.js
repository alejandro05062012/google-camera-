const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createStack(width, height, mode) {
  const sum = new Float32Array(width * height * 4);
  let count = 0;
  return {
    add(data) {
      if (mode === 'trails') {
        for (let i = 0; i < sum.length; i++) {
          const decayed = sum[i] * 0.97;
          sum[i] = data[i] > decayed ? data[i] : decayed;
        }
      } else {
        for (let i = 0; i < sum.length; i++) sum[i] += data[i];
      }
      count++;
    },
    toImageData({ boost }) {
      const out = new ImageData(width, height);
      const d = out.data;
      const divisor = mode === 'trails' ? 1 : Math.max(count, 1);
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          let v = sum[i + c] / divisor;
          if (boost && v > 170) v += (v - 170) * 0.6;
          d[i + c] = v;
        }
        d[i + 3] = 255;
      }
      return out;
    },
  };
}

export async function accumulateFrames({
  frames,
  intervalMs,
  width,
  height,
  mode = 'mean',
  boost = false,
  sampleFrame,
  onProgress,
  isCancelled,
}) {
  const stack = createStack(width, height, mode);
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const sctx = scratch.getContext('2d', { willReadFrequently: true });

  for (let f = 0; f < frames; f++) {
    if (isCancelled?.()) return null;
    sampleFrame(scratch);
    stack.add(sctx.getImageData(0, 0, width, height).data);
    onProgress?.((f + 1) / frames);
    if (f < frames - 1) await wait(intervalMs);
  }
  return stack.toImageData({ boost });
}
