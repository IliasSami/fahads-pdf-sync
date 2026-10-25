// The search engine. Runs entirely in the visitor's browser (inside a Web Worker) — no server, no AI.
//
// One query fans out to four independent "channels", each producing a ranked list of slides:
//   1. words     — BM25F over 10 weighted fields with exact, prefix, typo-tolerant, phonetic
//                  (transliteration), Hebrew-prefix and synonym matching, coordination + phrase bonuses
//   2. topics    — entity linking: query phrases matched to people, places, words, letters, numbers…
//                  → the slides that mention them
//   3. graph     — Personalized PageRank from the linked entities (multi-hop knowledge-graph neighbours)
//   4. verses    — Bible references parsed from the query → slides citing those verses, plus
//                  cross-referenced verses (OpenBible.info) at a lower weight
// The lists are merged with weighted Reciprocal Rank Fusion (weights depend on what the query looks
// like), animation-step duplicates are collapsed, and every result carries plain-English reasons.
import { tokenize, translitKey, hebrewVariants, arabicVariants, editDistance, latinFold, stem, hebKey, greekPlain, scriptOf, STOPWORDS } from "./normalize.ts";
import { parseRefs, refVerses, refLabel, BOOK_BY_OSIS, type Ref } from "./refs.ts";

export interface SearchData {
  fields: string[]; N: number; terms: string[]; post: number[][];
  docs: [number, number, string, string, string, number, number, string[]][];
  /** [label, type, url, slideCount, aliasKeys, gloss, namesByLanguage | 0, brief, neighbours] */
  ents: [string, string, string, number, string[], string, Record<string, string[]> | 0, string, number[]][];
  es: Record<string, number[]>; ppr: Record<string, number[]>;
  verses: Record<string, number[]>; xrefs: Record<string, [string, number][]>;
  pics: [number, number, string, string, string, number, number, string | null, number][];
  syn: Record<string, string[]>; decks: [string, string, number][];
}

export interface Result {
  slide: number; deck: string; deckTitle: string; n: number; title: string; snippet: string; why: string[];
  more: number[]; picture?: { src: string; w: number; h: number; type: string; description: string; k: number };
  /** true when the search is really about this picture (show the picture instead of the slide) */
  pictureFirst?: boolean;
  /** index terms that matched this slide (incl. synonyms / corrected spellings) — used for highlighting */
  terms?: string[];
  /** plain-English reason, completing "This slide was found because it …" */
  reason?: string;
  url: string; thumb: string; score: number;
}
/** The "at a glance" card shown above the results when the search is clearly about one person, place or idea. */
export interface Panel {
  label: string; type: string; url: string; count: number; brief: string; gloss: string;
  /** the words the visitor typed, when they are another name for this entry ("Elias" → Elijah) */
  asked?: string;
  names: [string, string[]][];
  lessons: { title: string; url: string; count: number }[];
  related: { label: string; url: string; type: string }[];
}
export interface SearchResponse {
  query: string; didYouMean?: string; refs: { label: string; url: string; count: number }[];
  entities: { label: string; type: string; url: string; count: number; gloss: string }[];
  panel?: Panel;
  results: Result[]; total: number; pictures: Result[]; ms: number;
}
export interface Suggestion { label: string; hint: string; url: string; kind: string }

const FIELD_LABEL = ["title", "topic words", "subject", "slide text", "Hebrew", "Greek", "similar spelling", "summary", "picture", "Hebrew"];
const TYPE_LABEL: Record<string, string> = { person: "Person", place: "Place", event: "Event", thing: "Topic", theme: "Topic",
  group: "Group", artist: "Artist", word: "Word", letter: "Letter", number: "Number", verse: "Bible verse" };

interface Cand { t: number; w: number; via: string }
interface Link { ent: number; w: number; span: [number, number]; via: string; said: string; rank: number }
/** entries whose other-language names are searched under their own name */
const NAMED = new Set(["person", "place", "event", "thing", "theme", "group"]);

