// Bible reference parsing for queries: "gen 4:1", "Genesis 4 1-3", "1 jn 3", "first kings 18",
// "Psalm 91:11-13", "Genesis chapter 22 verse 13", Hebrew "בראשית ד:א", and book names in other languages:
// "Génesis 22:13", "1. Mose 22", "Juan 3:16", "سفر التكوين ٢٢:١٣", "Бытие 22". Book table: web/src/data/books.json.
import books from "../../data/books.json" with { type: "json" };
import { asciiDigits, hebPlain, latinFold } from "./normalize.ts";

export interface Book { osis: string; name: string; aliases: string[]; he: string[]; el: string[]; verses: number[] }
export interface Ref {
  book: string;          // OSIS book id
  chapter: number;
  verse?: number;
  chapterEnd?: number;
  verseEnd?: number;
  text: string;          // the matched query text
}

export const BOOKS = books as Book[];
export const BOOK_BY_OSIS = new Map(BOOKS.map((b) => [b.osis, b]));

const ORDINALS: [RegExp, string][] = [
  [/\b(first|1st|i)\s+(?=[a-z])/g, "1 "],
  [/\b(second|2nd|ii)\s+(?=[a-z])/g, "2 "],
  [/\b(third|3rd|iii)\s+(?=[a-z])/g, "3 "],
];

/** Same folding for book names and queries: no accents, lower case, Arabic ta marbuta / alef maqsura unified,
 *  Arabic-Indic digits, and German "1. Mose" written as "1 Mose". */
function fold(s: string): string {
  return asciiDigits(latinFold(s)).replace(/\u0629/g, "\u0647").replace(/\u0649/g, "\u064A").replace(/(\d)\.\s*(?=\p{L})/gu, "$1 ");
}

// "chapter 22 verse 13", "capítulo 22 versículo 13", "глава 22 стих 13", "الإصحاح 22 الآية 13" → "22:13"
const CHAPTER_WORD = /(^|\s)(?:chapter|chap|ch|capitulo|cap|chapitre|kapitel|глава|гл|الاصحاح|اصحاح|الفصل)\.?\s*(?=\d)/g;
const VERSE_WORD = /(\d)\s*,?\s*(?:verses?|vv?|vs|versiculos?|versets?|vers|стихи|стих|ст|الايه|ايه|الايات|ايات)\.?\s*(?=\d)/g;

const ALIAS = new Map<string, string>();
for (const b of BOOKS) {
  for (const a of b.aliases) {
    const k = fold(a).replace(/\./g, "").replace(/\s+/g, " ");
    ALIAS.set(k, b.osis);
    ALIAS.set(k.replace(/ /g, ""), b.osis);
  }
}
const ALIAS_KEYS = [...ALIAS.keys()].sort((a, b) => b.length - a.length);
const BOOK_RE = new RegExp(
  "(^|[^\\p{L}\\d])(" + ALIAS_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*")).join("|") +
    ")\\.?(?:\\s+|(?=\\d))(\\d{1,3})(?:\\s*[:.]\\s*|\\s+)?(\\d{1,3})?(?:\\s*[-–—]\\s*(\\d{1,3})(?:\\s*[:.]\\s*(\\d{1,3}))?)?(?!\\d)",
  "giu",
);

const HEB_VAL: Record<string, number> = { "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9, "י": 10,
  "כ": 20, "ך": 20, "ל": 30, "מ": 40, "ם": 40, "נ": 50, "ן": 50, "ס": 60, "ע": 70, "פ": 80, "ף": 80, "צ": 90, "ץ": 90,
  "ק": 100, "ר": 200, "ש": 300, "ת": 400 };
const hebNum = (s: string) => [...hebPlain(s).replace(/\s/g, "")].reduce((t, c) => t + (HEB_VAL[c] ?? 0), 0);

