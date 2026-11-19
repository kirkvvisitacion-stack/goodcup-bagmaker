// Pillow 11 Image.resize(..., LANCZOS) for 8-bit RGB, ported line for line from Resample.c so the page builds the same texture
// bag_library.place() builds (horizontal pass, 8-bit clip, vertical pass, 22-bit fixed point coefficients).
const PREC = 22, ONE = 2 ** PREC;
function sinc(x) { if (x === 0) return 1; x *= Math.PI; return Math.sin(x) / x; }
function lanczos(x) { return (x > -3 && x < 3) ? sinc(x) * sinc(x / 3) : 0; }
function coeffs(inSize, outSize) {
  const scale = inSize / outSize, fs = Math.max(scale, 1), support = 3 * fs, ksize = Math.ceil(support) * 2 + 1;
  const kk = new Float64Array(outSize * ksize), bounds = new Int32Array(outSize * 2), ss = 1 / fs;
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    let xmin = Math.trunc(center - support + 0.5); if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5); if (xmax > inSize) xmax = inSize; xmax -= xmin;
    let ww = 0; const base = xx * ksize;
    for (let x = 0; x < xmax; x++) { const w = lanczos((x + xmin - center + 0.5) * ss); kk[base + x] = w; ww += w; }
    for (let x = 0; x < xmax; x++) if (ww !== 0) kk[base + x] /= ww;
    bounds[xx * 2] = xmin; bounds[xx * 2 + 1] = xmax;
  }
  const ik = new Float64Array(kk.length);
  for (let i = 0; i < kk.length; i++) ik[i] = kk[i] < 0 ? Math.trunc(-0.5 + kk[i] * ONE) : Math.trunc(0.5 + kk[i] * ONE);
  return { ksize, ik, bounds };
}
const clip8 = (s) => { s = Math.floor(s / ONE); return s < 0 ? 0 : s > 255 ? 255 : s; };
// src: Uint8Array RGB (3 bytes per px), w x h -> Uint8Array RGB ow x oh
export function resizeLanczos(src, w, h, ow, oh) {
  let cur = src, cw = w;
  if (ow !== w) {
    const { ksize, ik, bounds } = coeffs(w, ow), out = new Uint8Array(ow * h * 3);
    for (let y = 0; y < h; y++) for (let xx = 0; xx < ow; xx++) {
      const xmin = bounds[xx * 2], xmax = bounds[xx * 2 + 1], kb = xx * ksize; let r = ONE / 2, g = ONE / 2, b = ONE / 2;
      for (let x = 0; x < xmax; x++) { const k = ik[kb + x], p = (y * w + x + xmin) * 3; r += cur[p] * k; g += cur[p + 1] * k; b += cur[p + 2] * k; }
      const o = (y * ow + xx) * 3; out[o] = clip8(r); out[o + 1] = clip8(g); out[o + 2] = clip8(b);
    }
    cur = out; cw = ow;
  }
  if (oh !== h) {
    const { ksize, ik, bounds } = coeffs(h, oh), out = new Uint8Array(cw * oh * 3);
    for (let yy = 0; yy < oh; yy++) {
      const ymin = bounds[yy * 2], ymax = bounds[yy * 2 + 1], kb = yy * ksize;
      for (let x = 0; x < cw; x++) {
        let r = ONE / 2, g = ONE / 2, b = ONE / 2;
        for (let y = 0; y < ymax; y++) { const k = ik[kb + y], p = ((y + ymin) * cw + x) * 3; r += cur[p] * k; g += cur[p + 1] * k; b += cur[p + 2] * k; }
        const o = (yy * cw + x) * 3; out[o] = clip8(r); out[o + 1] = clip8(g); out[o + 2] = clip8(b);
      }
    }
    cur = out;
  }
  return cur;
}
