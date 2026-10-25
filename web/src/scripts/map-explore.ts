// "Map of ideas" explorer: an expandable / collapsible mind map in columns.
// Column 1 lists the groups. Tapping a group opens a column of its ideas; tapping an idea opens a column with a short
// card about it (its best slides) and what it is connected to — and so on, as far as you like. Lines join each
// chosen name to the names it opened. Tapping a chosen name again closes everything after it.
// The path is kept in the address (?path=g2.n15), so the browser's Back button steps back one tap at a time.
// On a phone only the newest column is shown, with a Back button and a "where you are" trail.

type Node = [string, string, string, number, number, number, [number, number][], number[], string, string];
interface Group { name: string; icon: string; about: string; color: string; members: number[] }
interface Data { groups: Group[]; nodes: Node[]; slides: [number, number, string][]; decks: [string, string][] }
type Key = string;   // "g3" (group) or "n120" (idea)

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const TYPE: Record<string, string> = { person: "Person", place: "Place", event: "Event", thing: "Thing", theme: "Topic", group: "Group",
  artist: "Artist", word: "Word", letter: "Letter" };
const FIRST = 12, MORE = 40;
const root = $("mm");
const colsEl = $("mm-cols");
let D: Data;
let path: Key[] = [];
const expanded = new Set<string>();   // columns where "show more" was pressed (by the key that opened them)

const nodeOf = (k: Key) => D.nodes[+k.slice(1)];
const nameOf = (k: Key) => (k[0] === "g" ? D.groups[+k.slice(1)].name : nodeOf(k)[0]);
const colorOf = (k: Key) => (k[0] === "g" ? D.groups[+k.slice(1)].color : D.groups[nodeOf(k)[5]]?.color ?? "#4a4a4a");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const langAttr = (n: Node) => (n[8] ? ` lang="${n[8]}"` : "");

function itemHtml(col: number, key: Key, label: string, meta: string, icon = "", lang = "", weight = 0): string {
  const open = path[col] === key;
  return `<li><button type="button" class="mm-item${open ? " is-open" : ""}" data-col="${col}" data-key="${key}" aria-expanded="${open}"
    style="--c:${colorOf(key)}" ${weight ? `data-w="${weight}"` : ""}>
    ${icon ? `<span class="mm-icon" aria-hidden="true">${icon}</span>` : `<span class="mm-dot" aria-hidden="true"></span>`}
    <span class="mm-text"><span class="mm-label"${lang} dir="auto">${esc(label)}</span><span class="mm-meta">${esc(meta)}</span></span>
    <span class="mm-arrow" aria-hidden="true">${open ? "◀" : "▶"}</span></button></li>`;
}

function groupsColumn(): string {
  return `<section class="mm-col" data-col="0" aria-labelledby="mm-h0"><h2 id="mm-h0" class="mm-head">Groups of related ideas</h2>
    <ul class="mm-list">${D.groups.map((g, i) => itemHtml(0, `g${i}`, g.name, g.about, g.icon)).join("")}</ul></section>`;
}

function slidesHtml(n: Node): string {
  return `<div class="mm-slides">${n[7].slice(0, 4).map((si) => {
    const [dk, num, title] = D.slides[si];
    const slug = D.decks[dk][0];
    return `<a href="/lessons/${slug}/${num}/" title="${esc(D.decks[dk][1])}, slide ${num}: ${esc(title)}">
      <img src="/slides/${slug}/${String(num).padStart(3, "0")}-320.webp" width="320" height="180" alt="" loading="lazy">
      <span>${esc(title)}</span></a>`;
  }).join("")}</div>`;
}

