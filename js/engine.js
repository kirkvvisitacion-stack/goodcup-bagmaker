// Bag Maker engine: rebuilds a Good Cup studio bag from a sticker with the data baked in Blender (pack.py).
// Same math as pack.py rebuild(), line for line, so the page and the Python reference give the same pixels.
import { resizeLanczos } from "./pilresize.js";

// ---------- bytes
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b, c = 0xffffffff) { for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return c; }
async function stream(bytes, ds) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer()); }
export const inflate = b => stream(b, new DecompressionStream("deflate"));   // zlib
export const deflate = b => stream(b, new CompressionStream("deflate"));
export const gunzip = b => stream(b, new DecompressionStream("gzip"));
const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
function cat(parts) { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; }

// ---------- PNG (8-bit gray, RGB, RGBA; no colour management, so plates are read exactly)
export async function decodePNG(b) {
  let p = 8, w, h, bd, ct, il; const idat = [];
  while (p < b.length) {
    const L = be32(b, p), t = String.fromCharCode(...b.subarray(p + 4, p + 8)), c = b.subarray(p + 8, p + 8 + L); p += 12 + L;
    if (t === "IHDR") { w = be32(c, 0); h = be32(c, 4); bd = c[8]; ct = c[9]; il = c[12]; }
    else if (t === "IDAT") idat.push(c); else if (t === "IEND") break;
  }
  if (bd !== 8 || il) throw new Error("PNG must be 8-bit, not interlaced");
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct], st = w * ch, raw = await inflate(cat(idat)), out = new Uint8Array(h * st);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (st + 1)], s = y * (st + 1) + 1, o = y * st, u = o - st;
    for (let x = 0; x < st; x++) {
      const a = x >= ch ? out[o + x - ch] : 0, bb = y ? out[u + x] : 0, c = (x >= ch && y) ? out[u + x - ch] : 0; let v = raw[s + x];
      if (ft === 1) v += a; else if (ft === 2) v += bb; else if (ft === 3) v += (a + bb) >> 1;
      else if (ft === 4) { const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c); }
      out[o + x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}
function chunk(type, data) {
  const t = new TextEncoder().encode(type), o = new Uint8Array(12 + data.length), dv = new DataView(o.buffer);
  dv.setUint32(0, data.length); o.set(t, 4); o.set(data, 8); dv.setUint32(8 + data.length, (crc32(o.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0); return o;
}
export async function encodePNG(img, icc) {
  const { w, h, ch, data } = img, st = w * ch, raw = new Uint8Array(h * (st + 1));
  for (let y = 0; y < h; y++) {           // Up filter (row 0 None), as compose.write_png does
    const o = y * (st + 1); raw[o] = y ? 2 : 0;
    for (let x = 0; x < st; x++) raw[o + 1 + x] = y ? (data[y * st + x] - data[(y - 1) * st + x]) & 255 : data[x];
  }
  const ih = new Uint8Array(13), dv = new DataView(ih.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ih[8] = 8; ih[9] = { 1: 0, 2: 4, 3: 2, 4: 6 }[ch];
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih)];
  if (icc && ch >= 3) parts.push(chunk("iCCP", cat([new TextEncoder().encode("sRGB"), new Uint8Array([0, 0]), await deflate(icc)])));
  parts.push(chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array(0))); return cat(parts);
}

// ---------- colour
const LIN8 = new Float64Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN8[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const INV = 1 / 2.4;
function srgb(l) { if (l < 0) l = 0; else if (l > 1) l = 1; return (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, INV) - 0.055) * 255; }
function rint(x) { const f = Math.floor(x), d = x - f; return d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 === 0 ? f : f + 1); }   // numpy round: half to even
const clip8 = v => v < 0 ? 0 : v > 255 ? 255 : v;
const F16 = (() => { const t = new Float64Array(65536); for (let i = 0; i < 65536; i++) { const s = i >> 15 ? -1 : 1, e = (i >> 10) & 31, m = i & 1023;
  t[i] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15); } return t; })();
const BH = t => 0.35875 + 0.48829 * Math.cos(2 * Math.PI * t) + 0.14128 * Math.cos(4 * Math.PI * t) + 0.01168 * Math.cos(6 * Math.PI * t);

