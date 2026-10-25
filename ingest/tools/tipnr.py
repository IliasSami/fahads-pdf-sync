"""Parse STEPBible TIPNR (Translators Individualised Proper Names with all References, CC BY 4.0)
into work/ref/names.json:  { "elijah": [ {id, kind, name, also, kjv, he, el, brief, refs}, ... ] }  (most-referenced first)

Each record gives the English name, other English spellings (e.g. KJV "Elias" for Elijah), the Hebrew and Greek
forms, a one-line description and how often the person/place is mentioned in the Bible.
"""
import collections
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bible  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "..", "refdata", "step_TIPNR_-_Translators.txt")
OUT = os.path.join(ROOT, "work", "ref", "names.json")


def main():
    records = []
    kind = None
    cur = None
    for raw in open(SRC, encoding="utf-8"):
        line = raw.rstrip("\n")
        if line.startswith("$=========="):
            kind = "person" if "PERSON" in line else "place" if "PLACE" in line else "other"
            cur = None
            continue
        c = line.split("\t")
        if re.match(r"^[A-Z][^@\t]*@[^=\t]+=[HG]\d", line) and kind:
            name, rest = line.split("@", 1)
            cur = {"id": c[0], "kind": kind, "name": name.strip(), "also": set(), "kjv": set(), "he": set(), "el": set(),
                   "brief": "", "refs": 0}
            records.append(cur)
            continue
        if cur is None:
            continue
        if line.startswith("– ") and len(c) >= 4:
            forms = re.findall(r"«[HG]\d+[A-Z]?=([^\s;,|]+)", c[2])
            for f in forms:
                if re.search(r"[֐-׿]", f):
                    cur["he"].add(bible.heb_plain(f))
                elif re.search(r"[Ͱ-Ͽἀ-῿]", f):
                    cur["el"].add(f)
            for part in re.split(r";", c[3]):
                m = re.match(r"\s*([^=\[\]]+?)\s*=\s*([A-Z,]+)", part)
                if m:
                    nm = m.group(1).strip()
                    if "KJV" in m.group(2):
                        cur["kjv"].add(nm)
                    else:
                        cur["also"].add(nm)
            if line.startswith("– Total"):
                for nm in re.split(r"\s+or\s+|,\s*", c[1]):
                    nm = nm.strip()
                    if nm and nm != cur["name"]:
                        cur["also"].add(nm)
                try:
                    cur["refs"] = int(c[-1]) if c[-1].strip().isdigit() else int([x for x in c if x.strip().isdigit()][-1])
                except (ValueError, IndexError):
                    pass
        elif line.startswith("@Brief="):
            cur["brief"] = line.split("=", 1)[1].strip()
    by_name = collections.defaultdict(list)
    for r in records:
        for k in ("also", "kjv", "he", "el"):
            r[k] = sorted(x for x in r[k] if x and x != r["name"])
        by_name[r["name"].lower()].append(r)
    for k in by_name:
        by_name[k].sort(key=lambda r: -r["refs"])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(by_name, open(OUT, "w"), ensure_ascii=False)
    print(f"{len(records)} records, {len(by_name)} distinct names -> {OUT}")
    for nm in ("elijah", "elisha", "noah", "isaiah", "korah", "eve", "jerusalem", "moriah"):
        r = by_name.get(nm, [{}])[0]
        print(f"  {nm}: kjv={r.get('kjv')} also={r.get('also')} he={r.get('he')} el={r.get('el')} refs={r.get('refs')} brief={r.get('brief', '')[:60]}")


if __name__ == "__main__":
    main()
