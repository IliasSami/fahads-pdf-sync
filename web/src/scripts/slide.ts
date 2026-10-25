// Slide page: highlight searched words on the slide image, keyboard/swipe navigation, zoom, print, email.
import { tokenize, translitKey, hebrewVariants, editDistance, scriptOf } from "../lib/search/normalize.ts";

type WordBox = [string, number, number, number, number];
const data = JSON.parse(document.getElementById("hl-data")?.textContent || '{"words":[],"pics":[]}') as {
  words: WordBox[]; pics: [number, number, number, number, number][];
};
const layer = document.getElementById("hl-layer")!;
const params = new URLSearchParams(location.search);
const q = params.get("q") || "";
const extra = (params.get("hl") || "").split(",").map((t) => t.trim()).filter(Boolean);   // matched terms sent by the search page
const why = params.get("why") || "";

function box(cls: string, b: number[], pad = 0.004) {
  const el = document.createElement("span");
  if (cls) el.className = cls;
  el.style.left = `${(b[0] - pad) * 100}%`;
  el.style.top = `${(b[1] - pad) * 100}%`;
  el.style.width = `${(b[2] - b[0] + 2 * pad) * 100}%`;
  el.style.height = `${(b[3] - b[1] + 2 * pad) * 100}%`;
  layer.appendChild(el);
}

/** Does a word on the slide match one of the searched terms? Exact, word-start, Hebrew prefixes, sound-alike, or one misread letter. */
function makeMatcher(terms: string[]) {
  const keys = new Set(terms.filter((t) => scriptOf(t) === "latin" && t.length >= 3).map((t) => translitKey(t)));
  return (w: string): boolean => {
    if (!w || w.length < 2) return false;
    for (const t of terms) {
      if (w === t) return true;
      if (t.length >= 4 && w.startsWith(t)) return true;
      if (w.length >= 4 && t.startsWith(w) && w.length >= t.length - 2) return true;
      if (scriptOf(t) === "hebrew" && (hebrewVariants(w).includes(t) || hebrewVariants(t).includes(w))) return true;
      if (t.length >= 5 && Math.abs(t.length - w.length) <= 1 && scriptOf(t) === scriptOf(w) && editDistance(t, w, 1) <= 1) return true;
    }
    return scriptOf(w) === "latin" && w.length >= 3 && keys.has(translitKey(w));
  };
}

/** Words split into coloured pieces ("Abra" + "ham") are joined back when they sit side by side on a line. */
function joinedFragments(words: WordBox[]): WordBox[] {
  const sorted = words.slice().sort((a, b) => (a[2] + a[4]) / 2 - (b[2] + b[4]) / 2 || a[1] - b[1]);
  const out: WordBox[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let cur = sorted[i];
    let textLR = cur[0], textRL = cur[0];
    for (let j = i + 1; j < Math.min(sorted.length, i + 4); j++) {
      const nx = sorted[j];
      const h = cur[4] - cur[2];
      const sameLine = Math.abs((nx[2] + nx[4]) / 2 - (cur[2] + cur[4]) / 2) < h * 0.5;
      const gap = nx[1] - cur[3];
      if (!sameLine || gap > h * 0.35 || gap < -h * 0.3) break;
      textLR += nx[0]; textRL = nx[0] + textRL;
      cur = [textLR, Math.min(cur[1], nx[1]), Math.min(cur[2], nx[2]), Math.max(cur[3], nx[3]), Math.max(cur[4], nx[4])];
      out.push(cur, [textRL, cur[1], cur[2], cur[3], cur[4]]);
    }
  }
  return out;
}

let hits = 0;
let matchWord: ((w: string) => boolean) | null = null;
if (q || extra.length) {
  const terms = [...new Set([...tokenize(q).filter((t) => !t.stop && t.term.length >= 2).map((t) => t.term), ...extra])];
  matchWord = makeMatcher(terms);
  const marked: number[][] = [];
  const mark = (b: number[]) => {
    if (marked.some((m) => Math.abs(m[0] - b[0]) < 0.004 && Math.abs(m[1] - b[1]) < 0.004)) return;
    marked.push(b);
    box("", b);
    hits++;
  };
  for (const [term, ...b] of data.words) if (matchWord(term)) mark(b);
  for (const [term, ...b] of joinedFragments(data.words)) if (matchWord(tokenize(term)[0]?.term ?? term)) mark(b);
  if (hits) document.getElementById("stage")?.setAttribute("data-highlights", String(hits));
}

