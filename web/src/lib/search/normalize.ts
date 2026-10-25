// Text analysis shared by the index builder (scripts/build-search.ts) and the in-browser
// search engine, so documents and queries are always analysed identically.
// Mirrors ingest/tools/bible.py (heb_key, greek_plain, translit_key).

export type Script = "latin" | "hebrew" | "greek" | "arabic";

const HEB_MARKS = /[֑-ׇ]/g; // cantillation + vowel points
const HEB_LETTER = /[א-ת]/;
const GREEK_LETTER = /[Ͱ-Ͽἀ-῿]/;
const ARABIC_LETTER = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const FINALS: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };

export function scriptOf(token: string): Script {
  if (HEB_LETTER.test(token)) return "hebrew";
  if (GREEK_LETTER.test(token)) return "greek";
  if (ARABIC_LETTER.test(token)) return "arabic";
  return "latin";
}

export function hebPlain(s: string): string {
  return s
    .replace(/[־־]/g, " ")
    .replace(HEB_MARKS, "")
    .replace(/[׃׀|׳״'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function hebKey(s: string): string {
  return hebPlain(s).replace(/[ךםןףץ]/g, (c) => FINALS[c]).replace(/\s/g, "");
}

export function greekPlain(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

/** Arabic: drop vowel marks and tatweel, unify alef/hamza forms, ta marbuta, alef maqsura, Persian letters. */
export function arabicKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0653-\u0655]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0629/g, "\u0647")
    .replace(/[\u0649\u06CC]/g, "\u064A")
    .replace(/\u06A9/g, "\u0643")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .normalize("NFC");
}

/** Arabic-Indic and Persian digits -> 0-9, so an Arabic reference with Arabic digits works like "Genesis 22". */
export function asciiDigits(s: string): string {
  return s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

export function latinFold(s: string): string {
  return s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
}

export function translitKey(s: string): string {
  let k = latinFold(s).replace(/[^a-z]/g, "");
  for (const [a, b] of [["sch", "sh"], ["ch", "h"], ["kh", "h"], ["ph", "f"], ["tz", "ts"], ["ee", "i"],
    ["oo", "u"], ["ou", "u"], ["y", "i"], ["w", "v"], ["q", "k"], ["c", "k"]] as const) {
    k = k.split(a).join(b);
  }
  k = k.replace(/(.)\1+/g, "$1").replace(/h$/, "");
  k = k.replace(/(.)([aeiou]+)$/, (_m, a: string, v: string) => a + v[0]);   // no lookbehind: old Safari
  return k;
}

export const STOPWORDS = new Set(
  ("a an and are as at be been but by can could did do does for from had has have he her here him his how i if in " +
    "into is it its me my no not of on or our she show so tell that the their them then there these they this those " +
    "thou thee thy to us was we were what when where which who whom why will with would ye you your mean means " +
    "slide slides about find please " +
    // question and request words people type around the real subject ("who was elias", "story of noah", "explain the meaning of ...")
    "meaning meanings definition define significance explain explanation story stories teaching teachings lesson lessons " +
    "info information learn know want looking search look see give list anything everything something " +
    // articles in other languages ("el diluvio", "la arca", "die Arche")
    "el la los las le les der die das und et y e o del de").split(" "),
);

/** Conservative English stemmer: plurals, possessives, -ing/-ed/-ion/-ly. Leaves names like Jesus/Genesis/Moses intact-ish. */
export function stem(w: string): string {
  if (w.length <= 3 || /\d/.test(w)) return w;
  w = w.replace(/['’]s$/, "");
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("ings") && w.length > 6) w = w.slice(0, -1);
  if (w.endsWith("s") && !/(ss|us|is|os)$/.test(w) && w.length > 3) w = w.slice(0, -1);
  if (w.endsWith("ing") && w.length >= 7) w = undouble(w.slice(0, -3));
  else if (w.endsWith("ed") && w.length >= 6) w = undouble(w.slice(0, -2));
  else if (w.endsWith("ion") && w.length >= 7) w = w.slice(0, -3);
  else if (w.endsWith("ly") && w.length >= 6) w = w.slice(0, -2);
  if (w.endsWith("e") && w.length >= 6) w = w.slice(0, -1);
  return w;
}

function undouble(w: string): string {
  return /([bdgklmnprt])\1$/.test(w) ? w.slice(0, -1) : w;
}

const HEB_PREFIXES = ["וה", "וב", "ול", "ומ", "וכ", "וש", "בה", "לה", "מה", "כה", "ו", "ה", "ב", "ל", "מ", "כ", "ש"];

export interface Token {
  /** normalised form used for matching */
  term: string;
  /** original surface text (for highlighting / "did you mean") */
  surface: string;
  script: Script;
  stop: boolean;
}

/** Split text into tokens across scripts. Latin apostrophes join (y'shua → yshua). */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const cleaned = asciiDigits(text).replace(/[־־]/g, " ").replace(/(\p{L})['’ʼ](\p{L})/gu, "$1$2");
  const re = /[\p{L}\p{M}\p{N}]+/gu;
  for (const m of cleaned.matchAll(re)) {
    const surface = m[0];
    const script = scriptOf(surface);
    if (script === "hebrew") {
      const term = hebKey(surface);
      if (term) out.push({ term, surface, script, stop: false });
    } else if (script === "greek") {
      const term = greekPlain(surface);
      if (term) out.push({ term, surface, script, stop: false });
    } else if (script === "arabic") {
      const term = arabicKey(surface);
      if (term) out.push({ term, surface, script, stop: false });
    } else {
      const lower = latinFold(surface);
      if (!lower) continue;
      out.push({ term: stem(lower), surface, script, stop: STOPWORDS.has(lower) });
    }
  }
  return out;
}

/** Arabic variants: without the article / conjunction / preposition prefixes (al-, wa-, bi-, li-). */
export function arabicVariants(term: string): string[] {
  const v: string[] = [];
  for (const p of ["\u0648\u0627\u0644", "\u0628\u0627\u0644", "\u0644\u0644", "\u0641\u0627\u0644", "\u0643\u0627\u0644", "\u0627\u0644", "\u0648", "\u0628", "\u0644"]) {
    if (term.startsWith(p) && term.length - p.length >= 2) v.push(term.slice(p.length));
  }
  return v;
}

/** Extra index/query variants for a token (Hebrew prefix-stripped forms). */
export function hebrewVariants(term: string): string[] {
  const v: string[] = [];
  for (const p of HEB_PREFIXES) {
    if (term.startsWith(p) && term.length - p.length >= 2) v.push(term.slice(p.length));
  }
  return v;
}

/** Bounded Damerau-Levenshtein distance; returns max+1 when over the bound. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length, m = b.length;
  let prev2 = new Array(m + 1).fill(0);
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[m];
}