/** The column opened by path[col - 1]. */
function childColumn(col: number): string {
  const key = path[col - 1];
  const back = `<button type="button" class="mm-back" data-back="${col - 1}">◀ Back</button>`;
  const id = `mm-h${col}`;
  if (key[0] === "g") {
    const g = D.groups[+key.slice(1)];
    const all = g.members;
    const shown = all.slice(0, expanded.has(key) ? MORE : FIRST);
    return `<section class="mm-col" data-col="${col}" aria-labelledby="${id}">${back}
      <div class="mm-card" style="--c:${g.color}"><h2 id="${id}" class="mm-title"><span aria-hidden="true">${g.icon}</span> ${esc(g.name)}</h2>
        <p>${esc(g.about)}</p></div>
      <h3 class="mm-sub">The ${shown.length < all.length ? `${shown.length} most-taught of ${all.length}` : plural(all.length, "")} ideas in this group:</h3>
      <ul class="mm-list">${shown.map((ni) => { const n = D.nodes[ni];
        return itemHtml(col, `n${ni}`, n[0], `${TYPE[n[1]] ?? "Topic"} · ${plural(n[3], "slide")}`, "", langAttr(n)); }).join("")}</ul>
      ${all.length > shown.length ? `<button type="button" class="btn secondary mm-more" data-more="${key}">Show ${Math.min(MORE, all.length) - shown.length} more</button>` : ""}
    </section>`;
  }
  const ni = +key.slice(1);
  const n = D.nodes[ni];
  const inPath = new Set(path.slice(0, col));
  const nb = n[6].filter(([o]) => !inPath.has(`n${o}`));
  const shown = nb.slice(0, expanded.has(key) ? 16 : 8);
  const max = Math.max(1, ...shown.map(([, c]) => c));
  const g = D.groups[n[5]];
  return `<section class="mm-col" data-col="${col}" aria-labelledby="${id}">${back}
    <div class="mm-card" style="--c:${colorOf(key)}">
      <p class="mm-kind">${TYPE[n[1]] ?? "Topic"}${g ? ` · in “${esc(g.name)}”` : ""}</p>
      <h2 id="${id}" class="mm-title"${langAttr(n)} dir="auto">${esc(n[0])}</h2>
      <p>Found on <strong>${plural(n[3], "slide")}</strong> in ${plural(n[4], "lesson")}.</p>
      ${slidesHtml(n)}
      <p class="mm-actions"><a class="btn" href="${n[2]}">Open all ${plural(n[3], "slide")} →</a></p>
    </div>
    ${shown.length ? `<h3 class="mm-sub">Connected to ${esc(n[0])}:</h3>
    <ul class="mm-list">${shown.map(([o, c]) => { const m = D.nodes[o];
      return itemHtml(col, `n${o}`, m[0], `${TYPE[m[1]] ?? "Topic"} · together on ${plural(c, "slide")}`, "", langAttr(m), 1 + Math.round((4 * c) / max)); }).join("")}</ul>
    ${nb.length > shown.length ? `<button type="button" class="btn secondary mm-more" data-more="${key}">Show more connections</button>` : ""}`
    : `<p class="muted">No further connections.</p>`}
  </section>`;
}

function trailHtml(): string {
  if (!path.length) return "";
  const crumbs = [`<button type="button" data-back="0">All groups</button>`,
    ...path.map((k, i) => i === path.length - 1 ? `<span aria-current="location">${esc(nameOf(k))}</span>`
      : `<button type="button" data-back="${i + 1}">${esc(nameOf(k))}</button>`)];
  return `<span class="mm-trail-label">You are here:</span> ${crumbs.join(` <span aria-hidden="true">›</span> `)}`;
}

function drawLines() {
  const svg = $("mm-lines") as unknown as SVGSVGElement;
  if (getComputedStyle(svg).display === "none") return;
  const base = colsEl.getBoundingClientRect();
  const W = colsEl.scrollWidth, H = colsEl.scrollHeight;
  svg.setAttribute("width", String(W));
  svg.setAttribute("height", String(H));
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const pt = (r: DOMRect, side: "l" | "r") => [(side === "r" ? r.right : r.left) - base.left + colsEl.scrollLeft, r.top + r.height / 2 - base.top + colsEl.scrollTop];
  let out = "";
  const cols = [...colsEl.querySelectorAll<HTMLElement>(".mm-col")];
  cols.forEach((col, k) => {
    const open = col.querySelector<HTMLElement>(".mm-item.is-open");
    const next = cols[k + 1];
    if (!open || !next) return;
    const [x1, y1] = pt(open.getBoundingClientRect(), "r");
    const color = getComputedStyle(open).getPropertyValue("--c") || "#9aa9c4";
    const card = next.querySelector<HTMLElement>(".mm-card");
    const targets: [HTMLElement, number][] = [];
    if (card) targets.push([card, 5]);
    next.querySelectorAll<HTMLElement>(".mm-list .mm-item").forEach((b) => targets.push([b, +(b.dataset.w || 2)]));
    for (const [t, w] of targets) {
      const r = t.getBoundingClientRect();
      const [x2, y2] = t === card ? pt(r, "l").map((v, i) => (i === 1 ? Math.min(v, r.top - base.top + colsEl.scrollTop + 40) : v)) : pt(r, "l");
      const mx = (x1 + x2) / 2;
      out += `<path d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" stroke="${color.trim()}" stroke-width="${t === card ? 4 : w}" />`;
    }
  });
  svg.innerHTML = out;
}