// ---------- packed view (pack.py layout: bitmap, mx, my, jxx, jxy, jyx, jyy, A0..2, B0..2, cov, F, G)
export function parseView(raw, v, xyq) {
  const { w, h, n } = v, nb = (w * h + 7) >> 3; let p = 0; const bits = raw.subarray(0, nb); p += nb;
  const idx = new Int32Array(n); let k = 0;
  for (let i = 0; i < w * h; i++) if (bits[i >> 3] & (128 >> (i & 7))) idx[k++] = i;
  if (k !== n) throw new Error("bitmap count " + k + " != " + n);
  const u16 = () => { const a = new Float64Array(n), dv = new DataView(raw.buffer, raw.byteOffset + p, n * 2); for (let i = 0; i < n; i++) a[i] = dv.getUint16(i * 2, true); p += n * 2; return a; };
  const f16 = () => { const a = new Float64Array(n), dv = new DataView(raw.buffer, raw.byteOffset + p, n * 2); for (let i = 0; i < n; i++) a[i] = F16[dv.getUint16(i * 2, true)]; p += n * 2; return a; };
  const D = { idx, mx: u16().map(x => x / xyq), my: u16().map(x => x / xyq) };
  for (const key of ["jxx", "jxy", "jyx", "jyy", "A0", "A1", "A2", "B0", "B1", "B2"]) D[key] = f16();
  D.cov = new Float64Array(n); for (let i = 0; i < n; i++) D.cov[i] = raw[p + i] / 255; p += n;
  D.F = f16(); D.G = f16(); if (p !== raw.length) throw new Error("packed view size"); return D;
}

// ---------- the sticker as the bag's texture: Pillow Lanczos to the placement width, linear light
export function stickerTexture(rgb, sw, sh, meta) {
  const [nw, nh] = meta.tex, t8 = resizeLanczos(rgb, sw, sh, nw, nh), T = new Float64Array(t8.length);
  for (let i = 0; i < t8.length; i++) T[i] = LIN8[t8[i]];
  return { nw, nh, t8, T };
}

// ---------- one view: studio composite and cutout, sticker-zone pixels rebuilt on top of the baked plates
export function rebuildView(D, tex, meta, studio, bag) {
  const { nw, nh, T } = tex, [W, H] = meta.sticker_px, sub = meta.sub, fw = meta.fw, gain = meta.gain;
  const lg = meta.ground.map(g => LIN8[g]), o = [], wts = []; let ws = 0;
  for (let i = 0; i < sub; i++) o.push(((i + 0.5) / sub - 0.5) * fw);
  for (const oy of o) for (const ox of o) { const wt = BH(ox / fw) * BH(oy / fw); wts.push([ox, oy, wt]); }
  const n = D.idx.length, L = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    L[0] = L[1] = L[2] = 0; ws = 0;
    for (const [ox, oy, wt] of wts) {
      const sx = D.mx[i] + D.jxx[i] * ox + D.jxy[i] * oy, sy = D.my[i] + D.jyx[i] * ox + D.jyy[i] * oy;
      let u = sx * nw / W - 0.5, v = sy * nh / H - 0.5;
      u = u < 0 ? 0 : u > nw - 1 ? nw - 1 : u; v = v < 0 ? 0 : v > nh - 1 ? nh - 1 : v;
      const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(x0 + 1, nw - 1), y1 = Math.min(y0 + 1, nh - 1), fx = u - x0, fy = v - y0;
      const a = (y0 * nw + x0) * 3, b = (y0 * nw + x1) * 3, c = (y1 * nw + x0) * 3, d = (y1 * nw + x1) * 3;
      for (let k = 0; k < 3; k++) L[k] += wt * ((T[a + k] * (1 - fx) + T[b + k] * fx) * (1 - fy) + (T[c + k] * (1 - fx) + T[d + k] * fx) * fy);
      ws += wt;
    }
    const q = D.idx[i], cov = D.cov[i];
    for (let k = 0; k < 3; k++) {
      const A = k === 0 ? D.A0[i] : k === 1 ? D.A1[i] : D.A2[i], B = k === 0 ? D.B0[i] : k === 1 ? D.B1[i] : D.B2[i];
      const P = rint(srgb(A * (L[k] / ws) + B));                 // the raw Blender pixel, 8-bit
      const bl = LIN8[P] * gain;
      studio.data[q * 3 + k] = clip8(rint(srgb(bl * cov + lg[k] * D.F[i]) + D.G[i]));
      bag.data[q * 4 + k] = clip8(rint(srgb(bl)));
    }
  }
}

// ---------- the GLB front texture: the composed paper with the sticker pasted at the placement (bag_library.place)
export function frontTexture(plate, tex, meta) {
  const out = { ...plate, data: plate.data.slice() }, [x0, y0] = meta.placement, { nw, nh, t8 } = tex, ch = plate.ch;
  const hh = Math.min(nh, plate.h - y0), ww = Math.min(nw, plate.w - x0);
  for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) for (let k = 0; k < 3; k++) out.data[((y0 + y) * plate.w + x0 + x) * ch + k] = t8[(y * nw + x) * 3 + k];
  return out;
}

