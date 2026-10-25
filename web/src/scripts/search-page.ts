// Search results page: runs the query in the worker and renders results, pictures, verses and topics.
import { search } from "../lib/search/client.ts";
import type { Panel, Result, SearchResponse } from "../lib/search/engine.ts";

const params = new URLSearchParams(location.search);
const q = (params.get("q") || "").trim();
const lesson = params.get("lesson") || undefined;
const tour = params.get("tour") === "1";
const carry = `?q=${encodeURIComponent(q)}${tour ? "&tour=1" : ""}`;
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const PAGE = 20;
let shown = 0;
let resp: SearchResponse | null = null;

function resultHtml(r: Result): string {
  const extra = (r.terms ?? []).length ? `&hl=${encodeURIComponent((r.terms ?? []).join(","))}` : "";
  const why = r.reason ? `&why=${encodeURIComponent(r.reason)}` : "";
  const link = `${r.url}${carry}${extra}${why}` + (r.pictureFirst && r.picture ? `#pic-${r.picture.k}` : "");
  const img = r.pictureFirst && r.picture
    ? `<img src="${r.picture.src}" width="${r.picture.w}" height="${r.picture.h}" alt="" loading="lazy" style="object-fit:contain">`
    : `<img src="${r.thumb}" width="320" height="180" alt="" loading="lazy">`;
  const more = r.more.length ? ` <span class="muted">(also slide${r.more.length > 1 ? "s" : ""} ${r.more.slice(0, 6).join(", ")}${r.more.length > 6 ? "…" : ""} — same slide built up step by step)</span>` : "";
  return `<a class="card result" href="${link}">${img}<div>
    <div class="title">${esc(r.title)}</div>
    <div class="where">${esc(r.deckTitle)} · Slide ${r.n}${more}</div>
    ${r.pictureFirst && r.picture ? `<p class="snip"><strong>Picture:</strong> ${esc(r.picture.description)}</p>` : `<p class="snip">${r.snippet}</p>`}
    ${r.why.length ? `<div class="why">✓ ${esc(r.why.join(" · "))}</div>` : ""}
  </div></a>`;
}

