"""Helper CLI for transcribing slides.  Run from the project root:

  ingest/kg ctx   <slug> <n|a-b>        context for slides: image path, PDF text hint, OCR hint, picture hints
  ingest/kg verse "<ref>" [...]         canonical KJV + Hebrew (OT) / Greek (NT) text, e.g. "Num 19:2" "Gen.22.1-3"
  ingest/kg lex   <word> [...]          Strong's candidates for a Hebrew/Greek word (or English gloss search)
  ingest/kg gem   <word> [...]          gematria / isopsephy values (standard, ordinal, reduced, sofit)
  ingest/kg zoom  <slug> <n> x0 y0 x1 y1   high-resolution crop (normalised 0-1 coords) -> prints PNG path
  ingest/kg check <slug> <n|a-b|all>    validate transcript JSON files
  ingest/kg todo  <slug> <a-b>          list slides in the range that still have no valid transcript
  ingest/kg put   <file.json>           write one transcript or a JSON list of transcripts to their places, then check them
"""
import json
import os
import re
import sqlite3
import sys

import pymupdf
import yaml

sys.path.insert(0, os.path.dirname(__file__))
import bible  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, "work")
TRANS = os.path.join(WORK, "transcripts")
DECKS = {d["slug"]: d for d in yaml.safe_load(open(os.path.join(ROOT, "decks.yaml")))}
_db = None


def db():
    global _db
    if _db is None:
        _db = sqlite3.connect(os.path.join(WORK, "ref", "ref.sqlite"))
    return _db


def count(slug):
    return len(os.listdir(os.path.join(WORK, "read", slug)))


def rng(slug, spec):
    if spec == "all":
        return list(range(1, count(slug) + 1))
    if "-" in spec:
        a, b = spec.split("-")
        return list(range(int(a), min(int(b), count(slug)) + 1))
    return [int(spec)]


def tpath(slug, n):
    return os.path.join(TRANS, slug, f"{n:03d}.json")


# ------------------------------------------------------------------ ctx
def ctx(slug, spec):
    total = count(slug)
    for n in rng(slug, spec):
        name = f"{n:03d}"
        print(f"=== {slug}/{n}  ({DECKS[slug]['title']}, slide {n} of {total})")
        print(f"IMAGE: {os.path.join(WORK, 'read', slug, name + '.png')}")
        tl = json.load(open(os.path.join(WORK, "textlayer", slug, name + ".json")))
        txt = re.sub(r"[ \t]+", " ", tl["text"]).strip()
        if len(txt) > 30:
            print("PDF TEXT HINT (English reliable; Hebrew/Greek word ORDER is scrambled — read those from the image):")
            print("  " + txt[:1800].replace("\n", " | "))
        ocr_p = os.path.join(WORK, "ocr", slug, name + ".json")
        if len(txt) <= 30 and os.path.exists(ocr_p):
            words = [w["t"] for w in json.load(open(ocr_p)) if w["c"] >= 60]
            if words:
                print("OCR HINT (English only, may contain errors):")
                print("  " + " ".join(words)[:1500])
        pics = json.load(open(os.path.join(WORK, "pictures", slug, name + ".json")))["candidates"]
        if pics:
            print("PICTURE-REGION HINTS (automatic, may be text boxes — confirm visually):", pics)
        prev = tpath(slug, n - 1)
        if os.path.exists(prev):
            try:
                print("PREVIOUS SLIDE TITLE:", json.load(open(prev)).get("title"))
            except Exception:
                pass
        print()


# ------------------------------------------------------------------ verse
def expand(ref_text):
    ref_text = ref_text.strip()
    m = re.match(r"^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)(?:-(?:[1-3]?[A-Za-z]+\.)?(?:(\d+)\.)?(\d+))?$", ref_text)
    if m and m.group(1) in bible.OSIS_INDEX:
        b, c, v1 = m.group(1), int(m.group(2)), int(m.group(3))
        c2 = int(m.group(4)) if m.group(4) else c
        v2 = int(m.group(5)) if m.group(5) else v1
        return [(b, c, v1, c2, v2)]
    if re.search(r"[֐-׿]", ref_text):
        hm = re.match(r"^(.*?)\s+([א-ת\"׳״']+)\s*[:.]\s*([א-ת\"׳״']+)(?:\s*-\s*([א-ת\"׳״']+))?", ref_text)
        if hm:
            name = bible.heb_plain(hm.group(1))
            for b in bible.BOOKS:
                if name in [bible.heb_plain(h) for h in b[4]]:
                    c, v1 = bible.heb_number(hm.group(2)), bible.heb_number(hm.group(3))
                    v2 = bible.heb_number(hm.group(4)) if hm.group(4) else v1
                    return [(b[0], c, v1, c, v2)]
        return []
    return bible.parse_refs(ref_text)


