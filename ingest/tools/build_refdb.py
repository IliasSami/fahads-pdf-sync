"""Compile the open reference datasets in ../refdata into work/ref/ref.sqlite.

Tables
  he_word(osis, idx, pointed, plain, key, strongs, gloss, translit)   STEPBible TAHOT (WLC, CC BY)
  el_word(osis, idx, text, plain, lemma, strongs, gloss, translit)    STEPBible TAGNT (NA28 words, CC BY)
  kjv(osis, text)                                                      KJV (public domain)
  xref(src, dst, votes)                                                OpenBible.info cross-references (CC BY)
  lex(strongs, lang, lemma, translit, gloss, definition)               STEPBible TBESH/TBESG (CC BY)
"""
import glob
import json
import os
import re
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(__file__))
from bible import BOOKS, STEP_TO_OSIS, greek_plain, heb_key, heb_plain  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, "..", "refdata")
OUT = os.path.join(ROOT, "work", "ref", "ref.sqlite")
REF_RE = re.compile(r"^([1-3]?[A-Z][a-z]{1,2})\.(\d+)\.(\d+)(?:\([^)]*\))?#(\d+)=(\S+)")


def step_osis(book, c, v):
    return f"{STEP_TO_OSIS[book]}.{int(c)}.{int(v)}"


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    if os.path.exists(OUT):
        os.remove(OUT)
    db = sqlite3.connect(OUT)
    db.executescript("""
      CREATE TABLE he_word(osis TEXT, idx INT, pointed TEXT, plain TEXT, key TEXT, strongs TEXT, gloss TEXT, translit TEXT);
      CREATE TABLE el_word(osis TEXT, idx INT, text TEXT, plain TEXT, lemma TEXT, strongs TEXT, gloss TEXT, translit TEXT);
      CREATE TABLE kjv(osis TEXT PRIMARY KEY, text TEXT);
      CREATE TABLE xref(src TEXT, dst TEXT, votes INT);
      CREATE TABLE lex(strongs TEXT, lang TEXT, lemma TEXT, translit TEXT, gloss TEXT, definition TEXT);
    """)

    rows = []
    for f in sorted(glob.glob(os.path.join(REF, "step_TAHOT_*.txt"))):
        for line in open(f, encoding="utf-8"):
            m = REF_RE.match(line)
            if not m or "L" not in m.group(5):
                continue
            c = line.rstrip("\n").split("\t")
            pointed = c[1].replace("/", "").replace("\\", "")
            main_s = re.search(r"\{(H\d+[A-Z]?)\}", c[4])
            rows.append((step_osis(m.group(1), m.group(2), m.group(3)), int(m.group(4)), pointed, heb_plain(pointed),
                         heb_key(pointed), main_s.group(1) if main_s else c[4], c[3].strip(), c[2].strip()))
    db.executemany("INSERT INTO he_word VALUES (?,?,?,?,?,?,?,?)", rows)
    print("he_word", len(rows))

    rows = []
    for f in sorted(glob.glob(os.path.join(REF, "step_TAGNT_*.txt"))):
        for line in open(f, encoding="utf-8"):
            m = REF_RE.match(line)
            if not m:
                continue
            c = line.rstrip("\n").split("\t")
            if len(c) < 6 or "NA28" not in c[5]:
                continue
            text = c[1].split(" (")[0].strip()
            translit = c[1].split(" (")[1].rstrip(")") if " (" in c[1] else ""
            strongs = c[3].split("=")[0]
            lemma, _, gloss = c[4].partition("=")
            rows.append((step_osis(m.group(1), m.group(2), m.group(3)), int(m.group(4)), text, greek_plain(text),
                         lemma, strongs, gloss, translit))
    db.executemany("INSERT INTO el_word VALUES (?,?,?,?,?,?,?,?)", rows)
    print("el_word", len(rows))

    kjv = json.load(open(os.path.join(REF, "kjv.json"), encoding="utf-8"))
    rows = []
    for bi, b in enumerate(kjv["books"]):
        for ch in b["chapters"]:
            for v in ch["verses"]:
                rows.append((f"{BOOKS[bi][0]}.{ch['chapter']}.{v['verse']}", v["text"].strip()))
    db.executemany("INSERT INTO kjv VALUES (?,?)", rows)
    print("kjv", len(rows))

    rows = []
    for line in open(os.path.join(REF, "cross_references.txt"), encoding="utf-8"):
        c = line.rstrip("\n").split("\t")
        if len(c) < 3 or c[0].startswith("From"):
            continue
        try:
            rows.append((c[0], c[1], int(c[2])))
        except ValueError:
            pass
    db.executemany("INSERT INTO xref VALUES (?,?,?)", rows)
    print("xref", len(rows))

    rows = []
    for lang, pat in (("he", "step_TBESH_*.txt"), ("el", "step_TBESG_*.txt")):
        for f in glob.glob(os.path.join(REF, pat)):
            for line in open(f, encoding="utf-8"):
                c = line.rstrip("\n").split("\t")
                if len(c) < 8 or not re.match(r"^[HG]\d{4}", c[0]):
                    continue
                definition = re.sub(r"<[^>]+>", " ", c[7])
                rows.append((c[1].split(" ")[0].strip(), lang, c[3].strip(), c[4].strip(), c[6].strip(), re.sub(r"\s+", " ", definition)[:600]))
    db.executemany("INSERT INTO lex VALUES (?,?,?,?,?,?)", rows)
    print("lex", len(rows))

    db.executescript("""
      CREATE INDEX he_osis ON he_word(osis, idx); CREATE INDEX he_key ON he_word(key); CREATE INDEX he_strongs ON he_word(strongs);
      CREATE INDEX el_osis ON el_word(osis, idx); CREATE INDEX el_plain ON el_word(plain); CREATE INDEX el_lemma ON el_word(lemma);
      CREATE INDEX xref_src ON xref(src); CREATE INDEX lex_s ON lex(strongs); CREATE INDEX lex_lemma ON lex(lemma);
    """)
    db.commit()
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()