// mark the same words in the "Read as text" view
let textHits = 0;
if (matchWord) {
  const root = document.querySelector("#text .transcript");
  const walker = root ? document.createTreeWalker(root, NodeFilter.SHOW_TEXT) : null;
  const nodes: Text[] = [];
  while (walker?.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const parts = node.data.split(/([\p{L}\p{M}\p{N}'’]+)/u);
    if (!parts.some((p) => /\p{L}/u.test(p) && matchWord!(tokenize(p)[0]?.term ?? ""))) continue;
    const frag = document.createDocumentFragment();
    for (const p of parts) {
      if (/\p{L}/u.test(p) && matchWord(tokenize(p)[0]?.term ?? "")) {
        const m = document.createElement("mark");
        m.textContent = p;
        frag.appendChild(m);
        textHits++;
      } else frag.appendChild(document.createTextNode(p));
    }
    node.replaceWith(frag);
  }
}

// ---- outline a picture when arriving from picture search (#pic-2)
const m = location.hash.match(/^#pic-(\d+)$/);
if (m) {
  const p = data.pics.find((x) => x[0] === +m[1]);
  if (p) box("pic", p.slice(1), 0.006);
}

// ---- guidance: back to search results, and the guided tour's last step
const guide = document.getElementById("slide-guide");
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
if (guide && q) {
  const back = `<p class="toolbar" style="margin:0 0 14px"><a class="btn secondary" href="/search/?q=${encodeURIComponent(q)}">◀ Back to your search results for “${esc(q)}”</a></p>`;
  const tourBox = params.get("tour") === "1" ? `<div class="tour-box" role="note"><p class="tour-step">Tour · Step 3 of 3</p>
      <p>This is the slide, <strong>exactly as it appears in the lesson</strong>. The words you searched for are marked in <mark>yellow</mark>.</p>
      <p>Use the big <strong>Next slide ▶</strong> and <strong>◀ Previous</strong> buttons below to move through the lesson, and <strong>Zoom in</strong> to see it bigger.
      Further down, <strong>Connected slides</strong> shows related teaching from other lessons.</p>
      <p class="toolbar" style="margin:0"><a class="btn" href="#rel-h">Show me the connected slides</a><a class="btn secondary" href="${location.pathname}">Finish the tour</a></p></div>` : "";
  const status = hits
    ? `<p class="hl-status ok">✓ Your search words are marked in <mark>yellow</mark> in ${hits} place${hits === 1 ? "" : "s"} on the slide below.</p>`
    : textHits
      ? `<p class="hl-status ok">✓ Your search words are on this slide, but in lettering or artwork whose exact spot can't be marked.
          They are marked in <mark>yellow</mark> in the <a href="#text" data-open-text>text of the slide</a> below the picture.</p>`
      : `<p class="hl-status">ⓘ Your search words are not written on this slide itself.${why ? ` It was found because it ${esc(why)}.` : " It was found because it is about the same topic."} <a href="#text" data-open-text>Read the slide as text</a>.</p>`;
  guide.innerHTML = tourBox + back + status;
  guide.querySelectorAll("[data-open-text]").forEach((a) => a.addEventListener("click", () => {
    const d = document.getElementById("text") as HTMLDetailsElement | null;
    if (d) d.open = true;
  }));
  if (!hits && textHits) (document.getElementById("text") as HTMLDetailsElement | null)?.setAttribute("open", "");
}

// ---- carry the search words along when moving to the previous/next slide
if (q) {
  document.querySelectorAll<HTMLAnchorElement>(".slide-nav a[rel], .steps-note a").forEach((a) => {
    const u = new URL(a.href);
    u.searchParams.set("q", q);
    a.href = u.toString();
  });
}

// ---- keyboard + swipe
document.addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey || (e.target as HTMLElement).closest("input, textarea, select")) return;
  if (!document.getElementById("zoom")!.hidden) return;
  const a = document.querySelector<HTMLAnchorElement>(`.slide-nav a[data-key="${e.key}"]`);
  if (a) { e.preventDefault(); location.href = a.href; }
});
let sx = 0, sy = 0;
const stage = document.getElementById("stage")!;
stage.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
stage.addEventListener("touchend", (e) => {
  const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
  if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) {
    const a = document.querySelector<HTMLAnchorElement>(`.slide-nav a[data-key="${dx < 0 ? "ArrowRight" : "ArrowLeft"}"]`);
    if (a) location.href = a.href;
  }
});