export class Engine {
  d: SearchData;
  termIdx = new Map<string, number>();
  decoded = new Map<number, Int32Array>();
  aliasMap = new Map<string, number[]>();
  picsBySlide = new Map<number, number[]>();
  plainTerms: number[] = [];
  titleCache = new Map<number, string[]>();
  pairCache = new Map<number, Set<string>>();
  /** sound-alike key → entities, for names spelled the way they sound ("Eliyahoo", "Yitzhak", "Mosheh") */
  phonMap = new Map<string, number[]>();
  /** single-word names, for misspellings ("Elijha", "Abrahm") */
  nameKeys: string[] = [];

  constructor(data: SearchData) {
    this.d = data;
    data.terms.forEach((t, i) => this.termIdx.set(t, i));
    const push = (m: Map<string, number[]>, k: string, i: number) => { const l = m.get(k) ?? []; if (!l.includes(i)) l.push(i); m.set(k, l); };
    data.ents.forEach((e, i) => {
      if (e[1] === "verse") return;
      for (const k of e[4]) {
        push(this.aliasMap, k, i);
        if (scriptOf(k) === "latin" && k.length >= 4) {
          const pk = translitKey(k);
          if (pk.length >= 4) push(this.phonMap, pk, i);
          if (!k.includes(" ")) this.nameKeys.push(k);
        }
      }
    });
    this.nameKeys = [...new Set(this.nameKeys)];
    data.pics.forEach((p, i) => { const l = this.picsBySlide.get(p[0]) ?? []; l.push(i); this.picsBySlide.set(p[0], l); });
    data.terms.forEach((t, i) => { if (!t.startsWith("~") && t.length >= 3) this.plainTerms.push(i); });
  }

  postings(t: number): Int32Array {
    let p = this.decoded.get(t);
    if (!p) {
      const raw = this.d.post[t];
      p = new Int32Array(raw.length);
      let doc = 0;
      for (let i = 0; i < raw.length; i += 3) { doc += raw[i]; p[i] = doc; p[i + 1] = raw[i + 1]; p[i + 2] = raw[i + 2]; }
      this.decoded.set(t, p);
    }
    return p;
  }

  df(t: number) { return this.d.post[t].length / 3; }

