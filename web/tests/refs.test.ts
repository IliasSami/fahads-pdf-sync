import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRefs, refVerses, refLabel } from "../src/lib/search/refs.ts";
import { tokenize, translitKey, stem } from "../src/lib/search/normalize.ts";

const cases: [string, string, number][] = [
  ["Genesis 22:13", "Genesis 22:13", 1],
  ["gen 4 1", "Genesis 4:1", 1],
  ["jn 3:16", "John 3:16", 1],
  ["1 john 3", "1 John 3", 0],
  ["first kings 18", "1 Kings 18", 0],
  ["Psalm 91:11-13", "Psalms 91:11–13", 3],
  ["Numbers 19", "Numbers 19", 0],
  ["what about hebrews 9:13-14 blood", "Hebrews 9:13–14", 2],
  ["במדבר יט:ב", "Numbers 19:2", 1],
  ["Genesis 1-3", "Genesis 1–3", 0],
  // other languages and phrasings
  ["Génesis 22:13", "Genesis 22:13", 1],
  ["1. Mose 22", "Genesis 22", 0],
  ["Juan 3:16", "John 3:16", 1],
  ["Jean 3 16", "John 3:16", 1],
  ["Salmo 23", "Psalms 23", 0],
  ["سفر التكوين ٢٢:١٣", "Genesis 22:13", 1],
  ["العدد 19", "Numbers 19", 0],
  ["Бытие 22:13", "Genesis 22:13", 1],
  ["От Иоанна 3:16", "John 3:16", 1],
  ["Genesis chapter 22 verse 13", "Genesis 22:13", 1],
  ["numbers chapter 19", "Numbers 19", 0],
  ["Hebreos 9:13-14", "Hebrews 9:13–14", 2],
];

test("parseRefs finds references", () => {
  for (const [q, label, nverses] of cases) {
    const { refs } = parseRefs(q);
    assert.equal(refs.length, 1, q);
    assert.equal(refLabel(refs[0]), label, q);
    if (nverses) assert.equal(refVerses(refs[0]).length, nverses, q);
  }
});

test("parseRefs ignores ordinary words", () => {
  for (const q of ["red heifer", "the ram caught", "Jesus is 888", "acts of faith", "job well done", "mark of cain", "Judas 30 pieces of silver", "Daniel in the lions den"]) {
    assert.equal(parseRefs(q).refs.length, 0, q);
  }
});

test("queries without references are returned unchanged", () => {
  for (const q of ["first Adam last Adam", "I am that I am", "second coming"]) assert.equal(parseRefs(q).rest, q);
});

test("normalisation", () => {
  assert.equal(translitKey("chava"), translitKey("hava"));
  assert.equal(translitKey("chavah"), translitKey("chava"));
  assert.equal(translitKey("Elohim"), translitKey("eloheem"));
  assert.equal(stem("offerings"), stem("offering"));
  assert.equal(stem("jesus"), "jesus");
  assert.equal(stem("genesis"), "genesis");
  const t = tokenize("זֹאת חֻקַּת אֶל־בְּנֵי Ἰησοῦς y'shua Isaac's");
  assert.deepEqual(t.map((x) => x.term), ["זאת", "חקת", "אל", "בני", "ιησουσ", "yshua", "isaac"]);
});

test("Arabic normalisation and question words", async () => {
  const { tokenize, arabicKey, arabicVariants } = await import("../src/lib/search/normalize.ts");
  assert.equal(arabicKey("إِلْيَاس"), arabicKey("الياس"));
  assert.equal(arabicKey("مَرْيَمُ"), "مريم");
  assert.ok(arabicVariants(arabicKey("المسيح")).includes("مسيح"));
  assert.deepEqual(tokenize("Who was Elias? Tell me the story of Noah").filter((t) => !t.stop).map((t) => t.term), ["elia", "noah"]);
  assert.deepEqual(tokenize("تكوين ٢٢").map((t) => t.term), ["تكوين", "22"]);
});
