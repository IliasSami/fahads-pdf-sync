// Build-time grouping of cited verses by book and chapter for the Bible Verses pages.
import { VERSES } from "./data.ts";
import { BOOKS } from "./search/refs.ts";

export interface ChapterInfo { chapter: number; verses: string[]; slides: number }
export interface BookInfo { osis: string; name: string; slug: string; chapters: ChapterInfo[]; slides: number; testament: "Old" | "New" }

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export const BOOK_LIST: BookInfo[] = BOOKS.map((b, i) => {
  const chapters = new Map<number, string[]>();
  for (const osis of Object.keys(VERSES.verses)) {
    const [bk, c] = osis.split(".");
    if (bk !== b.osis) continue;
    const list = chapters.get(+c) ?? [];
    list.push(osis);
    chapters.set(+c, list);
  }
  const chs = [...chapters.entries()].sort((a, b2) => a[0] - b2[0]).map(([chapter, vs]) => {
    vs.sort((a, b2) => +a.split(".")[2] - +b2.split(".")[2]);
    const slides = new Set(vs.flatMap((v) => VERSES.verses[v]));
    return { chapter, verses: vs, slides: slides.size };
  });
  const all = new Set(chs.flatMap((c) => c.verses.flatMap((v) => VERSES.verses[v])));
  return { osis: b.osis, name: b.name, slug: slugOf(b.name), chapters: chs, slides: all.size, testament: i < 39 ? "Old" : "New" } as BookInfo;
}).filter((b) => b.chapters.length);