  /** Binary search for the first term >= prefix, then walk forward. */
  prefixTerms(prefix: string, max = 25): number[] {
    const T = this.d.terms;
    let lo = 0, hi = T.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (T[mid] < prefix) lo = mid + 1; else hi = mid; }
    const out: number[] = [];
    for (let i = lo; i < T.length && T[i].startsWith(prefix) && out.length < max * 4; i++) out.push(i);
    return out.sort((a, b) => this.df(b) - this.df(a)).slice(0, max);
  }

  fuzzyTerms(term: string): { t: number; dist: number }[] {
    const maxD = term.length >= 8 ? 2 : 1;
    const out: { t: number; dist: number }[] = [];
    const sc = scriptOf(term);
    for (const i of this.plainTerms) {
      const cand = this.d.terms[i];
      if (Math.abs(cand.length - term.length) > maxD || scriptOf(cand) !== sc) continue;
      if (cand[0] !== term[0] && maxD === 1 && term.length < 6) continue;
      const dist = editDistance(term, cand, maxD);
      if (dist <= maxD) out.push({ t: i, dist });
    }
    return out.sort((a, b) => a.dist - b.dist || this.df(b.t) - this.df(a.t)).slice(0, 5);
  }

  /** Candidate index terms for one query token, each with a weight and a reason. */
  candidates(tok: { term: string; surface: string; script: string }, isLast: boolean, typing: boolean): { cands: Cand[]; correction?: string } {
    const out: Cand[] = [];
    const exact = this.termIdx.get(tok.term);
    if (exact !== undefined) out.push({ t: exact, w: 1, via: "exact" });
    if (tok.script === "hebrew" || tok.script === "arabic") {
      for (const v of tok.script === "hebrew" ? hebrewVariants(tok.term) : arabicVariants(tok.term)) {
        const i = this.termIdx.get(v); if (i !== undefined) out.push({ t: i, w: 0.8, via: "exact" });
      }
    }
    for (const s of this.d.syn[tok.term] ?? []) {
      const parts = s.split(" ");
      for (const p of parts) { const i = this.termIdx.get(p); if (i !== undefined) out.push({ t: i, w: 0.6 / parts.length, via: "synonym" }); }
    }
    if (tok.script === "latin" && tok.term.length >= 3) {
      const k = this.termIdx.get("~" + translitKey(tok.surface));
      if (k !== undefined) out.push({ t: k, w: 0.55, via: "spelling" });
    }
    let correction: string | undefined;
    if ((isLast && typing) || (exact === undefined && tok.term.length >= 3)) {
      for (const p of this.prefixTerms(tok.term, 12)) {
        if (p === exact) continue;
        const ratio = tok.term.length / this.d.terms[p].length;
        out.push({ t: p, w: 0.75 * Math.max(0.4, ratio), via: "prefix" });
      }
    }
    if (exact === undefined && tok.term.length >= 4 && !out.some((c) => c.via !== "spelling" && c.w >= 0.5)) {
      const fz = this.fuzzyTerms(tok.term);
      for (const f of fz) out.push({ t: f.t, w: f.dist === 1 ? 0.6 : 0.45, via: "typo" });
      if (fz.length) correction = this.d.terms[fz[0].t];
    }
    return { cands: out, correction };
  }

  /**
   * Link query phrases to the knowledge graph, longest phrase first. Each phrase is tried as written, as any of the
   * entry's names in other languages and traditions (Elias, Ilyas, إلياس, Eliyahu → Elijah), with Hebrew/Arabic
   * prefixes removed, by sound ("Yitzchak" ≈ "Yitzhak"), and finally with one typing slip ("Elijha").
   */
  linkEntities(terms: string[], surfaces: string[] = terms): Link[] {
    const links: Link[] = [];
    const covered = new Array(terms.length).fill(false);
    for (let n = Math.min(5, terms.length); n >= 1; n--) {
      for (let i = 0; i + n <= terms.length; i++) {
        if (covered.slice(i, i + n).some(Boolean)) continue;
        const key = terms.slice(i, i + n).join(" ");
        let ids = this.aliasMap.get(key) ?? this.synonymEntities(key);
        let fuzzy = 1;
        if (!ids?.length && n === 1) {
          const sc = scriptOf(key);
          const vars = sc === "hebrew" ? hebrewVariants(key) : sc === "arabic" ? arabicVariants(key) : [];
          for (const v of vars) { ids = this.aliasMap.get(v); if (ids?.length) break; }
          if (!ids?.length && sc === "latin" && key.length >= 4 && !this.termIdx.has(key)) {
            ids = this.phonMap.get(translitKey(surfaces[i] ?? key)) ?? this.phonMap.get(translitKey(key));
            fuzzy = 0.8;
            if (!ids?.length && key.length >= 5) {
              const near = this.nameKeys.filter((k) => Math.abs(k.length - key.length) <= 1 && k[0] === key[0] && editDistance(key, k, 1) <= 1);
              ids = [...new Set(near.flatMap((k) => this.aliasMap.get(k) ?? []))];
              fuzzy = 0.6;
            }
          }
        }
        if (!ids?.length) continue;
        for (let j = i; j < i + n; j++) covered[j] = true;
        const best = ids.slice().sort((a, b) => this.d.ents[b][3] - this.d.ents[a][3]).slice(0, 4);
        const said = surfaces.slice(i, i + n).join(" ");
        best.forEach((e, rank) => links.push({ ent: e, w: (fuzzy * (n >= 2 ? 1 : 0.85)) / (rank + 1), span: [i, i + n], via: key, said, rank }));
      }
    }
    return links;
  }

  synonymEntities(key: string): number[] | undefined {
    for (const s of this.d.syn[key] ?? []) { const ids = this.aliasMap.get(s); if (ids?.length) return ids; }
    return undefined;
  }

  search(raw: string, opts: { limit?: number; typing?: boolean; deck?: string } = {}): SearchResponse {
    const t0 = performance.now();
    const limit = opts.limit ?? 30;
    const { refs, rest } = parseRefs(raw);
    const allToks = tokenize(rest);
    let toks = allToks.filter((t) => !t.stop);
    if (!toks.length && !refs.length) toks = allToks;
    const seqToks = toks;
    toks = toks.filter((t, i) => toks.findIndex((x) => x.term === t.term) === i);   // "Adam … Adam" counts once

    // ---- query understanding: phrases that are another name for a person, place or idea ("Ilyas", "Noé",
    // "arca de Noé") are searched together with that entry's own name, so the slides about it come first.
    const links = this.linkEntities(toks.map((t) => t.term), toks.map((t) => t.surface));
    const units: { toks: typeof toks; canon: string[] }[] = [];
    for (let i = 0; i < toks.length;) {
      const l = links.find((x) => x.span[0] === i && x.rank === 0 && x.w >= 0.5 && NAMED.has(this.d.ents[x.ent][1]));
      const own = l ? tokenize(this.d.ents[l.ent][0]).filter((t) => !t.stop).map((t) => t.term) : [];
      // Only when the slides don't use the typed words themselves (Ilyas, Noé, Moïse — but not Elohim or Yeshua,
      // which the lessons use and which must keep their own meaning)
      const used = l && toks.slice(i, l.span[1]).some((t) => { const ti = this.termIdx.get(t.term); return ti !== undefined && this.df(ti) >= 3; });
      if (l && !used && own.join(" ") !== l.via) { units.push({ toks: toks.slice(i, l.span[1]), canon: own }); i = l.span[1]; }
      else { units.push({ toks: [toks[i]], canon: [] }); i++; }
    }

    // ---- channel 1: words (BM25F impacts)
    const lex = new Map<number, number>();
    const matched = new Map<number, number>();      // doc -> count of query tokens matched
    const masks = new Map<number, number>();
    const hitTerms = new Set<string>();
    const docTerms = new Map<number, Set<string>>();
    const corrections: string[] = [];
    let corrected = false;
    units.forEach((u, qi) => {
      const cands: Cand[] = [];
      let correction: string | undefined;
      u.toks.forEach((tok, j) => {
        const c = this.candidates(tok, qi === units.length - 1 && j === u.toks.length - 1, !!opts.typing);
        // with a known name, its own spelling counts fully; loose matches (synonyms, typos, prefixes) count less
        for (const x of c.cands) cands.push(u.canon.length && x.via !== "exact" ? { ...x, w: x.w * 0.5 } : x);
        if (!u.canon.length) correction = c.correction;
      });
      const longest = u.canon.reduce((a, b) => (b.length > a.length ? b : a), "");
      for (const t of u.canon) { const i = this.termIdx.get(t); if (i !== undefined) cands.push({ t: i, w: t === longest ? 1 : 0.4, via: "exact" }); }
      if (u.canon.length) corrections.push(u.canon.join(" "));
      else if (correction && !cands.some((c) => c.via === "exact")) { corrections.push(correction); corrected = true; }
      else corrections.push(u.toks.map((t) => t.term).join(" "));
      const best = new Map<number, number>();
      for (const c of cands) {
        const termText = this.d.terms[c.t];
        hitTerms.add(termText.replace(/^~/, ""));
        const p = this.postings(c.t);
        for (let i = 0; i < p.length; i += 3) {
          const doc = p[i], s = p[i + 1] * c.w;
          if (s > (best.get(doc) ?? 0)) best.set(doc, s);
          masks.set(doc, (masks.get(doc) ?? 0) | p[i + 2]);
          if (!termText.startsWith("~")) {
            let set = docTerms.get(doc);
            if (!set) { set = new Set(); docTerms.set(doc, set); }
            if (set.size < 10) set.add(termText);
          }
        }
      }
      for (const [doc, s] of best) { lex.set(doc, (lex.get(doc) ?? 0) + s); matched.set(doc, (matched.get(doc) ?? 0) + 1); }
    });
    const nq = units.length || 1;
    const qTerms = units.flatMap((u) => (u.canon.length ? u.canon : u.toks.map((t) => t.term)));
    const bigrams = [...new Set(seqToks.slice(1).map((t, i) => `${seqToks[i].term} ${t.term}`))];
    for (const [doc, s] of lex) {
      let score = s * Math.pow((matched.get(doc) ?? 0) / nq, 1.5);
      const dd = this.d.docs[doc];
      // every query word in the slide's title is a strong signal (BM25 saturation underrates it)
      let titleTerms = this.titleCache.get(doc);
      if (!titleTerms) { titleTerms = tokenize(dd[2]).map((t) => t.term); this.titleCache.set(doc, titleTerms); }
      const inTitle = qTerms.filter((q) => titleTerms.some((t) => t === q || (q.length >= 4 && t.startsWith(q)))).length;
      if (inTitle === qTerms.length) score *= 1.6;
      else if (inTitle >= 2) score *= 1 + 0.12 * inTitle;
      // adjacent word pairs ("first adam", "red heifer") found side by side in the slide
      if (bigrams.length) {
        let pairs = this.pairCache.get(doc);
        if (!pairs) {
          const seq = tokenize(dd[2] + " . " + dd[3] + " . " + dd[4]).map((t) => t.term);
          pairs = new Set(seq.slice(1).map((t, i) => `${seq[i]} ${t}`));
          this.pairCache.set(doc, pairs);
        }
        const hits = bigrams.filter((b) => pairs.has(b)).length;
        if (hits) score *= 1 + 0.2 * hits;
      }
      lex.set(doc, score);
    }

    // ---- channel 2 + 3: entities and graph
    const entScore = new Map<number, number>();
    const graph = new Map<number, number>();
    const entWhy = new Map<number, string>();
    for (const l of links) {
      const slides = this.d.es[l.ent] ?? [];
      const idf = Math.log(1 + this.d.N / Math.max(1, this.d.ents[l.ent][3]));   // rare topics count more than "God" (771 slides)
      slides.forEach((doc, r) => {
        entScore.set(doc, (entScore.get(doc) ?? 0) + (l.w * idf) / (1 + r * 0.01));
        if (!entWhy.has(doc)) entWhy.set(doc, this.d.ents[l.ent][0]);
      });
      const p = this.d.ppr[l.ent] ?? [];
      for (let i = 0; i < p.length; i += 2) graph.set(p[i], (graph.get(p[i]) ?? 0) + (l.w * p[i + 1]) / 1000);
    }

    // ---- channel 4: Bible verses
    const verseScore = new Map<number, number>();
    const verseWhy = new Map<number, string>();
    const refOut: SearchResponse["refs"] = [];
    for (const r of refs) {
      const vs = refVerses(r);
      const set = new Set<number>();
      for (const v of vs) {
        for (const doc of this.d.verses[v] ?? []) {
          verseScore.set(doc, (verseScore.get(doc) ?? 0) + (r.verse ? 1 : 0.6));
          verseWhy.set(doc, `cites ${osisText(v)}`);
          set.add(doc);
        }
        for (const [x, votes] of this.d.xrefs[v] ?? []) {
          for (const doc of this.d.verses[x] ?? []) {
            if (set.has(doc)) continue;
            verseScore.set(doc, (verseScore.get(doc) ?? 0) + 0.25 * Math.min(1, votes / 30));
            if (!verseWhy.has(doc)) verseWhy.set(doc, `cross-reference: ${osisText(x)}`);
          }
        }
      }
      const b = BOOK_BY_OSIS.get(r.book)!;
      refOut.push({ label: refLabel(r), url: `/verses/${slug(b.name)}/${r.chapter}/` + (r.verse ? `#v${r.verse}` : ""), count: set.size });
    }

    // ---- fusion
    const hasWords = toks.length > 0;
    const entityCovers = links.length > 0 && toks.every((_, i) => links.some((l) => l.span[0] <= i && i < l.span[1]));
    const W = refs.length && !hasWords ? { lex: 0.3, ent: 0.5, graph: 0.3, verse: 3 }
      : refs.length ? { lex: 1.2, ent: 1, graph: 0.6, verse: 1.5 }
      : entityCovers ? { lex: 1.3, ent: 1.0, graph: 0.6, verse: 0 }
      : { lex: 1.5, ent: 0.7, graph: 0.5, verse: 0 };
    // Within the topic channel many slides tie (every slide "about Adam"); let word relevance order them.
    let maxLex = 0;
    for (const v of lex.values()) if (v > maxLex) maxLex = v;
    if (maxLex > 0) for (const [doc, v] of entScore) entScore.set(doc, v * (1 + (lex.get(doc) ?? 0) / maxLex));
    const fused = new Map<number, number>();
    const addList = (m: Map<number, number>, w: number) => {
      if (!w || !m.size) return;
      [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 300).forEach(([doc], r) => fused.set(doc, (fused.get(doc) ?? 0) + w / (60 + r)));
    };
    addList(lex, W.lex);
    addList(entScore, W.ent);
    addList(graph, W.graph);
    addList(verseScore, W.verse);
    // documents that only the graph found must be strongly connected to count
    for (const [doc] of fused) if (!lex.has(doc) && !entScore.has(doc) && !verseScore.has(doc) && (graph.get(doc) ?? 0) < 0.15) fused.delete(doc);

    let ranked = [...fused.entries()].sort((a, b) => b[1] - a[1]);
    if (opts.deck) ranked = ranked.filter(([doc]) => this.d.decks[this.d.docs[doc][0]][0] === opts.deck);

    // ---- collapse animation steps (same build group) into one result
    const seenGroup = new Map<number, Result>();
    const results: Result[] = [];
    const pictures: Result[] = [];
    for (const [doc, score] of ranked) {
      const g = this.d.docs[doc][5];
      const existing = seenGroup.get(g);
      if (existing) { existing.more.push(this.d.docs[doc][1]); continue; }
      const res = this.result(doc, score, masks.get(doc) ?? 0, hitTerms, entWhy.get(doc), verseWhy.get(doc), graph.has(doc) && !lex.has(doc), qTerms);
      res.terms = [...(docTerms.get(doc) ?? [])];
      seenGroup.set(g, res);
      results.push(res);
      if (res.picture) pictures.push(res);
    }
    for (const r of results) r.more.sort((a, b) => a - b);

    const entities = links.slice(0, 8).map((l) => {
      const e = this.d.ents[l.ent];
      return { label: e[0], type: TYPE_LABEL[e[1]] ?? e[1], url: e[2], count: e[3], gloss: e[5] };
    }).filter((e, i, a) => a.findIndex((x) => x.url === e.url) === i);

    // When the words were not found as typed but a name in the knowledge graph was, the "did you mean" points there.
    let didYouMean = corrected && results.length < 8 ? corrections.join(" ") : corrected && !lex.size ? corrections.join(" ") : undefined;
    const panel = this.panel(links, toks.length, entityCovers);
    if (panel && didYouMean && panel.asked) didYouMean = undefined;
    return { query: raw, didYouMean, refs: refOut, entities, panel, results: results.slice(0, limit), total: results.length,
      pictures: pictures.slice(0, 60), ms: Math.round(performance.now() - t0) };
  }

  /** Knowledge card for the one entry the whole query is about (or its main phrase). */
  panel(links: Link[], nq: number, covers: boolean): Panel | undefined {
    const top = links.filter((l) => l.w >= 0.5).sort((a, b) => (b.span[1] - b.span[0]) - (a.span[1] - a.span[0]) || b.w - a.w)[0];
    if (!top) return undefined;
    const width = top.span[1] - top.span[0];
    if (!covers && width * 2 < nq) return undefined;
    const e = this.d.ents[top.ent];
    if (["verse", "number"].includes(e[1]) || e[3] < 1) return undefined;
    const ownKey = tokenize(e[0]).filter((t) => !t.stop).map((t) => t.term).join(" ");
    const asked = top.via === ownKey || translitKey(top.via) === translitKey(ownKey) || e[1] === "word" || e[1] === "letter" ? undefined : top.said;
    const byDeck = new Map<number, number>();
    for (const doc of this.d.es[top.ent] ?? []) { const dk = this.d.docs[doc][0]; byDeck.set(dk, (byDeck.get(dk) ?? 0) + 1); }
    const lessons = [...byDeck.entries()].sort((a, b) => a[0] - b[0])
      .map(([dk, count]) => ({ title: this.d.decks[dk][1], url: `/lessons/${this.d.decks[dk][0]}/`, count }));
    const related = (e[8] ?? []).map((i) => this.d.ents[i]).filter(Boolean).map((r) => ({ label: r[0], url: r[2], type: TYPE_LABEL[r[1]] ?? r[1] }));
    const names = e[6] ? Object.entries(e[6]).filter(([, l]) => l.length) : [];
    return { label: e[0], type: TYPE_LABEL[e[1]] ?? e[1], url: e[2], count: e[3], brief: e[7] ?? "", gloss: e[5] ?? "",
      asked, names, lessons, related };
  }

  result(doc: number, score: number, mask: number, hitTerms: Set<string>, ent?: string, verse?: string, graphOnly?: boolean, qTerms: string[] = []): Result {
    const [deckI, n, title, summary, en] = this.d.docs[doc];
    const [slug, deckTitle] = this.d.decks[deckI];
    const why: string[] = [];
    if (verse) why.push(verse);
    if (ent) why.push(`about ${ent}`);
    const fieldsHit = FIELD_LABEL.filter((_, f) => mask & (1 << f));
    if (fieldsHit.length) why.push("matches the " + [...new Set(fieldsHit)].slice(0, 3).join(", "));
    if (graphOnly) why.push("closely connected topic");
    let picture: Result["picture"];
    let pictureFirst = false;
    const plist = this.picsBySlide.get(doc);
    if (plist && mask & (1 << 8)) {
      let best = plist[0], bestHits = -1;
      for (const pi of plist) {
        const p = this.d.pics[pi];
        const words = new Set(tokenize(`${p[3]} ${p[2]} ${p[7] ?? ""}`).map((t) => t.term));
        const hits = qTerms.length ? qTerms.filter((q) => words.has(q) || [...words].some((w) => q.length >= 4 && w.startsWith(q))).length
          : [...words].filter((w) => hitTerms.has(w)).length;
        if (hits > bestHits) { best = pi; bestHits = hits; }
      }
      const p = this.d.pics[best];
      picture = { src: p[4], w: p[5], h: p[6], type: p[2], description: p[3], k: p[1] };
      pictureFirst = qTerms.length > 0 && bestHits >= Math.ceil(0.6 * qTerms.length);
    }
    const nn = String(n).padStart(3, "0");
    const reason = verse ? verse.replace(/^cites/, "cites").replace(/^cross-reference:/, "is linked to the related verse")
      : ent ? `is about ${ent}`
      : graphOnly ? "is closely connected to what you searched for"
      : fieldsHit.length ? `mentions your words in its ${[...new Set(fieldsHit)].slice(0, 2).join(" and ")}` : "";
    return { reason, slide: doc, deck: slug, deckTitle, n, title, snippet: snippet(summary + " — " + en, hitTerms), why: why.slice(0, 3), more: [],
      picture, pictureFirst, url: `/lessons/${slug}/${n}/`, thumb: `/slides/${slug}/${nn}-320.webp`, score };
  }

  suggest(raw: string): Suggestion[] {
    const out: Suggestion[] = [];
    const { refs } = parseRefs(raw);
    for (const r of refs) {
      const b = BOOK_BY_OSIS.get(r.book)!;
      out.push({ label: refLabel(r), hint: "Bible verse", url: `/verses/${slug(b.name)}/${r.chapter}/` + (r.verse ? `#v${r.verse}` : ""), kind: "verse" });
    }
    const toks = tokenize(raw).filter((t) => !t.stop);
    if (!toks.length) return out;
    const key = toks.map((t) => t.term).join(" ");
    const lastSurface = latinFold(toks[toks.length - 1].surface);
    const scored: [number, number][] = [];
    this.d.ents.forEach((e, i) => {
      if (e[1] === "verse") return;
      let best = 0;
      for (const k of e[4]) {
        if (k === key) best = Math.max(best, 3);
        else if (k.startsWith(key)) best = Math.max(best, 2);
        else if (k.split(" ").some((w) => w.startsWith(key))) best = Math.max(best, 1);
        else if (toks.length === 1 && latinFold(e[0]).startsWith(lastSurface)) best = Math.max(best, 1.5);
      }
      if (best) scored.push([i, best * 10 + Math.log(1 + e[3])]);
    });
    scored.sort((a, b) => b[1] - a[1]);
    for (const [i] of scored.slice(0, 8 - out.length)) {
      const e = this.d.ents[i];
      out.push({ label: e[0], hint: `${TYPE_LABEL[e[1]] ?? e[1]}${e[5] ? " · " + e[5] : ""} · ${e[3]} slide${e[3] === 1 ? "" : "s"}`, url: e[2], kind: e[1] });
    }
    this.d.decks.forEach(([s, title]) => {
      if (out.length < 8 && latinFold(title).includes(latinFold(raw.trim())) && raw.trim().length >= 3)
        out.push({ label: title, hint: "Lesson", url: `/lessons/${s}/`, kind: "lesson" });
    });
    return out.slice(0, 8);
  }
}