// ---------- swap the "99_front" image inside the GLB, every other byte kept
export function swapGLBImage(glb, name, png) {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength), jl = dv.getUint32(12, true);
  const J = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jl))), binStart = 20 + jl + 8, binLen = dv.getUint32(20 + jl, true);
  const bin = glb.subarray(binStart, binStart + binLen), im = J.images.findIndex(x => x.name === name);
  if (im < 0) throw new Error("GLB has no image " + name);
  const target = J.images[im].bufferView, order = J.bufferViews.map((v, i) => i).sort((a, b) => (J.bufferViews[a].byteOffset || 0) - (J.bufferViews[b].byteOffset || 0));
  const parts = []; let off = 0;
  for (const i of order) {
    const v = J.bufferViews[i], src = i === target ? png : bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    const pad = (4 - (off % 4)) % 4; if (pad) { parts.push(new Uint8Array(pad)); off += pad; }
    v.byteOffset = off; v.byteLength = src.length; parts.push(src); off += src.length;
  }
  const pad = (4 - (off % 4)) % 4; if (pad) { parts.push(new Uint8Array(pad)); off += pad; }
  J.buffers[0].byteLength = off;
  let js = new TextEncoder().encode(JSON.stringify(J)); const jp = (4 - (js.length % 4)) % 4; if (jp) js = cat([js, new Uint8Array(jp).fill(32)]);
  const head = new Uint8Array(12), hv = new DataView(head.buffer); hv.setUint32(0, 0x46546c67, true); hv.setUint32(4, 2, true); hv.setUint32(8, 12 + 8 + js.length + 8 + off, true);
  const c0 = new Uint8Array(8), c1 = new Uint8Array(8); new DataView(c0.buffer).setUint32(0, js.length, true); new DataView(c0.buffer).setUint32(4, 0x4e4f534a, true);
  new DataView(c1.buffer).setUint32(0, off, true); new DataView(c1.buffer).setUint32(4, 0x004e4942, true);
  return cat([head, c0, js, c1, ...parts]);
}

// ---------- zip (stored, UTF-8 names): PNG, GLB and PDF are already compressed
export function zip(files) {
  const enc = new TextEncoder(), local = [], central = []; let off = 0;
  const dosT = (12 << 11), dosD = ((2026 - 1980) << 9) | (11 << 5) | 19;
  for (const f of files) {
    const nm = enc.encode(f.name), crc = (crc32(f.bytes) ^ 0xffffffff) >>> 0, h = new Uint8Array(30), v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true); v.setUint16(10, dosT, true); v.setUint16(12, dosD, true);
    v.setUint32(14, crc, true); v.setUint32(18, f.bytes.length, true); v.setUint32(22, f.bytes.length, true); v.setUint16(26, nm.length, true);
    local.push(h, nm, f.bytes);
    const c = new Uint8Array(46), cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(12, dosT, true); cv.setUint16(14, dosD, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, f.bytes.length, true); cv.setUint32(24, f.bytes.length, true); cv.setUint16(28, nm.length, true); cv.setUint32(42, off, true);
    central.push(c, nm); off += 30 + nm.length + f.bytes.length;
  }
  const cd = cat(central), e = new Uint8Array(22), ev = new DataView(e.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cd.length, true); ev.setUint32(16, off, true);
  return new Blob([...local, cd, e], { type: "application/zip" });
}

// ---------- names (deliver_sides.py): the folder the team uploads to the NAS inbox
// a typed value becomes part of a file name: no folder breaks, no characters Windows or the NAS refuse
export function cleanName(s) { return String(s || "").replace(/[\/\\]/g, "-").replace(/[:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "").trim(); }
export function names(ctrl, name, size, stickerKind) {
  ctrl = cleanName(ctrl); name = cleanName(name);
  const base = `${ctrl} ${name} ${size}`, folder = `${ctrl} ${name} - ${size}`;
  return { folder, base, shots: { front: `01 ${base} - Front.png`, hero: `02 ${base} - Angled.png`, angle45: `03 ${base} - 45 Degrees.png`, back: `04 ${base} - Back.png` },
    glb: `06 Extras/${base} - 3D Model.glb`, cutout: `06 Extras/${base} - Cutout Front (no shadow).png`, shadow: `06 Extras/${base} - Shadow Only Front.png`,
    pdf: `07 ${base} - Sticker ${stickerKind}.pdf` };
}

// ---------- read the sticker's control number, name and line from the PDF title or file name (Canva export names)
export function parseTitle(s) {
  // Canva export names, also after a browser adds " (1)" or "-1" to a second download
  s = (s || "").replace(/\.pdf$/i, "").replace(/\s*\(\d+\)$/, "").replace(/(-[34]x3)-\d$/i, "$1").trim();
  const m = s.match(/^(\d{2}[-/]\d{2,3}|\d{2})\s*_\s*(.+?)\s*_\s*([A-Za-z]+)(?:-(\d+g))?-([34]x3)$/i);
  if (!m) return null;
  const code = m[3], uc = code.toUpperCase(), line = /AYR$/.test(uc) ? "ayr" : uc === "PH" ? "ph" : uc === "RARE" ? "rare" : "seasonal";
  return { ctrl: m[1].replace("/", "-"), name: m[2].replace(/-/g, " ").replace(/\s+/g, " ").trim(), code, line, weight: m[4] || null, kind: m[5].toLowerCase() };
}
