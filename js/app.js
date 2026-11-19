import * as E from "./engine.js";
import * as pdfjs from "../vendor/pdfjs/pdf.min.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

const $ = id => document.getElementById(id);
const SIZE_LABEL = { 200: "200g", 500: "500g", 1000: "1kg", 100: "100g" };
const KIND_FOR = { 200: "3x3", 100: "3x3", 500: "4x3", 1000: "4x3" };
const VIEW_LABEL = { front: "Front", hero: "Angled", angle45: "45 Degrees", back: "Back" };
const S = { pdf: null, rgb: null, w: 0, h: 0, kind: null, title: null, size: null, sides: null, out: null, keys: [] };
window.BM = S;

function key(size, sides) { return size === 100 ? "100_black" : `${size}_${sides}`; }
function setStep(n) { for (let i = 1; i <= 5; i++) $("s" + i).classList.toggle("off", i > n); }
function note(el, kind, html) { $(el).innerHTML = html ? `<div class="note ${kind}">${html}</div>` : ""; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
let progTotal = 0, progDone = 0;
function status(t, frac) { $("status").textContent = t; if (frac != null) $("bar").style.width = Math.round(frac * 100) + "%"; }

async function fetchBytes(url, label) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${label}: ${r.status}`);
  const len = +r.headers.get("content-length") || 0, rd = r.body.getReader(), parts = []; let got = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; progDone += value.length;
    status(`Downloading the bag ${(progDone / 1e6).toFixed(0)} of ${(progTotal / 1e6).toFixed(0)} MB`, Math.min(0.85, 0.85 * progDone / Math.max(progTotal, 1))); }
  const o = new Uint8Array(got); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o;
}

// ---------- 1 sticker
async function loadPDF(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()); S.pdf = { name: file.name, bytes: bytes.slice() };
  const doc = await pdfjs.getDocument({ data: bytes, disableFontFace: true, standardFontDataUrl: new URL("../vendor/pdfjs/standard_fonts/", import.meta.url).href }).promise;
  const info = (await doc.getMetadata()).info || {}; S.title = info.Title || "";
  const page = await doc.getPage(1), [x0, y0, x1, y1] = page.view, wpt = x1 - x0, hpt = y1 - y0;
  S.kind = Math.abs(wpt - 216) < 1 && Math.abs(hpt - 216) < 1 ? "3x3" : Math.abs(wpt - 288) < 1 && Math.abs(hpt - 216) < 1 ? "4x3" : null;
  const vp = page.getViewport({ scale: 600 / 72, offsetX: -0.5, offsetY: -0.25 })   // pdftoppm pixel grid (fit on 26-112, held on 26-93/107/113/114: raster error -30%)
  , c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext("2d", { willReadFrequently: true, alpha: false }); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp, intent: "print", background: "rgb(255,255,255)" }).promise;   // print intent: no animation-frame scheduling (a background tab would stall), the print view pdftoppm renders
  const id = ctx.getImageData(0, 0, c.width, c.height).data, rgb = new Uint8Array(c.width * c.height * 3);
  for (let i = 0, j = 0; i < id.length; i += 4, j += 3) { rgb[j] = id[i]; rgb[j + 1] = id[i + 1]; rgb[j + 2] = id[i + 2]; }
  S.rgb = rgb; S.w = c.width; S.h = c.height; const url = c.toDataURL("image/png"); $("stkimg").src = url; $("stkbig").src = url;
  const t = E.parseTitle(S.title) || E.parseTitle(file.name);
  $("ctrl").value = t ? t.ctrl : ""; $("cname").value = t ? t.name : "";
  $("stk").hidden = false;
  const msgs = [];
  if (!S.kind) msgs.push(`This page is ${(wpt / 72).toFixed(2)} x ${(hpt / 72).toFixed(2)} in. The bags take a 3x3 or 4x3 sticker PDF.`);
  if (!t) msgs.push("Could not read the control number and name from the file. Type them in, exactly as on the sticker.");
  note("stknote", "warn", msgs.join("<br>"));
  // the bag from the sticker's line (Ken's side colours): PH yellow, seasonal white, all-year-round brown, Rare black
  let size = S.kind === "4x3" ? 500 : 200, sides = "white";
  if (t) { sides = t.line === "ph" ? "yellow" : t.line === "ayr" ? "brown" : t.line === "rare" ? "black" : "white"; if (t.line === "rare") size = 100; }
  pick(size, sides); setStep(S.kind ? 3 : 1);
}
// ---------- 2 bag
function pick(size, sides) {
  if (size === 100) sides = "black"; else if (sides === "black") sides = "yellow";
  S.size = size; S.sides = sides;
  for (const b of $("size").children) b.setAttribute("aria-pressed", +b.dataset.v === size);
  for (const b of $("sides").children) { b.setAttribute("aria-pressed", b.dataset.v === sides); b.disabled = size === 100 ? b.dataset.v !== "black" : b.dataset.v === "black"; }
  const k = key(size, sides), ready = S.keys.includes(k), msgs = [];
  if (!ready) msgs.push(`The ${SIZE_LABEL[size]} bag with ${sides} sides is not set up yet. Post the sticker in the team chat and ask for this bag type to be added.`);
  if (S.kind && KIND_FOR[size] !== S.kind) msgs.push(`The ${SIZE_LABEL[size]} bag takes the ${KIND_FOR[size]} sticker; this PDF is ${S.kind}.`);
  note("bagnote", "warn", msgs.join("<br>")); $("make").disabled = !!msgs.length || !S.rgb;
  S.out = null; setStep(S.rgb ? (msgs.length ? 2 : 3) : 1);
}
$("size").onclick = e => { const b = e.target.closest("button"); if (b && !b.disabled) pick(+b.dataset.v, S.sides); };
$("sides").onclick = e => { const b = e.target.closest("button"); if (b && !b.disabled) pick(S.size, b.dataset.v); };

function borderMean(rgb, w, h) {   // bag_library.border_mean: outer 1.5 % ring of the sticker
  const k = Math.max(3, Math.round(w * 0.015)); let s = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < k || y < k || x >= w - k || y >= h - k) { const i = (y * w + x) * 3; s += rgb[i] + rgb[i + 1] + rgb[i + 2]; n += 3; }
  return s / n;
}

// ---------- 3 make
async function make() {
  const ctrl = $("ctrl").value.trim(), cname = $("cname").value.trim();
  if (!ctrl || !cname) { status("Type the control number and the coffee name first."); return; }
  $("make").disabled = true; $("ok").checked = false; setStep(3);
  const k = key(S.size, S.sides), base = `data/${k}/`, t0 = performance.now();
  try {
    const meta = await (await fetch(base + "meta.json")).json(), tags = Object.keys(meta.views);
    progDone = 0; progTotal = meta.bytes_total || 0;
    if (meta.black && borderMean(S.rgb, S.w, S.h) < 100) note("bagnote", "warn", "This sticker has a dark edge. On a black bag Blender draws its cut edge softer, so post it in the team chat to be checked before it is used.");
    const icc = await fetchBytes("data/srgb.icc", "colour profile");
    const tex = E.stickerTexture(S.rgb, S.w, S.h, meta), N = E.names(ctrl, cname, SIZE_LABEL[S.size], S.kind), files = [], previews = {};
    for (const tag of tags) {
      const [sp, bp, bin] = await Promise.all([fetchBytes(base + tag + "_studio.png", tag), fetchBytes(base + tag + "_bag.png", tag), meta.views[tag].n ? fetchBytes(base + tag + ".pak", tag) : null]);
      let studioPNG = sp, bagPNG = bp;
      if (bin) {
        status(`Building the ${VIEW_LABEL[tag]} view`);
        const studio = await E.decodePNG(sp), bag = await E.decodePNG(bp), D = E.parseView(bin[0] === 0x1f && bin[1] === 0x8b ? await E.gunzip(bin) : bin, meta.views[tag], meta.xy_q);
        E.rebuildView(D, tex, meta, studio, bag); studioPNG = await E.encodePNG(studio, icc); bagPNG = await E.encodePNG(bag, icc);
        if (S.test) S.test[tag] = { studio, bag };
      }
      files.push({ name: `${N.folder}/${N.shots[tag]}`, bytes: studioPNG }); previews[tag] = URL.createObjectURL(new Blob([studioPNG], { type: "image/png" }));
      if (tag === "front") files.push({ name: `${N.folder}/${N.cutout}`, bytes: bagPNG });
    }
    files.push({ name: `${N.folder}/${N.shadow}`, bytes: await fetchBytes(base + "shadow_front.png", "shadow") });
    let glbURL = null;
    if (meta.glb && meta.front_tex) {
      status("Building the 3D model");
      const ft = E.frontTexture(await E.decodePNG(await fetchBytes(base + "front_tex.png", "texture")), tex, meta);
      const glb = E.swapGLBImage(await fetchBytes(base + "base.glb", "3D model"), "99_front", await E.encodePNG(ft));
      files.push({ name: `${N.folder}/${N.glb}`, bytes: glb }); glbURL = URL.createObjectURL(new Blob([glb], { type: "model/gltf-binary" }));
    }
    files.push({ name: `${N.folder}/${N.pdf}`, bytes: S.pdf.bytes });
    files.sort((a, b) => a.name.localeCompare(b.name));
    S.out = { files, folder: N.folder, base: N.base };
    $("front").src = previews.front;
    $("views").innerHTML = tags.map(t => `<figure><img src="${previews[t]}" alt="${VIEW_LABEL[t]}"><figcaption>${VIEW_LABEL[t]}</figcaption></figure>`).join("");
    if (glbURL) showSpin(glbURL);
    $("msg").value = `\u{1F6CD}️ New bag: ${N.base}\nFront, Angled, 45 Degrees, Back, the 3D model and the sticker PDF are in the folder.\n\n18 New Sticker Bags - Inbox / 2 Finished bags (pick up here) / ${N.folder}`;
    status(`Done in ${((performance.now() - t0) / 1000).toFixed(0)} s. Check the front against the sticker below.`, 1);
    setStep(4); $("s4").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { console.error(e); status("Something went wrong: " + e.message + ". Reload the page and try again; if it repeats, post a screenshot in the team chat."); }
  $("make").disabled = false;
}
$("make").onclick = make;
async function showSpin(url) {
  try {
    if (!customElements.get("model-viewer")) await import("https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js");
    $("spin").innerHTML = `<model-viewer src="${url}" camera-controls auto-rotate auto-rotate-delay="0" rotation-per-second="24deg" shadow-intensity="0.6" exposure="1" environment-image="neutral" alt="The bag in 3D, drag to turn it"></model-viewer>`;
  } catch (e) { $("spin").innerHTML = ""; }
}
// ---------- 4 check, 5 save
$("ok").onchange = () => setStep($("ok").checked && S.out ? 5 : 4);
$("dl").onclick = () => {
  if (!S.out) return; const a = document.createElement("a"); a.href = URL.createObjectURL(E.zip(S.out.files)); a.download = S.out.folder + ".zip"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
};
$("copy").onclick = async () => { try { await navigator.clipboard.writeText($("msg").value); $("copy").textContent = "Copied"; setTimeout(() => $("copy").textContent = "Copy message", 1500); } catch { $("msg").select(); } };

// ---------- file in
const drop = $("drop"), input = $("file");
drop.onclick = e => { if (e.target !== input) input.click(); };
drop.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } };
input.onchange = () => input.files[0] && start(input.files[0]);
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("on"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("on"); }));
drop.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) start(f); });
async function start(f) { status(""); $("bar").style.width = "0"; try { await loadPDF(f); } catch (e) { console.error(e); note("stknote", "warn", "Could not open this PDF: " + esc(e.message)); } }

// ---------- which bags are ready, and a test hook (?test) for the checks in tests/
(async () => {
  try { S.keys = (await (await fetch("data/index.json")).json()).keys; } catch { S.keys = []; }
  pick(200, "yellow"); setStep(1);
  const q = new URLSearchParams(location.search);
  if (q.has("test")) { S.test = {}; S.run = async (pdfUrl, size, sides) => { const b = await (await fetch(pdfUrl)).blob(); await loadPDF(new File([b], pdfUrl.split("/").pop())); if (size) pick(size, sides); await make(); return S.out ? S.out.files.map(f => [f.name, f.bytes.length]) : null; }; }
})();