/** Find Bible references in a query. Returns refs and the query with references removed. */
export function parseRefs(query: string): { refs: Ref[]; rest: string } {
  const refs: Ref[] = [];
  let text = fold(query).replace(CHAPTER_WORD, "$1").replace(VERSE_WORD, "$1:");
  for (const [re, rep] of ORDINALS) text = text.replace(re, rep);
  let rest = text;
  for (const m of text.matchAll(BOOK_RE)) {
    const key = m[2].replace(/\./g, "").replace(/\s+/g, " ");
    const osis = ALIAS.get(key) ?? ALIAS.get(key.replace(/ /g, ""));
    if (!osis) continue;
    const book = BOOK_BY_OSIS.get(osis)!;
    const chapter = +m[3];
    if (chapter < 1 || chapter > book.verses.length) continue;
    const matched = m[0].slice(m[1].length);
    const ref: Ref = { book: osis, chapter, text: matched.trim() };
    const v = m[4] ? +m[4] : undefined;
    if (v !== undefined && v >= 1 && v <= book.verses[chapter - 1]) {
      ref.verse = v;
      if (m[5] && m[6]) { ref.chapterEnd = +m[5]; ref.verseEnd = +m[6]; }
      else if (m[5]) { ref.verseEnd = Math.min(+m[5], book.verses[chapter - 1]); }
    } else if (v === undefined && m[5]) {
      ref.chapterEnd = Math.min(+m[5], book.verses.length);   // "Genesis 1-3"
    }
    refs.push(ref);
    rest = rest.replace(matched, " ");
  }
  // Hebrew: בראשית ד:א / במדבר יט
  const hebRe = /([\u05D0-\u05EA][\u05D0-\u05EA\u0591-\u05C7 ]*?)\s+([\u05D0-\u05EA"׳״']{1,4})(?:\s*[:.]\s*([\u05D0-\u05EA"׳״']{1,4}))?(?![\u05D0-\u05EA])/g;
  for (const m of query.matchAll(hebRe)) {
    const name = hebPlain(m[1]);
    const b = BOOKS.find((x) => x.he.some((h) => name.endsWith(h)));
    if (!b) continue;
    const chapter = hebNum(m[2]);
    if (chapter < 1 || chapter > b.verses.length) continue;
    const ref: Ref = { book: b.osis, chapter, text: m[0] };
    if (m[3]) ref.verse = hebNum(m[3]);
    refs.push(ref);
    rest = rest.replace(m[0], " ");
  }
  // Without a reference, give back the query untouched (the ordinal rewrite "first" -> "1" is only for matching books).
  return { refs, rest: refs.length ? rest.replace(/\s+/g, " ").trim() : query.trim() };
}

/** OSIS verse ids covered by a ref (a whole chapter when no verse). */
export function refVerses(r: Ref): string[] {
  const b = BOOK_BY_OSIS.get(r.book)!;
  const out: string[] = [];
  const cEnd = r.chapterEnd ?? r.chapter;
  for (let c = r.chapter; c <= cEnd; c++) {
    const max = b.verses[c - 1] ?? 0;
    const from = c === r.chapter && r.verse ? r.verse : 1;
    let to = max;
    if (c === cEnd) to = r.verseEnd ?? (r.verse && !r.chapterEnd ? r.verse : max);
    for (let v = from; v <= Math.min(to, max); v++) out.push(`${r.book}.${c}.${v}`);
  }
  return out;
}

export function refLabel(r: Ref): string {
  const name = BOOK_BY_OSIS.get(r.book)!.name;
  let s = `${name} ${r.chapter}`;
  if (r.verse) s += `:${r.verse}`;
  if (r.chapterEnd && r.verseEnd) s += `–${r.chapterEnd}:${r.verseEnd}`;
  else if (r.verseEnd && r.verseEnd !== r.verse) s += `–${r.verseEnd}`;
  else if (r.chapterEnd) s += `–${r.chapterEnd}`;
  return s;
}

export function osisLabel(osis: string): string {
  const [b, c, v] = osis.split(".");
  const name = BOOK_BY_OSIS.get(b)?.name ?? b;
  return v ? `${name} ${c}:${v}` : `${name} ${c}`;
}
