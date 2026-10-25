// Builds the in-browser search engine's data from the knowledge-graph export (src/data/*.json).
// Output: public/data/search.json  (one file, fetched once and cached; ~brotli-compressed by Cloudflare)
//
// Index design: an impact-ordered inverted index. For every (term, slide) pair the BM25F score is
// precomputed (field-weighted, length-normalised, IDF-scaled) and quantised to 0..255, together with
// a bitmask of the fields the term occurs in (used to explain matches: "in the title", "in a picture"...).
// Query time is then a sum of small integer lists — fast even on old tablets.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tokenize, translitKey, hebrewVariants, arabicVariants, latinFold } from "../src/lib/search/normalize.ts";

const DATA = new URL("../src/data/", import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, DATA), "utf8"));
const slides = read("slides.json");
const entities = read("entities.json");
const decks = read("decks.json");
const verses = read("verses.json");
const pictures = read("pictures.json");
const ppr = read("ppr.json");
const synonyms = read("synonyms.json");

// field order matters: the bit index is the field id
export const FIELDS = ["title", "kw", "ent", "en", "he", "el", "ph", "sum", "pic", "hv"] as const;
const W = [3.0, 2.5, 2.0, 1.0, 1.5, 1.5, 0.6, 1.2, 1.5, 0.7];
const B = [0.3, 0.4, 0.3, 0.75, 0.6, 0.6, 0.5, 0.6, 0.6, 0.6];
const K1 = 1.2;
const F = FIELDS.length;
const N = slides.length;

const entById = entities;
const deckIdx = new Map(decks.map((d: any, i: number) => [d.slug, i]));

function fieldTexts(s: any): string[][] {
  const out: string[][] = Array.from({ length: F }, () => []);
  const add = (f: number, text?: string | null) => { if (text) out[f].push(text); };
  add(0, s.title);
  for (const k of s.keywords ?? []) add(1, k);
  for (const [ei] of s.entities) {
    const e = entById[ei];
    if (e.type === "verse" || e.type === "number") continue;
    add(2, e.label);
    for (const a of e.aliases ?? []) add(2, a);
    for (const g of e.gloss ?? []) if (e.type === "word" || e.type === "letter") add(2, g);
    for (const t of e.translit ?? []) add(6, t);
  }
  for (const b of s.text ?? []) {
    const t = (b.text ?? "").replace(/~~/g, "");
    if (b.lang === "he") add(4, t);
    else if (b.lang === "el") add(5, t);
    else if (b.lang === "translit") { add(3, t); add(6, t); }
    else add(3, t);
  }
  for (const w of s.words ?? []) {
    if (w.lang === "he") add(4, w.word); else if (w.lang === "el") add(5, w.word);
    add(1, w.gloss); add(6, w.translit); add(1, w.translit);
  }
  for (const l of s.letters ?? []) { add(1, l.letter); add(2, l.meaning); }
  for (const n of s.numbers ?? []) add(1, String(n.value));
  add(7, s.summary);
  for (const p of s.pictures ?? []) {
    add(8, p.description); add(8, p.type === "video-still" ? "video still presenter" : p.type);
    for (const x of p.subjects ?? []) add(8, x);
    add(8, p.text_in_picture); add(8, p.credit);
  }
  for (const k of s.keywords ?? []) add(6, k);
  return out;
}

// ---- term frequencies per (doc, field)
const tf: Map<string, number>[][] = [];
const len: number[][] = [];
for (const s of slides) {
  const texts = fieldTexts(s);
  const docTf: Map<string, number>[] = Array.from({ length: F }, () => new Map<string, number>());
  const docLen: number[] = new Array(F).fill(0);
  const bump = (f: number, term: string) => {
    docTf[f].set(term, (docTf[f].get(term) ?? 0) + 1);
    docLen[f]++;
  };
  texts.forEach((parts, f) => {
    for (const part of parts) {
      for (const tok of tokenize(part)) {
        if (tok.stop) continue;
        if (f === 6) {
          if (tok.script !== "latin") continue;
          const key = "~" + translitKey(tok.surface);
          if (key.length >= 4) bump(6, key);
          continue;
        }
        bump(f, tok.term);
        if (f === 4) for (const v of hebrewVariants(tok.term)) bump(9, v);   // Hebrew without prefixes ו ה ב ל מ כ ש
      }
    }
  });
  tf.push(docTf);
  len.push(docLen);
}
const avg = FIELDS.map((_, f) => len.reduce((a, l) => a + l[f], 0) / N || 1);

// ---- impacts
const df = new Map<string, number>();
for (const docTf of tf) {
  const seen = new Set<string>();
  for (const m of docTf) for (const t of m.keys()) seen.add(t);
  for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
}
const postings = new Map<string, number[]>();
tf.forEach((docTf, d) => {
  const terms = new Set<string>();
  for (const m of docTf) for (const t of m.keys()) terms.add(t);
  for (const t of terms) {
    let tft = 0, mask = 0;
    for (let f = 0; f < F; f++) {
      const c = docTf[f].get(t);
      if (!c) continue;
      mask |= 1 << f;
      tft += (W[f] * c) / (1 - B[f] + (B[f] * len[d][f]) / avg[f]);
    }
    const n = df.get(t)!;
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    const impact = Math.min(255, Math.max(1, Math.round(16 * idf * ((tft * (K1 + 1)) / (tft + K1)))));
    const list = postings.get(t) ?? [];
    list.push(d, impact, mask);
    postings.set(t, list);
  }
});
const terms = [...postings.keys()].sort();
const post = terms.map((t) => {
  const l = postings.get(t)!;
  const out: number[] = [];
  let prev = 0;
  for (let i = 0; i < l.length; i += 3) { out.push(l[i] - prev, l[i + 1], l[i + 2]); prev = l[i]; }
  return out;
});

