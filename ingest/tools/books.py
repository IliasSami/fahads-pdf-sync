"""Bible book table for the website: web/src/data/books.json

English names and abbreviations (bible.BOOKS), Hebrew and Greek names, names in Spanish, Portuguese, French, German,
Arabic and Russian (kb/books.yaml), and the number of verses in every chapter (KJV versification, from ref.sqlite).
"""
import json
import os
import sqlite3
import sys

import yaml

sys.path.insert(0, os.path.dirname(__file__))
import bible  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "..", "web", "src", "data", "books.json")


def main():
    db = sqlite3.connect(os.path.join(ROOT, "work", "ref", "ref.sqlite"))
    counts = {}
    for osis, in db.execute("SELECT osis FROM kjv"):
        b, c, v = osis.split(".")
        ch = counts.setdefault(b, {})
        ch[int(c)] = max(ch.get(int(c), 0), int(v))
    other = yaml.safe_load(open(os.path.join(ROOT, "kb", "books.yaml"), encoding="utf-8"))
    taken = {}
    for osis, name, _step, aliases, he, el in bible.BOOKS:
        for a in [name, *aliases]:
            taken[a.lower()] = osis
    out = []
    for osis, name, _step, aliases, he, el in bible.BOOKS:
        names = sorted({a.lower() for a in [name, *aliases]})
        for a in other.get(osis, []):
            a = str(a).strip().lower()
            if taken.setdefault(a, osis) != osis:
                print(f"  skipped {a!r} for {osis}: already {taken[a]}")
                continue
            if a not in names:
                names.append(a)
        ch = counts.get(osis, {})
        out.append({"osis": osis, "name": name, "aliases": names, "he": he, "el": el,
                    "verses": [ch[c] for c in sorted(ch)]})
    json.dump(out, open(OUT, "w"), ensure_ascii=False)
    print(f"books: {len(out)} books, {sum(len(b['aliases']) for b in out)} names -> {OUT}")


if __name__ == "__main__":
    main()