const LANG_CODE: Record<string, string> = { Hebrew: "he", Greek: "el", Arabic: "ar", Spanish: "es", Portuguese: "pt", French: "fr", German: "de", Russian: "ru" };
const isLatin = (s: string) => /^[\p{Script=Latin}\s'’.-]+$/u.test(s);

/** "At a glance" card: who/what the search is about, its names in other languages, and where it appears. */
function panelHtml(p: Panel): string {
  const latinNames = [...new Set(p.names.flatMap(([, l]) => l).filter(isLatin))].filter((n) => n.toLowerCase() !== p.label.toLowerCase());
  const nameRows = p.names.map(([lang, list]) =>
    `<div class="kname"><dt>${esc(lang)}</dt><dd>${[...new Set(list)].map((n) =>
      `<span lang="${isLatin(n) ? "en" : LANG_CODE[lang] ?? ""}" dir="auto">${esc(n)}</span>`).join(" · ")}</dd></div>`).join("");
  const asked = p.asked && p.asked.toLowerCase() !== p.label.toLowerCase()
    ? `<p class="kasked">“${esc(p.asked)}” is another name for <strong>${esc(p.label)}</strong>. The slides below are about ${esc(p.label)}.</p>` : "";
  return `<section class="kcard" aria-labelledby="kcard-title">
    <p class="kkind">${esc(p.type)} · found on ${p.count} slide${p.count === 1 ? "" : "s"}</p>
    <h2 id="kcard-title"><a href="${p.url}">${esc(p.label)}</a>${p.gloss ? ` <span class="kgloss">“${esc(p.gloss)}”</span>` : ""}</h2>
    ${asked}
    ${p.brief ? `<p class="kbrief">${esc(p.brief)}</p>` : ""}
    ${p.names.length ? `<details class="knames"><summary>Also known as: ${esc(latinNames.slice(0, 5).join(", ") || p.names[0][1].slice(0, 3).join(", "))}${latinNames.length > 5 || p.names.length > 1 ? " … <span class=\"more\">(show names in other languages)</span>" : ""}</summary><dl>${nameRows}</dl></details>` : ""}
    ${p.lessons.length ? `<p class="klabel">In ${p.lessons.length === 1 ? "this lesson" : `these ${p.lessons.length} lessons`}:</p><ul class="chips">${p.lessons.map((l) =>
      `<li><a class="chip" href="${l.url}">${esc(l.title)}<span class="n">${l.count} slide${l.count === 1 ? "" : "s"}</span></a></li>`).join("")}</ul>` : ""}
    ${p.related.length ? `<p class="klabel">Often studied together with:</p><ul class="chips">${p.related.map((r) =>
      `<li><a class="chip" href="${r.url}">${esc(r.label)}<span class="k">${esc(r.type)}</span></a></li>`).join("")}</ul>` : ""}
    <p class="kgo"><a class="btn" href="${p.url}">See everything about ${esc(p.label)} →</a></p>
  </section>`;
}

function picHtml(r: Result): string {
  const p = r.picture!;
  return `<a class="card pic-tile" href="${r.url}${carry}#pic-${p.k}">
    <span class="frame"><img src="${p.src}" width="${p.w}" height="${p.h}" alt="${esc(p.description)}" loading="lazy"></span>
    <span class="body"><strong>${esc(r.deckTitle)}, slide ${r.n}</strong>${esc(p.description)}</span></a>`;
}

function showMore() {
  if (!resp) return;
  const next = resp.results.slice(shown, shown + PAGE);
  $("results").insertAdjacentHTML("beforeend", next.map(resultHtml).join(""));
  shown += next.length;
  ($("more") as HTMLButtonElement).hidden = shown >= resp.results.length;
}

function selectTab(pics: boolean) {
  $("tab-all").setAttribute("aria-selected", String(!pics));
  $("tab-pics").setAttribute("aria-selected", String(pics));
  $("panel-all").hidden = pics;
  $("panel-pics").hidden = !pics;
  ($("more") as HTMLButtonElement).hidden = pics || !resp || shown >= resp.results.length;
}

async function run() {
  if (!q) return;
  $("tips").hidden = true;
  $("results-title").textContent = `Results for “${q}”`;
  $("status").innerHTML = `<span class="spinner" aria-hidden="true"></span> Searching all slides…`;
  try {
    resp = await search(q, { limit: 200, deck: lesson });
  } catch {
    $("status").textContent = "Sorry — the search could not load. Please check your internet connection and try again.";
    return;
  }
  const r = resp;
  const where = lesson ? " in this lesson" : "";
  $("status").innerHTML = r.total
    ? `Found <strong>${r.total}</strong> slide${r.total === 1 ? "" : "s"}${where}. Best matches are first.`
    : `No slides found${where}. Try fewer words, a different spelling, or one of the suggestions below.`;
  if (r.didYouMean) {
    $("did-you-mean").innerHTML = `<p class="notice">Did you mean <a href="/search/?q=${encodeURIComponent(r.didYouMean)}"><strong>${esc(r.didYouMean)}</strong></a>?</p>`;
  }
  if (r.refs.length) {
    $("refs").innerHTML = `<h2>Bible verses</h2><ul class="chips">${r.refs.map((x) =>
      `<li><a class="chip" href="${x.url}">${esc(x.label)}<span class="n">${x.count} slide${x.count === 1 ? "" : "s"}</span></a></li>`).join("")}</ul>`;
  }
  if (r.panel) $("kcard").innerHTML = panelHtml(r.panel);
  const others = r.entities.filter((e) => e.url !== r.panel?.url);
  if (others.length) {
    $("ents").innerHTML = `<h2>${r.panel ? "Also matching" : "People, words &amp; topics"}</h2><ul class="chips">${others.map((e) =>
      `<li><a class="chip" href="${e.url}">${esc(e.label)}<span class="k">${esc(e.type)}${e.gloss ? " · " + esc(e.gloss) : ""}</span><span class="n">${e.count}</span></a></li>`).join("")}</ul>`;
  }
  if (r.total) {
    $("tabs").hidden = false;
    ($("tab-pics") as HTMLButtonElement).textContent = `Pictures (${r.pictures.length})`;
    ($("tab-pics") as HTMLButtonElement).disabled = !r.pictures.length;
    $("results").insertAdjacentHTML("beforebegin", `<h2 class="visually-hidden">Slides</h2>`);
    showMore();
    $("pics").innerHTML = r.pictures.map(picHtml).join("");
    $("results").insertAdjacentHTML("beforebegin", tour
      ? `<div class="tour-box" role="note"><p class="tour-step">Tour · Step 2 of 3</p>
           <p><strong>Step 1 is done for you:</strong> we typed “${esc(q)}” into the white search box at the top of the page and pressed <strong>Search</strong>. You can type anything there, any time.</p>
           <p>Below are the slides that match <strong>“${esc(q)}”</strong>. The best matches are at the top, and each one shows the lesson, the slide number and why it matched.</p>
           <p><strong>👉 Now tap the first result</strong> (the one with the yellow border) to open that slide.</p></div>`
      : `<p class="helper">👉 Tap a result to open the slide. Your search words will be marked in yellow.</p>`);
    if (tour) $("results").querySelector(".result")?.classList.add("tour-target");
    const wantsPics = /\b(picture|pictures|image|photo|painting|engraving|drawing|map|art)\b/i.test(q) && r.pictures.length;
    selectTab(!!wantsPics);
  } else {
    $("tips").hidden = false;
  }
}

$("more").addEventListener("click", showMore);
$("tab-all").addEventListener("click", () => selectTab(false));
$("tab-pics").addEventListener("click", () => selectTab(true));
run();