function osisText(osis: string): string {
  const [b, c, v] = osis.split(".");
  return `${BOOK_BY_OSIS.get(b)?.name ?? b} ${c}:${v}`;
}

export function slug(s: string): string {
  return latinFold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Pick the ~200-character window with the most matched words and wrap them in <mark>. */
export function snippet(text: string, hit: Set<string>, size = 200): string {
  const words = [...text.matchAll(/[\p{L}\p{M}\p{N}'’]+/gu)];
  const isHit = (w: string) => {
    const sc = scriptOf(w);
    const k = sc === "hebrew" ? hebKey(w) : sc === "greek" ? greekPlain(w) : stem(latinFold(w).replace(/['’]/g, ""));
    return !STOPWORDS.has(latinFold(w)) && (hit.has(k) || hit.has(translitKey(w)));
  };
  const flags = words.map((m) => isHit(m[0]));
  let bestStart = 0, bestHits = -1;
  for (let i = 0; i < words.length; i++) {
    let hits = 0;
    for (let j = i; j < words.length && words[j].index! - words[i].index! < size; j++) if (flags[j]) hits++;
    if (hits > bestHits) { bestHits = hits; bestStart = i; }
    if (bestHits > 0 && words[i].index! > text.length - size) break;
  }
  const from = words.length ? Math.max(0, words[bestStart].index! - (bestStart > 0 ? 20 : 0)) : 0;
  let s = "";
  let pos = from;
  for (let i = 0; i < words.length; i++) {
    const m = words[i];
    if (m.index! < from) continue;
    if (m.index! - from > size) break;
    s += esc(text.slice(pos, m.index));
    s += flags[i] ? `<mark>${esc(m[0])}</mark>` : esc(m[0]);
    pos = m.index! + m[0].length;
  }
  return (from > 0 ? "… " : "") + s.trim() + (pos < text.length - 1 ? " …" : "");
}

export type { Ref };