// ---- documents (display + snippets)
const docs = slides.map((s: any) => {
  const en = (s.text ?? []).filter((b: any) => b.lang === "en" || b.lang === "translit").map((b: any) => b.text.replace(/~~/g, "")).join(" · ");
  const picIdx = (s.pictures ?? []).length;
  return [deckIdx.get(s.deck), s.n, s.title ?? `Slide ${s.n}`, s.summary ?? "", en.slice(0, 420), s.group, picIdx,
    (s.refs ?? []).flatMap((r: any) => r.osis ?? []).slice(0, 6)];
});

// ---- entities for linking, suggestions and the "knowledge panel":
// [label, type, url, slideCount, aliasKeys, gloss, namesByLanguage|0, brief, neighbours]
const LANG = { he: "Hebrew", el: "Greek", ar: "Arabic", la: "Other English / KJV / Latin", es: "Spanish", pt: "Portuguese", fr: "French", de: "German", ru: "Russian" } as Record<string, string>;
const entIndex = new Map(entities.map((e: any, i: number) => [e.id, i]));
const coCount = (e: any) => {
  const counts = new Map<number, number>();
  for (const si of e.slides) for (const [ei] of slides[si].entities) if (ei !== entIndex.get(e.id)) counts.set(ei, (counts.get(ei) ?? 0) + 1);
  return [...counts.entries()].filter(([ei]) => !["verse", "number"].includes(entities[ei].type))
    .map(([ei, c]) => [ei, c * Math.log(1 + (c / e.slides.length) / (entities[ei].slides.length / N))] as [number, number])
    .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([ei]) => ei);
};
const ents = entities.map((e: any) => {
  const keys = new Set<string>();
  const addKey = (x?: string) => {
    if (!x) return;
    const toks = tokenize(String(x)).filter((t) => !t.stop);
    const k = toks.map((t) => t.term).join(" ");
    if (!k) return;
    keys.add(k);
    if (toks.length === 1 && toks[0].script === "arabic") for (const v of arabicVariants(toks[0].term)) keys.add(v);
    if (toks.length === 1 && toks[0].script === "hebrew") for (const v of hebrewVariants(toks[0].term)) if (v.length >= 3) keys.add(v);
  };
  addKey(e.label);
  for (const a of e.aliases ?? []) addKey(a);
  for (const f of e.forms ?? []) addKey(f);
  if (e.type === "word") for (const t of e.translit ?? []) addKey(t);
  if (e.type === "letter") addKey(e.char);
  if (e.lemma) addKey(e.lemma);
  const names: Record<string, string[]> = {};
  for (const [lang, list] of Object.entries(e.names ?? {}) as [string, string[]][]) {
    for (const n of list) addKey(n);
    names[LANG[lang] ?? lang] = list.slice(0, 8);
  }
  const gloss = e.type === "word" || e.type === "letter" ? (e.gloss ?? []).slice(0, 2).join("; ") : "";
  const brief = e.brief ?? (e.type === "word" ? (e.definition ?? "").slice(0, 180) : "");
  const nb = e.slides.length >= 2 && !["verse", "number"].includes(e.type) ? coCount(e) : [];
  return [e.label, e.type, e.url, e.slides.length, [...keys], gloss, Object.keys(names).length ? names : 0, brief, nb];
});

// ---- graph signal: entity -> top slides (Personalized PageRank, 0..1000)
const pprOut: Record<string, number[]> = {};
for (const [k, list] of Object.entries(ppr) as [string, number[][]][]) {
  if (entities[+k].slides.length < 1) continue;
  pprOut[k] = list.slice(0, 25).flat();
}

// ---- verse index: osis -> slides, plus cross-references between verses used in the corpus
const verseSlides: Record<string, number[]> = verses.verses;
const xrefs: Record<string, [string, number][]> = verses.xrefs;

// ---- pictures: [slide, k, type, description, src, w, h, credit]
const pics = pictures.map((p: any) => [p.slide, p.k, p.type, p.description, p.src, p.w, p.h, p.credit ?? null, p.same?.length ?? 0]);

// ---- synonym groups (curated): every term maps to its group's other terms
const syn: Record<string, string[]> = {};
// (names in other languages are not synonyms here: they are entity aliases, and the engine searches an alias
// under the entry's own name — "Ilyas" → Elijah — so multi-word names never leak single words like "david")
for (const group of synonyms as string[][]) {
  const keys = group.map((g) => tokenize(g).filter((t) => !t.stop).map((t) => t.term).join(" ")).filter(Boolean);
  for (const k of keys) syn[k] = [...new Set([...(syn[k] ?? []), ...keys.filter((x) => x !== k)])];
}

// ---- entity -> slides that mention it directly (strongest first)
const es: Record<string, number[]> = {};
entities.forEach((e: any, i: number) => { if (e.type !== "verse") es[i] = e.slides.slice(0, 300); });

const out = {
  v: 1, fields: FIELDS, N, terms, post, docs, ents, es, ppr: pprOut, verses: verseSlides, xrefs, pics, syn,
  decks: decks.map((d: any) => [d.slug, d.title, d.count]),
};
const json = JSON.stringify(out);
const hash = createHash("sha1").update(json).digest("hex").slice(0, 10);
mkdirSync(new URL("../public/data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/data/search.json", import.meta.url), json);
writeFileSync(new URL("../src/data/search-version.json", import.meta.url), JSON.stringify({ hash }));
console.log(`search index: ${N} slides, ${terms.length} terms, ${post.reduce((a, p) => a + p.length / 3, 0)} postings, ` +
  `${ents.length} entities, ${pics.length} pictures, ${(json.length / 1024).toFixed(0)} KB (v ${hash})`);
void latinFold;