def verse_ids(ref):
    b, c1, v1, c2, v2 = ref
    if v1 is None:
        return [r[0] for r in db().execute("SELECT osis FROM kjv WHERE osis LIKE ? ", (f"{b}.{c1}.%",))]
    ids = []
    for c in range(c1, c2 + 1):
        lo = v1 if c == c1 else 1
        hi = v2 if c == c2 else 200
        for v in range(lo, hi + 1):
            o = f"{b}.{c}.{v}"
            if db().execute("SELECT 1 FROM kjv WHERE osis=?", (o,)).fetchone():
                ids.append(o)
    return ids


def verse(*refs):
    for r in refs:
        parsed = expand(r)
        if not parsed:
            print(f"!! could not parse {r!r}")
            continue
        for ref in parsed:
            for o in verse_ids(ref)[:40]:
                kjv = db().execute("SELECT text FROM kjv WHERE osis=?", (o,)).fetchone()
                print(f"--- {o}")
                print("KJV:", kjv[0] if kjv else "-")
                he = db().execute("SELECT pointed, plain FROM he_word WHERE osis=? ORDER BY idx", (o,)).fetchall()
                if he:
                    print("HE (pointed):", " ".join(p for p, _ in he))
                    print("HE (consonants):", " ".join(p for _, p in he))
                el = db().execute("SELECT text FROM el_word WHERE osis=? ORDER BY idx", (o,)).fetchall()
                if el:
                    print("EL:", " ".join(t for (t,) in el))


# ------------------------------------------------------------------ lex
PREFIXES = ["ו", "ה", "ב", "ל", "מ", "כ", "ש", "וה", "וב", "ול", "ומ", "וכ", "בה", "לה", "מה", "כה", "וש"]


def lex(*words):
    for w in words:
        print(f"=== {w}")
        rows = []
        if re.search(r"[֐-׿]", w):
            key = bible.heb_key(w)
            keys = [key] + [key[len(p):] for p in PREFIXES if key.startswith(p) and len(key) - len(p) >= 2]
            for k in keys:
                rows += db().execute("SELECT strongs, COUNT(*) n FROM he_word WHERE key=? GROUP BY strongs ORDER BY n DESC LIMIT 4", (k,)).fetchall()
            if not rows:
                rows = [(r[0], 0) for r in db().execute("SELECT strongs, lemma FROM lex WHERE lang='he'")
                        if bible.heb_key(r[1]) == key][:5]
        elif re.search(r"[Ͱ-Ͽἀ-῿]", w):
            p = bible.greek_plain(w)
            rows = db().execute("SELECT strongs, COUNT(*) n FROM el_word WHERE plain=? GROUP BY strongs ORDER BY n DESC LIMIT 4", (p,)).fetchall()
            if not rows:
                rows = [(r[0], 0) for r in db().execute("SELECT strongs, lemma FROM lex WHERE lang='el'").fetchall()
                        if bible.greek_plain(r[1]) == p][:4]
        else:
            rows = [(r[0], 0) for r in db().execute(
                "SELECT strongs FROM lex WHERE gloss LIKE ? OR translit LIKE ? LIMIT 8", (f"%{w}%", f"%{w}%"))]
        seen = set()
        for s, n in rows:
            base = re.match(r"[HG]\d+[A-Z]?", s or "")
            if not base or base.group(0) in seen:
                continue
            seen.add(base.group(0))
            lx = db().execute("SELECT strongs, lemma, translit, gloss, substr(definition,1,160) FROM lex WHERE strongs=? OR strongs=? LIMIT 1",
                              (base.group(0), base.group(0)[:5] + "G")).fetchone()
            print(f"  {base.group(0)}  ({n} occurrences)  ", lx[1:] if lx else "")


def gem(*words):
    for w in words:
        print(w, bible.gematria(w))