function render(scrollTo = true) {
  const parts = [groupsColumn()];
  for (let c = 1; c <= path.length; c++) parts.push(childColumn(c));
  colsEl.innerHTML = `<svg id="mm-lines" class="mm-lines" aria-hidden="true"></svg>` + parts.join("");
  const cols = colsEl.querySelectorAll(".mm-col");
  cols[cols.length - 1].classList.add("is-last");
  const trail = $("mm-trail");
  trail.innerHTML = trailHtml();
  trail.hidden = !path.length;
  root.classList.toggle("has-path", path.length > 0);
  requestAnimationFrame(() => {
    drawLines();
    if (scrollTo) {
      const last = cols[cols.length - 1] as HTMLElement;
      colsEl.scrollTo({ left: Math.max(0, last.offsetLeft + last.offsetWidth - colsEl.clientWidth + 8), behavior: "smooth" });
      if (window.matchMedia("(max-width: 760px)").matches && path.length) $("mm-trail").scrollIntoView({ block: "start" });
    }
  });
  const last = path[path.length - 1];
  $("mm-status").textContent = last ? `Opened ${nameOf(last)}. ${last[0] === "g" ? "Its ideas" : "What it is connected to"} are in the new column.` : "Showing all groups.";
}

function setPath(p: Key[], push = true) {
  path = p;
  const url = new URL(location.href);
  url.searchParams.delete("focus");
  if (p.length) url.searchParams.set("path", p.join(".")); else url.searchParams.delete("path");
  if (push) history.pushState({ path: p }, "", url); else history.replaceState({ path: p }, "", url);
  render();
}

function fromUrl(): Key[] {
  const q = new URLSearchParams(location.search);
  const focus = q.get("focus");
  if (focus) {
    const ni = D.nodes.findIndex((n) => n[9] === focus);
    if (ni >= 0) return D.nodes[ni][5] >= 0 ? [`g${D.nodes[ni][5]}`, `n${ni}`] : [`n${ni}`];
  }
  return (q.get("path") || "").split(".").filter((k) => /^[gn]\d+$/.test(k) && (k[0] === "g" ? D.groups[+k.slice(1)] : D.nodes[+k.slice(1)]));
}

colsEl.addEventListener("click", (ev) => {
  if (!D) return;
  const t = ev.target as HTMLElement;
  const item = t.closest<HTMLButtonElement>(".mm-item");
  const more = t.closest<HTMLButtonElement>(".mm-more");
  const back = t.closest<HTMLButtonElement>(".mm-back");
  if (item) {
    const col = +(item.dataset.col ?? 0), key = item.dataset.key ?? `g${item.dataset.group}`;
    setPath(path[col] === key ? path.slice(0, col) : [...path.slice(0, col), key]);
    const again = colsEl.querySelector<HTMLButtonElement>(`.mm-item[data-col="${col}"][data-key="${key}"]`);
    if (again && !window.matchMedia("(max-width: 760px)").matches) again.focus({ preventScroll: true });
  } else if (more) {
    expanded.add(more.dataset.more!);
    render(false);
  } else if (back) {
    setPath(path.slice(0, +back.dataset.back!));
  }
});
$("mm-trail").addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-back]");
  if (b) setPath(path.slice(0, +b.dataset.back!));
});
window.addEventListener("popstate", () => { if (D) { path = fromUrl(); render(); } });
let resizeTimer = 0;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = window.setTimeout(drawLines, 120); });
colsEl.addEventListener("load", () => drawLines(), true);   // thumbnails change the column heights

fetch(root.dataset.src!).then((r) => r.json()).then((d: Data) => {
  D = d;
  path = fromUrl();
  history.replaceState({ path }, "", location.href);
  render(path.length > 0);
}).catch(() => {
  $("mm-status").textContent = "";
  colsEl.insertAdjacentHTML("beforebegin", `<p class="notice">Sorry — the map could not load. Please check your internet connection, or use the <a href="/map/outline/">Outline</a>.</p>`);
});