// ---- print & email (email gets the full address of this slide)
document.getElementById("print-btn")?.addEventListener("click", () => {
  (document.getElementById("text") as HTMLDetailsElement).open = true;
  window.print();
});
const email = document.getElementById("email-btn") as HTMLAnchorElement | null;
if (email) email.href = email.href.replace(/body=([^&]*)/, (_, b) => `body=${b}${encodeURIComponent(location.origin + location.pathname)}`);

// ---- zoom viewer: buttons, mouse wheel, drag, pinch
const zoom = document.getElementById("zoom")!;
const zarea = document.getElementById("zarea")!;
const zimg = document.getElementById("zimg") as HTMLImageElement;
const src = (document.getElementById("slide-img") as HTMLImageElement).dataset.zoom!;
let scale = 1, tx = 0, ty = 0, fit = 1;
const apply = () => { zimg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
function fitToScreen() {
  const r = zarea.getBoundingClientRect();
  fit = Math.min(r.width / 2560, r.height / 1440);
  scale = fit;
  tx = -1280 * scale; ty = -720 * scale;
  apply();
}
function zoomAt(f: number, cx?: number, cy?: number) {
  const r = zarea.getBoundingClientRect();
  const px = (cx ?? r.left + r.width / 2) - (r.left + r.width / 2);
  const py = (cy ?? r.top + r.height / 2) - (r.top + r.height / 2);
  const ns = Math.min(Math.max(scale * f, fit * 0.8), fit * 8);
  tx = px - ((px - tx) * ns) / scale;
  ty = py - ((py - ty) * ns) / scale;
  scale = ns;
  apply();
}
let lastFocus: HTMLElement | null = null;
function openZoom() {
  lastFocus = document.activeElement as HTMLElement;
  if (!zimg.src) zimg.src = src;
  zoom.hidden = false;
  document.body.style.overflow = "hidden";
  if (zimg.complete) fitToScreen(); else zimg.onload = fitToScreen;
  zoom.querySelector<HTMLButtonElement>('[data-z="close"]')!.focus();
}
function closeZoom() {
  zoom.hidden = true;
  document.body.style.overflow = "";
  lastFocus?.focus();
}
document.getElementById("zoom-btn")?.addEventListener("click", openZoom);
document.getElementById("slide-img")?.addEventListener("click", openZoom);
zoom.addEventListener("click", (e) => {
  const z = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-z]")?.dataset.z;
  if (z === "in") zoomAt(1.5); else if (z === "out") zoomAt(1 / 1.5); else if (z === "fit") fitToScreen(); else if (z === "close") closeZoom();
});
document.addEventListener("keydown", (e) => {
  if (zoom.hidden) return;
  if (e.key === "Escape") closeZoom();
  else if (e.key === "+" || e.key === "=") zoomAt(1.25);
  else if (e.key === "-") zoomAt(0.8);
});
zarea.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
const pointers = new Map<number, { x: number; y: number }>();
let pinch = 0;
zarea.addEventListener("pointerdown", (e) => { zarea.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
zarea.addEventListener("pointermove", (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) { tx += e.clientX - prev.x; ty += e.clientY - prev.y; apply(); }
  else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) zoomAt(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
    pinch = d;
  }
});
const up = (e: PointerEvent) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; };
zarea.addEventListener("pointerup", up);
zarea.addEventListener("pointercancel", up);
window.addEventListener("resize", () => { if (!zoom.hidden) fitToScreen(); });