def zoom(slug, n, x0, y0, x1, y1):
    d = DECKS[slug]
    page = pymupdf.open(os.path.join(ROOT, "..", "source-pdfs", d["file"]))[int(n) - 1]
    r = page.rect
    clip = pymupdf.Rect(r.width * float(x0), r.height * float(y0), r.width * float(x1), r.height * float(y1))
    z = min(8, 1600 / max(clip.width, 1))
    out = os.path.join(WORK, "zoom", f"{slug}-{int(n):03d}-{x0}-{y0}.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    page.get_pixmap(matrix=pymupdf.Matrix(z, z), clip=clip).save(out)
    print(out)


# ------------------------------------------------------------------ check
KINDS = {"title", "verse", "word-study", "gematria", "letters", "list", "table", "chart", "calendar", "code-grid",
         "genealogy", "picture", "quote", "text", "diagram", "map", "humor", "end", "song", "timeline", "comparison"}
LANGS = {"en", "he", "el", "translit", "other"}
ROLES = {"heading", "reference", "verse", "body", "label", "caption", "list", "table", "number", "note", "quote"}
PIC_TYPES = {"photo", "painting", "engraving", "drawing", "cartoon", "map", "diagram", "chart", "logo", "screenshot",
             "video-still", "pictograph", "calendar", "table-image", "icon", "symbol", "illustration", "grid"}
ENTITY_KEYS = {"people", "places", "events", "things", "themes", "groups"}
OSIS_RE = re.compile(r"^([1-3]?[A-Z][A-Za-z]+)\.(\d+)\.(\d+)$")


def heb_similarity(slide_text, osis_list):
    from rapidfuzz import fuzz
    canon = " ".join(bible.heb_plain(r[0]) for o in osis_list for r in db().execute(
        "SELECT pointed FROM he_word WHERE osis=? ORDER BY idx", (o,)))
    if not canon:
        return None
    a = bible.heb_plain(slide_text).translate(bible.FINALS)
    return fuzz.partial_ratio(a, canon.translate(bible.FINALS)) if len(a) <= len(canon) else fuzz.partial_ratio(canon.translate(bible.FINALS), a)


def el_similarity(slide_text, osis_list):
    from rapidfuzz import fuzz
    canon = " ".join(r[0] for o in osis_list for r in db().execute("SELECT plain FROM el_word WHERE osis=? ORDER BY idx", (o,)))
    if not canon:
        return None
    a = bible.greek_plain(slide_text)
    return fuzz.partial_ratio(a, canon) if len(a) <= len(canon) else fuzz.partial_ratio(canon, a)


def check_one(slug, n):
    p = tpath(slug, n)
    errs, warns = [], []
    infos = INFOS
    infos.clear()
    if not os.path.exists(p):
        return ["missing file"], []
    try:
        d = json.load(open(p, encoding="utf-8"))
    except Exception as e:
        return [f"invalid JSON: {e}"], []
    if d.get("id") != f"{slug}/{n}":
        errs.append(f"id must be '{slug}/{n}'")
    for k in ("kinds", "title", "summary", "text", "refs", "words", "pictures", "entities", "keywords", "confidence"):
        if k not in d:
            errs.append(f"missing field {k}")
    if errs:
        return errs, warns
    bad = set(d["kinds"]) - KINDS
    if bad:
        errs.append(f"unknown kinds {bad}")
    if not d["title"] or len(d["title"]) > 100:
        errs.append("title empty or > 100 chars")
    if len(d["summary"]) < 20:
        errs.append("summary too short")
    for i, b in enumerate(d["text"]):
        if b.get("lang") not in LANGS:
            errs.append(f"text[{i}].lang {b.get('lang')!r}")
        if b.get("role") not in ROLES:
            errs.append(f"text[{i}].role {b.get('role')!r}")
        t = b.get("text", "")
        if b.get("lang") == "he" and re.search(r"[A-Za-z]", t):
            warns.append(f"text[{i}] he block contains Latin letters")
        if b.get("lang") == "he" and not re.search(r"[א-ת]", t):
            errs.append(f"text[{i}] he block has no Hebrew letters")
        if b.get("lang") == "el" and not re.search(r"[Ͱ-Ͽἀ-῿]", t):
            errs.append(f"text[{i}] el block has no Greek letters")
        osis = b.get("osis")
        if osis:
            ids = osis if isinstance(osis, list) else [osis]
            for o in ids:
                if not OSIS_RE.match(o) or not db().execute("SELECT 1 FROM kjv WHERE osis=?", (o,)).fetchone():
                    errs.append(f"text[{i}].osis {o!r} is not a valid verse id")
            if b.get("role") == "verse" and b.get("lang") == "he":
                s = heb_similarity(t, ids)
                if s is not None and s < 85:
                    warns.append(f"text[{i}] Hebrew differs from WLC {ids} (similarity {s:.0f}) — re-check letters with `kg verse`")
                elif s is not None:
                    infos.append(f"text[{i}] Hebrew matches WLC {ids} (similarity {s:.0f})")
            if b.get("role") == "verse" and b.get("lang") == "el":
                s = el_similarity(t, ids)
                if s is not None and s < 80:
                    warns.append(f"text[{i}] Greek differs from NA28 {ids} (similarity {s:.0f})")
                elif s is not None:
                    infos.append(f"text[{i}] Greek matches NA28 {ids} (similarity {s:.0f})")
    if not d["text"]:
        warns.append("no text blocks")
    for i, r in enumerate(d["refs"]):
        for o in r.get("osis", []):
            if not OSIS_RE.match(o) or not db().execute("SELECT 1 FROM kjv WHERE osis=?", (o,)).fetchone():
                errs.append(f"refs[{i}] osis {o!r} invalid")
        if r.get("role") not in ("quoted", "cited"):
            errs.append(f"refs[{i}].role must be quoted|cited")
    for i, w in enumerate(d["words"]):
        if w.get("lang") not in ("he", "el", "en", "other"):
            errs.append(f"words[{i}].lang")
        s = w.get("strongs")
        sp = (s[0] + re.sub(r"\D", "", s[1:]).zfill(4)) if s and len(s) > 1 else s
        if s and not db().execute("SELECT 1 FROM lex WHERE strongs LIKE ?", (sp + "%",)).fetchone():
            warns.append(f"words[{i}].strongs {s} not found in lexicon")
        g = w.get("gematria")
        if g:
            vals = bible.gematria(w.get("word", ""))
            total = g.get("total")
            if g.get("values") and total is not None and sum(g["values"]) != total:
                warns.append(f"words[{i}] gematria values sum {sum(g['values'])} != total {total} (as shown on slide? note it in 'uncertain')")
            if total is not None and vals and total not in [v for k, v in vals.items() if k != "letters"]:
                warns.append(f"words[{i}] gematria total {total} matches no standard method {vals} — fine if the slide shows it, note in 'uncertain'")
    for i, pic in enumerate(d["pictures"]):
        if pic.get("type") not in PIC_TYPES:
            errs.append(f"pictures[{i}].type {pic.get('type')!r}")
        b = pic.get("box")
        if not (isinstance(b, list) and len(b) == 4 and 0 <= b[0] < b[2] <= 1 and 0 <= b[1] < b[3] <= 1):
            errs.append(f"pictures[{i}].box must be [x0,y0,x1,y1] in 0-1 with x0<x1, y0<y1")
        if len(pic.get("description", "")) < 15:
            errs.append(f"pictures[{i}].description too short")
    if not isinstance(d["entities"], dict) or set(d["entities"]) - ENTITY_KEYS:
        errs.append(f"entities keys must be among {sorted(ENTITY_KEYS)}")
    if not (3 <= len(d["keywords"]) <= 25):
        errs.append("keywords: give 3-25")
    if not (0 <= float(d["confidence"]) <= 1):
        errs.append("confidence 0-1")
    return errs, warns


INFOS = []


def check(slug, spec):
    ok = 0
    for n in rng(slug, spec):
        errs, warns = check_one(slug, n)
        if errs or warns or INFOS:
            print(f"{slug}/{n}:")
            for i in INFOS:
                print("   ok   ", i)
            for e in errs:
                print("   ERROR", e)
            for w in warns:
                print("   warn ", w)
        if not errs:
            ok += 1
    print(f"{ok}/{len(rng(slug, spec))} valid")


def todo(slug, spec):
    missing = [n for n in rng(slug, spec) if check_one(slug, n)[0]]
    print(" ".join(map(str, missing)) if missing else "all done")


def put(path):
    data = json.load(open(path, encoding="utf-8"))
    items = data if isinstance(data, list) else [data]
    for d in items:
        m = re.match(r"^([a-z0-9-]+)/(\d+)$", str(d.get("id", "")))
        if not m or m.group(1) not in DECKS:
            print(f"ERROR bad id {d.get('id')!r} — must be '<slug>/<n>'")
            continue
        slug, n = m.group(1), int(m.group(2))
        os.makedirs(os.path.join(TRANS, slug), exist_ok=True)
        with open(tpath(slug, n), "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
        errs, warns = check_one(slug, n)
        status = "OK " if not errs else "FIX"
        print(f"{status} {slug}/{n}" + "".join(f"\n   ERROR {e}" for e in errs) + "".join(f"\n   warn  {w}" for w in warns))


if __name__ == "__main__":
    cmd, args = sys.argv[1], sys.argv[2:]
    {"put": put, "ctx": ctx, "verse": verse, "lex": lex, "gem": gem, "zoom": zoom, "check": check, "todo": todo}[cmd](*args)
