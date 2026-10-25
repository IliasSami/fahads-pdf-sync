// Build-time access to the knowledge-graph export (src/data/*.json). Runs only during `astro build`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tokenize } from "./search/normalize.ts";
import { BOOK_BY_OSIS } from "./search/refs.ts";

const dir = join(process.cwd(), "src", "data");
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));

export interface Deck { slug: string; title: string; order: number; count: number; pdf: string; pdfBytes: number; file: string }
export interface TextBlock { lang: string; role: string; text: string; osis?: string | string[] }
export interface Picture { type: string; description: string; subjects?: string[]; text_in_picture?: string; credit?: string | null; box: number[]; src?: string; w?: number; h?: number }
export interface Slide {
  deck: string; n: number; group: number; title: string; summary: string; kinds: string[]; text: TextBlock[];
  refs: { shown: string; osis: string[]; role: string }[];
  words: { lang: string; word: string; translit?: string; gloss?: string; strongs?: string; gematria?: { method: string; values?: number[]; total: number } }[];
  letters: { lang: string; letter: string; char: string; value?: number; meaning?: string }[];
  numbers: { value: number; note?: string }[]; pictures: Picture[]; keywords: string[];
  confidence: number; missing: boolean; entities: [number, number][]; hl: [string, number, number, number, number][];
  related: { slide: number; score: number; why: string[] }[];
}
export interface Entity {
  id: string; type: string; label: string; aliases: string[]; slides: number[]; weights: number[]; gloss: string[];
  translit: string[]; forms: string[]; rank: number; cluster?: string; url: string; lang?: string; strongs?: string;
  lemma?: string; definition?: string; char?: string; value?: number; gematria?: Record<string, number>;
  /** names in other languages and traditions: { he: [...], ar: [...], la: [KJV / other English], es, pt, fr, de, ru, el } */
  names?: Record<string, string[]>;
  /** one-line description (STEPBible TIPNR) */
  brief?: string;
}
export const LANGUAGE_NAMES: Record<string, string> = { he: "Hebrew", el: "Greek", ar: "Arabic", la: "Other English spellings (KJV, Latin)",
  es: "Spanish", pt: "Portuguese", fr: "French", de: "German", ru: "Russian" };
export interface PictureRow { id: string; slide: number; k: number; type: string; description: string; subjects: string[]; text: string; credit: string | null; src: string; w: number; h: number; box: number[]; same: string[] }

export const DECKS: Deck[] = load("decks.json");
export const SLIDES: Slide[] = load("slides.json");
export const ENTITIES: Entity[] = load("entities.json");
export const PICTURES: PictureRow[] = load("pictures.json");
export const VERSES: { verses: Record<string, number[]>; xrefs: Record<string, [string, number][]>; kjv: Record<string, string> } = load("verses.json");
export const SEARCH_VERSION: string = (() => { try { return load("search-version.json").hash; } catch { return "dev"; } })();

export const deckBySlug = new Map(DECKS.map((d) => [d.slug, d]));
export const slideIndex = new Map(SLIDES.map((s, i) => [`${s.deck}/${s.n}`, i]));
export const entityById = new Map(ENTITIES.map((e) => [e.id, e]));

export const pad = (n: number) => String(n).padStart(3, "0");
export const slideUrl = (s: Slide) => `/lessons/${s.deck}/${s.n}/`;
export const slideImg = (s: Slide, w: 320 | 960 | 1920 | 2560) => `/slides/${s.deck}/${pad(s.n)}-${w}.webp`;
export const deckSlides = (slug: string) => SLIDES.map((s, i) => [s, i] as const).filter(([s]) => s.deck === slug);
export const slideTitle = (s: Slide) => (s.missing ? `Slide ${s.n}` : s.title);

export const TYPE_NAMES: Record<string, [string, string]> = {
  person: ["Person", "People"], place: ["Place", "Places"], event: ["Event", "Events"], thing: ["Thing", "Things"],
  theme: ["Topic", "Topics"], group: ["Group", "Groups"], artist: ["Artist", "Artists"], word: ["Word", "Words"],
  letter: ["Letter", "Letters"], number: ["Number", "Numbers"], verse: ["Bible verse", "Bible verses"],
};

/** Entities connected to `e` (sharing slides), strongest first: [entity, sharedSlides]. */
const coCache = new Map<string, [Entity, number][]>();
export function connected(e: Entity, limit = 12): [Entity, number][] {
  if (coCache.has(e.id)) return coCache.get(e.id)!.slice(0, limit);
  const counts = new Map<number, number>();
  const mine = new Set(e.slides);
  for (const si of mine) {
    for (const [ei] of SLIDES[si].entities) counts.set(ei, (counts.get(ei) ?? 0) + 1);
  }
  const selfIdx = ENTITIES.indexOf(e);
  const N = SLIDES.length;
  const out = [...counts.entries()]
    .filter(([ei]) => ei !== selfIdx && ENTITIES[ei].type !== "verse")
    .map(([ei, c]) => {
      const o = ENTITIES[ei];
      const lift = (c / mine.size) / (o.slides.length / N);    // how much more often than chance
      return [o, c, c * Math.log(1 + lift)] as const;
    })
    .filter(([, c]) => c >= (mine.size >= 4 ? 2 : 1))
    .sort((a, b) => b[2] - a[2])
    .map(([o, c]) => [o, c] as [Entity, number]);
  coCache.set(e.id, out);
  return out.slice(0, limit);
}

/** Highlight words for the slide viewer: [normalised term, x0, y0, x1, y1]. */
export function highlightData(s: Slide): [string, number, number, number, number][] {
  const out: [string, number, number, number, number][] = [];
  for (const [t, ...b] of s.hl) {
    const seen = new Set<string>();
    for (const v of ocrReadings(t)) for (const tok of tokenize(v)) {
      if (tok.stop || seen.has(tok.term)) continue;
      seen.add(tok.term);
      out.push([tok.term, b[0], b[1], b[2], b[3]]);
    }
  }
  return out;
}

/** A word as read by OCR plus its likely intended spellings when decorative lettering was misread:
 *  "\loses" or "|\/|oses" → "Moses", "rn" → "m", a zero or one between letters → "o" / "l". */
function ocrReadings(t: string): string[] {
  const out = [t];
  const m = t.replace(/\\l|\|\\\/\||\/\\\/\\/g, "m");
  if (m !== t) out.push(m);
  if (/rn/.test(t)) out.push(t.replace(/rn/g, "m"));
  if (/\p{L}[01]\p{L}/u.test(t)) out.push(t.replace(/(\p{L})0(?=\p{L})/gu, "$1o").replace(/(\p{L})1(?=\p{L})/gu, "$1l"));
  return out;
}

export function bookSlug(osisBook: string) {
  return (BOOK_BY_OSIS.get(osisBook)?.name ?? osisBook).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
export function verseLabel(osis: string) {
  const [b, c, v] = osis.split(".");
  return `${BOOK_BY_OSIS.get(b)?.name ?? b} ${c}:${v}`;
}
export function verseUrl(osis: string) {
  const [b, c, v] = osis.split(".");
  return `/verses/${bookSlug(b)}/${c}/#v${v}`;
}

export function fmtBytes(n: number) {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`;
}
