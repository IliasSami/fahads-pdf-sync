// Search-quality regression test ("golden set"): real questions about the lessons and the slides
// that must appear near the top. Runs the real engine on the real index (public/data/search.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { Engine } from "../src/lib/search/engine.ts";

const path = new URL("../public/data/search.json", import.meta.url);
const engine = existsSync(path) ? new Engine(JSON.parse(readFileSync(path, "utf8"))) : null;

// [query, expected slides (deck/n — any of them counts), must appear within top K]
const GOLDEN: [string, string[], number][] = [
  ["Genesis 22:13", ["akeda-1/117", "akeda-1/114", "akeda-2/19", "fall-of-man/48"], 5],
  ["ram caught in the thicket", ["akeda-1/117", "akeda-1/114"], 5],
  ["unblemished", ["red-heifer/118", "abel/146"], 5],
  ["red heifer requirements", ["red-heifer/34", "red-heifer/35", "red-heifer/36", "red-heifer/118"], 10],
  ["Jesus 888", ["noah-part-2/79"], 5],
  ["Noah's raven", ["noah-part-2/61", "noah-part-2/70"], 10],
  ["Barabbas son of the father", ["genesis-1-1-part-1/16"], 5],
  ["first Adam last Adam", ["fall-of-man/72"], 5],
  ["Satan letters", ["fall-of-man/67"], 10],
  ["alef tav", ["abel/37", "akeda-2/11", "genesis-1-1-part-1/54"], 10],
  ["elohim pictographs", ["genesis-1-1-part-1/39"], 5],
  ["תמימה", ["red-heifer/118"], 5],
  ["light 207", ["fall-of-man/43"], 5],
  ["skin ore", ["fall-of-man/40", "fall-of-man/43", "fall-of-man/37"], 5],
  ["Doré engraving", ["abel/185"], 5],
  ["Hebrew calendar", ["noah-part-2/18", "noah-part-2/53"], 5],
  ["eliezer trusted servant", ["akeda-2/115"], 10],
  ["gen 4 1", ["abel/13", "abel/25", "abel/6"], 10],
  ["chava", ["abel/13", "abel/25", "fall-of-man/33"], 10],
  ["unblemshed", ["red-heifer/118", "abel/146"], 10],          // typo
];

test("golden set: expected slides appear near the top", { skip: !engine && "no index built yet" }, () => {
  const failures: string[] = [];
  let hits = 0;
  for (const [q, expected, k] of GOLDEN) {
    const r = engine!.search(q, { limit: 50 });
    const top = r.results.slice(0, k).flatMap((x) => [`${x.deck}/${x.n}`, ...x.more.map((m) => `${x.deck}/${m}`)]);
    if (expected.some((e) => top.includes(e))) hits++;
    else failures.push(`${q} → expected one of ${expected.join(", ")} in top ${k}; got ${r.results.slice(0, k).map((x) => `${x.deck}/${x.n}`).join(", ")}`);
  }
  const recall = hits / GOLDEN.length;
  console.log(`golden-set success@k: ${(recall * 100).toFixed(0)}% (${hits}/${GOLDEN.length})`);
  for (const f of failures) console.log("  MISS " + f);
  assert.ok(recall >= 0.9, `success rate ${recall} below 0.9`);
});

// Other languages, traditions and spellings: each must be understood as the same person / place / idea.
const NAMES: [string, string][] = [
  ["Elias", "Elijah"], ["Ilyas", "Elijah"], ["إلياس", "Elijah"], ["Eliyahu", "Elijah"], ["אליהו", "Elijah"], ["Élie", "Elijah"],
  ["who was elias", "Elijah"], ["Elijha", "Elijah"], ["Moïse", "Moses"], ["Musa", "Moses"], ["Moshe", "Moses"],
  ["Ibrahim", "Abraham"], ["إبراهيم", "Abraham"], ["Avraham", "Abraham"], ["יצחק", "Isaac"], ["Yitzchak", "Isaac"], ["Ishaq", "Isaac"],
  ["Hawa", "Eve"], ["حواء", "Eve"], ["Qabil", "Cain"], ["Nuh", "Noah"], ["Noé", "Noah"], ["Pesach", "Passover"], ["Pascua", "Passover"],
  ["Yeshua", "Jesus"], ["Jesucristo", "Jesus"], ["Al-Quds", "Jerusalem"], ["Moriyah", "Mount Moriah"], ["Iblis", "Satan"],
];

test("names in other languages and traditions find the same entry", { skip: !engine && "no index built yet" }, () => {
  const misses = NAMES.filter(([q, label]) => engine!.search(q).panel?.label !== label)
    .map(([q, label]) => `${q} → expected ${label}, got ${engine!.search(q).panel?.label ?? "nothing"}`);
  for (const m of misses) console.log("  MISS " + m);
  assert.equal(misses.length, 0);
  // and the slides about that entry come first
  const top = engine!.search("Ilyas").results[0];
  assert.match(top.title, /Elijah/);
});

test("searches are fast", { skip: !engine && "no index built yet" }, () => {
  const t0 = performance.now();
  for (const [q] of GOLDEN) engine!.search(q);   // warm caches
  const t1 = performance.now();
  for (const [q] of GOLDEN) engine!.search(q);
  const ms = (performance.now() - t1) / GOLDEN.length;
  void t0;
  console.log(`average query time: ${ms.toFixed(1)} ms`);
  assert.ok(ms < 250, "searches should stay well under a quarter second");   // ~20 ms on an idle laptop
});
