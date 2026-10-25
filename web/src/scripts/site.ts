// Runs on every page: menu, text size, and the search box with live suggestions.
import { suggest, warmUp } from "../lib/search/client.ts";

// ---- menu (small screens)
const menuBtn = document.querySelector<HTMLButtonElement>(".menu-btn");
const nav = document.getElementById("site-nav");
menuBtn?.addEventListener("click", () => {
  const open = nav!.classList.toggle("open");
  menuBtn.setAttribute("aria-expanded", String(open));
});

// ---- text size
const sizeBtns = document.querySelectorAll<HTMLButtonElement>(".textsize button");
const applySize = (s: string) => {
  if (s) document.documentElement.dataset.size = s; else delete document.documentElement.dataset.size;
  sizeBtns.forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.size ?? "") === s)));
  try { localStorage.setItem("textSize", s); } catch { /* private mode */ }
};
sizeBtns.forEach((b) => b.addEventListener("click", () => applySize(b.dataset.size ?? "")));
applySize(document.documentElement.dataset.size ?? "");

// ---- search suggestions
const input = document.getElementById("q") as HTMLInputElement | null;
const list = document.getElementById("suggest") as HTMLUListElement | null;
let active = -1;
let timer = 0;
let seq = 0;

function close() {
  if (!list || !input) return;
  list.hidden = true;
  list.innerHTML = "";
  input.setAttribute("aria-expanded", "false");
  active = -1;
}

function setActive(i: number) {
  const items = list!.querySelectorAll("a");
  items.forEach((a, k) => a.setAttribute("aria-selected", String(k === i)));
  active = i;
  if (i >= 0) input!.setAttribute("aria-activedescendant", items[i].id);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

if (input && location.pathname.startsWith("/search")) input.value = new URLSearchParams(location.search).get("q") ?? "";

if (input && list) {
  input.addEventListener("focus", () => warmUp(), { once: true });
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = window.setTimeout(async () => {
      const my = ++seq;
      const items = await suggest(q).catch(() => []);
      if (my !== seq) return;
      if (!items.length) return close();
      list.innerHTML = items.map((s, i) =>
        `<li role="presentation"><a id="sg-${i}" role="option" href="${s.url}"><strong>${esc(s.label)}</strong><span>${esc(s.hint)}</span></a></li>`).join("");
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      active = -1;
    }, 120);
  });
  input.addEventListener("keydown", (e) => {
    const n = list.querySelectorAll("a").length;
    if (list.hidden || !n) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((active + 1) % n); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((active - 1 + n) % n); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); (list.querySelectorAll("a")[active] as HTMLAnchorElement).click(); }
    else if (e.key === "Escape") close();
  });
  document.addEventListener("click", (e) => { if (!(e.target as Element).closest(".search-form")) close(); });
}
