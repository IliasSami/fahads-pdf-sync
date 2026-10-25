"""Build the knowledge graph and all website data from the slide transcripts.

Inputs : work/transcripts, work/textlayer, work/ocr, work/master, work/ref/ref.sqlite, decks.yaml, aliases.yaml
Outputs: ../web/src/data/{decks,slides,entities,verses,pictures,topics,graph,ppr}.json
         ../web/public/pictures/<slug>/<nnn>-<k>.webp   (exact picture crops)
         ../web/public/pdfs/<slug>.pdf                   (original PDFs for download)

Algorithms (no AI at runtime; everything here is classical and deterministic):
  * entity canonicalisation: alias table + normalised keys + Strong's numbers (lemmas) + letter-name folding
  * build-sequence grouping: consecutive slides whose text is a near-superset of the previous (animation steps)
  * graph: slides + entities, typed weighted edges (mentions, verse cross-references, gematria, reading order)
  * Personalized PageRank per entity (HippoRAG-style) -> top slides per entity, used by search
  * related slides: IDF-weighted entity overlap + TF-IDF text cosine + cross-reference links
  * Leiden communities over entity co-occurrence (NPMI) -> clusters of related ideas
  * picture boxes snapped to pixel content; perceptual hashes find the same picture across lessons
"""
import collections
import glob
import json
import math
import os
import re
import shutil
import sqlite3
import sys
import unicodedata

import cv2
import igraph as ig
import imagehash
import leidenalg
import numpy as np
import yaml
from PIL import Image
from sklearn.feature_extraction.text import TfidfVectorizer

sys.path.insert(0, os.path.dirname(__file__))
import bible  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, "work")
WEB = os.path.join(ROOT, "..", "web")
DATA = os.path.join(WEB, "src", "data")
PUB = os.path.join(WEB, "public")
DB = sqlite3.connect(os.path.join(WORK, "ref", "ref.sqlite"))

LETTERS_HE = [("alef", "א", 1, ["aleph", "alep"]), ("bet", "ב", 2, ["beth", "beit", "vet"]), ("gimel", "ג", 3, ["gimmel"]),
              ("dalet", "ד", 4, ["daleth", "dalet"]), ("he", "ה", 5, ["hey", "hei", "heh"]), ("vav", "ו", 6, ["waw", "vau"]),
              ("zayin", "ז", 7, ["zain"]), ("chet", "ח", 8, ["het", "heth", "cheth", "khet"]), ("tet", "ט", 9, ["teth"]),
              ("yod", "י", 10, ["yud", "jod"]), ("kaf", "כ", 20, ["kaph", "khaf", "chaf"]), ("lamed", "ל", 30, ["lamedh"]),
              ("mem", "מ", 40, []), ("nun", "נ", 50, []), ("samekh", "ס", 60, ["samech", "samek"]), ("ayin", "ע", 70, ["ain"]),
              ("pe", "פ", 80, ["peh", "fe"]), ("tsadi", "צ", 90, ["tzadi", "tsade", "tzaddi", "sadhe"]),
              ("qof", "ק", 100, ["kof", "qoph", "koph"]), ("resh", "ר", 200, []), ("shin", "ש", 300, ["sin"]), ("tav", "ת", 400, ["taw", "tau"])]
LETTERS_EL = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "xi",
              "omicron", "pi", "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega"]
FINAL_TO_BASE = {"ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ"}

MENTION_W = {"verse_quoted": 1.0, "verse_cited": 0.7, "word": 1.0, "letter": 0.8, "number": 0.6, "people": 0.8, "places": 0.8,
             "events": 0.8, "things": 0.7, "themes": 0.6, "groups": 0.5, "artist": 0.8, "picture": 0.5, "keyword": 0.3}
TYPE_OF_KIND = {"people": "person", "places": "place", "events": "event", "things": "thing", "themes": "theme", "groups": "group"}


def slugify(s):
    s = bible.latin_fold(s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "x"


def name_key(s):
    k = bible.latin_fold(s).strip()
    k = re.sub(r"^(the|a|an)\s+", "", k)
    k = re.sub(r"\(.*?\)", lambda m: m.group(0), k)
    k = re.sub(r"[^a-z0-9()' ]+", " ", k)
    k = re.sub(r"\s+", " ", k).strip()
    if len(k) > 4 and k.endswith("s") and not k.endswith(("ss", "us", "is", "os")):
        k = k[:-1]
    return k


def norm_strongs(s):
    m = re.match(r"^([HG])0*(\d+)", (s or "").strip().upper())
    return f"{m.group(1)}{m.group(2)}" if m else None


def lex_entry(strongs):
    if not strongs:
        return None
    pad = strongs[0] + strongs[1:].zfill(4)
    row = DB.execute("SELECT strongs, lemma, translit, gloss, definition FROM lex WHERE strongs LIKE ? ORDER BY length(strongs) LIMIT 1",
                     (pad + "%",)).fetchone()
    if not row:
        return None
    return {"lemma": row[1], "translit": row[2].replace(".", ""), "gloss": row[3].split(":")[-1].strip(), "definition": row[4][:400]}


def letter_key(item):
    name = bible.latin_fold(item.get("letter") or "").strip()
    char = (item.get("char") or "").strip()
    lang = item.get("lang", "he")
    if lang == "el":
        for g in LETTERS_EL:
            if name.startswith(g):
                return f"letter:el-{g}", g, ""
        return None
    char = FINAL_TO_BASE.get(char, char)
    for canon, c, val, alts in LETTERS_HE:
        if name == canon or name in alts or char == c:
            return f"letter:{canon}", canon, c
    return None


# --------------------------------------------------------------------------------------------- load
def load_slides(decks):
    slides = []
    for d in decks:
        total = len(os.listdir(os.path.join(WORK, "read", d["slug"])))
        d["count"] = total
        for n in range(1, total + 1):
            name = f"{n:03d}"
            tp = os.path.join(WORK, "transcripts", d["slug"], name + ".json")
            t = json.load(open(tp, encoding="utf-8")) if os.path.exists(tp) else None
            tl = json.load(open(os.path.join(WORK, "textlayer", d["slug"], name + ".json")))
            ocr_p = os.path.join(WORK, "ocr", d["slug"], name + ".json")
            ocr = json.load(open(ocr_p)) if os.path.exists(ocr_p) else []
            ocr2_p = os.path.join(WORK, "ocr2", d["slug"], name + ".json")
            ocr2 = json.load(open(ocr2_p)) if os.path.exists(ocr2_p) else [w for w in ocr if w["c"] >= 50]
            has_text_layer = len(tl["text"].strip()) > 30
            # word boxes for highlighting: exact PDF words (text decks) + colour-robust OCR (English, Hebrew, Greek)
            seen_boxes = set()
            hl = []
            for w in (tl["words"] if has_text_layer else []) + ocr2:
                key = (w["t"].lower(), round(w["b"][0], 2), round(w["b"][1], 2))
                if key not in seen_boxes:
                    seen_boxes.add(key)
                    hl.append([w["t"], *w["b"]])
            if t is None:
                fallback = re.sub(r"\s+", " ", tl["text"] if has_text_layer else " ".join(w["t"] for w in ocr)).strip()
                t = {"id": f"{d['slug']}/{n}", "kinds": [], "title": f"Slide {n}", "summary": fallback[:200] or "Not yet transcribed.",
                     "text": [{"lang": "en", "role": "body", "text": fallback}] if fallback else [], "refs": [], "words": [], "letters": [],
                     "numbers": [], "pictures": [], "entities": {}, "keywords": [], "uncertain": [], "confidence": 0, "_missing": True}
            slides.append({"deck": d["slug"], "n": n, "t": t, "hl": hl})
    return slides


# --------------------------------------------------------------------------------------------- entities
class Entities:
    def __init__(self, aliases):
        self.e = {}            # id -> entity dict
        self.alias_to_id = {}  # name_key -> id (for people/places/... and keyword linking)
        self.aliases = aliases  # name_key -> canonical label (from aliases.yaml)

    def get(self, eid, **kw):
        if eid not in self.e:
            self.e[eid] = {"id": eid, "type": kw.get("type"), "label": kw.get("label", eid), "aliases": set(), "slides": {},
                           "gloss": set(), "translit": set(), "forms": set()}
        return self.e[eid]

    def named(self, kind, raw):
        raw = re.sub(r"\s+", " ", raw).strip()
        if not raw:
            return None
        k = name_key(raw)
        canon = self.aliases.get(k, raw)
        ck = name_key(canon)
        eid = self.alias_to_id.get(ck)
        if eid is None:
            eid = f"name:{slugify(ck)}"
            self.alias_to_id[ck] = eid
        self.alias_to_id.setdefault(k, eid)
        ent = self.get(eid, type=TYPE_OF_KIND.get(kind, kind), label=canon)
        ent.setdefault("type_votes", collections.Counter())[TYPE_OF_KIND.get(kind, kind)] += 1
        ent.setdefault("label_votes", collections.Counter())[canon] += 1
        if raw != canon:
            ent["aliases"].add(raw)
        return eid

    def mention(self, eid, sid, w):
        s = self.e[eid]["slides"]
        s[sid] = max(s.get(sid, 0), w)


def build_entities(slides, aliases):
    E = Entities(aliases)
    for i, s in enumerate(slides):
        t, sid = s["t"], i
        quoted = set()
        for r in t.get("refs", []):
            for o in r.get("osis", []):
                eid = f"verse:{o}"
                E.get(eid, type="verse", label=bible_label(o))
                E.mention(eid, sid, MENTION_W["verse_quoted" if r.get("role") == "quoted" else "verse_cited"])
                quoted.add(o)
        for b in t.get("text", []):
            osis = b.get("osis")
            for o in (osis if isinstance(osis, list) else [osis] if osis else []):
                if o and o not in quoted and re.match(r"^[1-3]?[A-Z][A-Za-z]+\.\d+\.\d+$", o):
                    eid = f"verse:{o}"
                    E.get(eid, type="verse", label=bible_label(o))
                    E.mention(eid, sid, MENTION_W["verse_cited"])
        for w in t.get("words", []):
            lang = w.get("lang")
            word = (w.get("word") or "").strip()
            if lang not in ("he", "el") or not word:
                continue
            st = norm_strongs(w.get("strongs"))
            if st:
                eid = f"word:{st.lower()}"
            elif lang == "he":
                eid = f"word:he-{bible.heb_key(word)}"
            else:
                eid = f"word:el-{bible.greek_plain(word).replace(' ', '')}"
            ent = E.get(eid, type="word", label=word)
            ent["lang"] = lang
            ent["strongs"] = st
            ent["forms"].add(word)
            if w.get("gloss"):
                ent["gloss"].add(w["gloss"].strip())
            if w.get("translit"):
                ent["translit"].add(w["translit"].strip())
            E.mention(eid, sid, MENTION_W["word"])
            g = w.get("gematria") or {}
            if isinstance(g.get("total"), int):
                ne = f"number:{g['total']}"
                E.get(ne, type="number", label=str(g["total"]))
                E.mention(ne, sid, MENTION_W["number"])
                ent.setdefault("gematria", {})[g.get("method", "standard")] = g["total"]
        for lt in t.get("letters", []):
            k = letter_key(lt)
            if not k:
                continue
            eid, name, char = k
            ent = E.get(eid, type="letter", label=name)
            ent["char"] = char or lt.get("char")
            ent["lang"] = lt.get("lang", "he")
            if lt.get("meaning"):
                ent["gloss"].add(lt["meaning"])
            if isinstance(lt.get("value"), int):
                ent["value"] = lt["value"]
            E.mention(eid, sid, MENTION_W["letter"])
        for nm in t.get("numbers", []):
            v = nm.get("value")
            if isinstance(v, (int, float)) and float(v).is_integer():
                eid = f"number:{int(v)}"
                ent = E.get(eid, type="number", label=str(int(v)))
                if nm.get("note"):
                    ent["gloss"].add(nm["note"])
                E.mention(eid, sid, MENTION_W["number"])
        for kind, names in (t.get("entities") or {}).items():
            for raw in names or []:
                eid = E.named(kind, raw)
                if eid:
                    E.mention(eid, sid, MENTION_W.get(kind, 0.5))
        for p in t.get("pictures", []):
            if p.get("credit"):
                artist = re.split(r",|\(|\d", p["credit"])[0].strip()
                if len(artist) > 2:
                    eid = E.named("artist", artist)
                    E.e[eid]["type_votes"]["artist"] += 2
                    E.mention(eid, sid, MENTION_W["artist"])
    # keyword / picture-subject links to named entities (weak edges that densify the graph)
    for i, s in enumerate(slides):
        t = s["t"]
        cands = list(t.get("keywords", [])) + [x for p in t.get("pictures", []) for x in p.get("subjects", [])]
        for c in cands:
            eid = E.alias_to_id.get(name_key(c))
            if eid:
                E.mention(eid, i, MENTION_W["keyword"])
    # finalise named entities: majority type and label
    for ent in E.e.values():
        if "type_votes" in ent:
            ent["type"] = ent["type_votes"].most_common(1)[0][0]
            ent["label"] = ent["label_votes"].most_common(1)[0][0]
            del ent["type_votes"], ent["label_votes"]
        if ent["type"] == "word" and ent.get("strongs"):
            lx = lex_entry(ent["strongs"])
            if lx:
                ent["lemma"] = lx["lemma"]
                ent["definition"] = lx["definition"]
                ent["translit"].add(lx["translit"])
                ent["gloss"].add(lx["gloss"])
    return E


def bible_label(osis):
    b, c, v = osis.split(".")
    return f"{bible.NAME.get(b, b)} {c}:{v}"


# --------------------------------------------------------------------------------------------- build groups
def tokens_of(t):
    txt = " ".join(b.get("text", "") for b in t.get("text", []))
    return set(re.findall(r"\w+", bible.latin_fold(bible.heb_plain(txt))))


def build_groups(slides):
    gid = 0
    prev = None
    for s in slides:
        tok = tokens_of(s["t"])
        same = False
        if prev and prev["deck"] == s["deck"] and tok and prev["_tok"]:
            inter = len(tok & prev["_tok"])
            jac = inter / len(tok | prev["_tok"])
            contain = inter / min(len(tok), len(prev["_tok"]))
            same = jac >= 0.75 or (contain >= 0.9 and min(len(tok), len(prev["_tok"])) >= 6)
        if not same:
            gid += 1
        s["group"] = gid
        s["_tok"] = tok
        prev = s


# --------------------------------------------------------------------------------------------- pictures
def snap_box(img, box, pad=0.02):
    H, W = img.shape[:2]
    x0, y0, x1, y1 = box
    if (x1 - x0) * (y1 - y0) > 0.9:
        return [0.0, 0.0, 1.0, 1.0]
    X0, Y0 = int(max(0, x0 - pad) * W), int(max(0, y0 - pad) * H)
    X1, Y1 = int(min(1, x1 + pad) * W), int(min(1, y1 + pad) * H)
    crop = img[Y0:Y1, X0:X1]
    if crop.size == 0:
        return box
    border = np.concatenate([img[:4].reshape(-1, 3), img[-4:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    mask = (np.abs(crop.astype(np.int16) - bg.astype(np.int16)).max(axis=2) > 28).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    ys, xs = np.nonzero(mask)
    if len(xs) < 50:
        return box
    nx0, ny0, nx1, ny1 = (X0 + xs.min()) / W, (Y0 + ys.min()) / H, (X0 + xs.max() + 1) / W, (Y0 + ys.max() + 1) / H
    if (nx1 - nx0) * (ny1 - ny0) < 0.3 * (x1 - x0) * (y1 - y0):
        return box
    return [round(nx0, 4), round(ny0, 4), round(nx1, 4), round(ny1, 4)]


def build_pictures(slides):
    out_dir = os.path.join(PUB, "pictures")
    pics = []
    for i, s in enumerate(slides):
        plist = s["t"].get("pictures", [])
        if not plist:
            continue
        img = cv2.imread(os.path.join(WORK, "master", s["deck"], f"{s['n']:03d}.png"))
        for k, p in enumerate(plist):
            box = p.get("box") or [0, 0, 1, 1]
            box = snap_box(img, [max(0, min(1, v)) for v in box])
            H, W = img.shape[:2]
            crop = img[int(box[1] * H):int(box[3] * H), int(box[0] * W):int(box[2] * W)]
            if crop.size == 0:
                continue
            rgb = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
            if rgb.width > 960:
                rgb = rgb.resize((960, round(rgb.height * 960 / rgb.width)), Image.LANCZOS)
            rel = f"pictures/{s['deck']}/{s['n']:03d}-{k + 1}.webp"
            os.makedirs(os.path.dirname(os.path.join(PUB, rel)), exist_ok=True)
            rgb.save(os.path.join(PUB, rel), "WEBP", quality=86, method=5)
            ph = imagehash.phash(rgb)
            p["box"] = box
            p["src"] = "/" + rel
            p["w"], p["h"] = rgb.width, rgb.height
            pics.append({"id": f"{s['deck']}/{s['n']}/{k + 1}", "slide": i, "k": k + 1, "type": p.get("type"),
                         "description": p.get("description", ""), "subjects": p.get("subjects", []),
                         "text": p.get("text_in_picture", ""), "credit": p.get("credit"), "src": p["src"],
                         "w": rgb.width, "h": rgb.height, "box": box, "_ph": ph})
    # same picture in several places: perceptual-hash clusters (Hamming <= 8), ignoring tiny crops
    groups = list(range(len(pics)))

    def find(a):
        while groups[a] != a:
            groups[a] = groups[groups[a]]
            a = groups[a]
        return a

    for a in range(len(pics)):
        for b in range(a + 1, len(pics)):
            if pics[a]["_ph"] - pics[b]["_ph"] <= 8 and min(pics[a]["w"] * pics[a]["h"], pics[b]["w"] * pics[b]["h"]) > 40000:
                groups[find(a)] = find(b)
    clusters = collections.defaultdict(list)
    for a in range(len(pics)):
        clusters[find(a)].append(a)
    for a, p in enumerate(pics):
        members = clusters[find(a)]
        p["same"] = [pics[m]["id"] for m in members if m != a]
        del p["_ph"]
    return pics


# --------------------------------------------------------------------------------------------- graph
def build_graph(slides, E, xrefs):
    ents = [e for e in E.e.values() if e["slides"]]
    idx = {e["id"]: len(slides) + j for j, e in enumerate(ents)}
    edges, weights = [], []
    for e in ents:
        for sid, w in e["slides"].items():
            edges.append((sid, idx[e["id"]]))
            weights.append(w)
    for i in range(1, len(slides)):
        if slides[i]["deck"] == slides[i - 1]["deck"]:
            edges.append((i - 1, i))
            weights.append(0.6 if slides[i]["group"] == slides[i - 1]["group"] else 0.25)
    for (a, b), votes in xrefs.items():
        ea, eb = f"verse:{a}", f"verse:{b}"
        if ea in idx and eb in idx:
            edges.append((idx[ea], idx[eb]))
            weights.append(min(1.0, 0.2 + votes / 40))
    for e in ents:
        for m, v in (e.get("gematria") or {}).items():
            ne = f"number:{v}"
            if ne in idx:
                edges.append((idx[e["id"]], idx[ne]))
                weights.append(0.8)
    g = ig.Graph(n=len(slides) + len(ents), edges=edges)
    g.es["weight"] = weights
    g.simplify(combine_edges="max")
    return g, ents, idx


def corpus_xrefs(E):
    verses = [k[6:] for k in E.e if k.startswith("verse:")]
    vs = set(verses)
    out = {}
    for v in verses:
        for src, dst, votes in DB.execute("SELECT src, dst, votes FROM xref WHERE src=? AND votes >= 3", (v,)):
            for d in expand_range(dst):
                if d in vs and d != v:
                    key = tuple(sorted((v, d)))
                    out[key] = max(out.get(key, 0), votes)
    return out


def expand_range(r):
    if "-" not in r:
        return [r]
    a, b = r.split("-")
    pa, pb = a.split("."), b.split(".")
    if pa[0] == pb[0] and pa[1] == pb[1]:
        return [f"{pa[0]}.{pa[1]}.{v}" for v in range(int(pa[2]), int(pb[2]) + 1)]
    return [a, b]


def personalized_pagerank(g, ents, idx, n_slides):
    ppr = {}
    for e in ents:
        if len(e["slides"]) < 1:
            continue
        pr = np.array(g.personalized_pagerank(reset_vertices=[idx[e["id"]]], weights="weight", damping=0.6))
        sl = pr[:n_slides]
        top = np.argsort(-sl)[:40]
        mx = sl[top[0]] if len(top) and sl[top[0]] > 0 else 0
        if mx <= 0:
            continue
        ppr[e["id"]] = [[int(t), int(round(1000 * sl[t] / mx))] for t in top if sl[t] / mx >= 0.02]
    return ppr


def related_slides(slides, ents, xrefs):
    N = len(slides)
    df = {e["id"]: len(e["slides"]) for e in ents}
    vec = [dict() for _ in range(N)]
    for e in ents:
        if df[e["id"]] > N * 0.2:
            continue
        idf = math.log(N / df[e["id"]])
        for sid, w in e["slides"].items():
            vec[sid][e["id"]] = w * idf
    norms = [math.sqrt(sum(v * v for v in d.values())) or 1 for d in vec]
    inv = collections.defaultdict(list)
    for sid, d in enumerate(vec):
        for k, v in d.items():
            inv[k].append((sid, v))
    docs = []
    for s in slides:
        t = s["t"]
        parts = [t.get("title", ""), t.get("summary", ""), " ".join(t.get("keywords", []))]
        parts += [b["text"] for b in t.get("text", []) if b.get("lang") in ("en", "translit")]
        parts += [p.get("description", "") for p in t.get("pictures", [])]
        docs.append(" ".join(parts))
    tf = TfidfVectorizer(sublinear_tf=True, min_df=2, max_df=0.3, stop_words="english", ngram_range=(1, 2)).fit_transform(docs)
    cos_text = (tf @ tf.T).tocsr()
    verse_slides = collections.defaultdict(set)
    for e in ents:
        if e["id"].startswith("verse:"):
            for sid in e["slides"]:
                verse_slides[e["id"][6:]].add(sid)
    xpair = collections.defaultdict(list)
    for (a, b), votes in xrefs.items():
        for sa in verse_slides[a]:
            for sb in verse_slides[b]:
                xpair[(sa, sb)].append((a, b, votes))
                xpair[(sb, sa)].append((b, a, votes))
    labels = {e["id"]: e for e in ents}
    out = []
    for a in range(N):
        scores = collections.defaultdict(float)
        shared = collections.defaultdict(list)
        for k, va in vec[a].items():
            for b, vb in inv[k]:
                if b != a:
                    c = va * vb / (norms[a] * norms[b])
                    scores[b] += 0.5 * c
                    shared[b].append((c, k))
        row = cos_text[a]
        for b, v in zip(row.indices.tolist(), row.data.tolist()):
            if b != a:
                scores[b] += 0.35 * v
        for (sa, sb), lst in xpair.items():
            if sa == a:
                scores[sb] += 0.15 * min(1, max(v for _, _, v in lst) / 20)
        cands = []
        for b, sc in scores.items():
            if slides[b]["group"] == slides[a]["group"]:
                continue
            if slides[b]["deck"] == slides[a]["deck"] and abs(slides[b]["n"] - slides[a]["n"]) <= 2:
                continue
            if sc >= 0.06:
                cands.append((sc, b))
        cands.sort(reverse=True)
        chosen, used_groups = [], set()
        other = [c for c in cands if slides[c[1]]["deck"] != slides[a]["deck"]]
        same = [c for c in cands if slides[c[1]]["deck"] == slides[a]["deck"]]
        for pool, quota in ((other, 5), (same, 3), (other, 8)):
            for sc, b in pool:
                if len(chosen) >= 8 or sum(1 for _, x in chosen if x in [p[1] for p in pool]) >= quota:
                    break
                g = slides[b]["group"]
                if g in used_groups:
                    continue
                used_groups.add(g)
                chosen.append((sc, b))
        chosen.sort(reverse=True)
        rel = []
        for sc, b in chosen[:8]:
            reasons = []
            for c, k in sorted(shared[b], reverse=True)[:3]:
                e = labels[k]
                reasons.append(reason_label(e))
            for va, vb, votes in sorted(xpair.get((a, b), []), key=lambda x: -x[2])[:1]:
                reasons.append(f"cross-reference {bible_label(va)} ↔ {bible_label(vb)}")
            rel.append({"slide": b, "score": round(float(sc), 3), "why": reasons[:3]})
        out.append(rel)
    return out


def reason_label(e):
    t = e["type"]
    if t == "verse":
        return f"both cite {e['label']}"
    if t == "word":
        gl = sorted(e["gloss"], key=len)[0] if e["gloss"] else ""
        return f"Hebrew word {e['label']}" + (f" ({gl})" if gl else "") if e.get("lang") == "he" else f"Greek word {e['label']}"
    if t == "letter":
        return f"the letter {e['label']}"
    if t == "number":
        return f"the number {e['label']}"
    return e["label"]


def communities(ents, n_slides):
    pool = [e for e in ents if len(e["slides"]) >= 3 and e["type"] not in ("verse", "number")]
    pid = {e["id"]: i for i, e in enumerate(pool)}
    occ = collections.defaultdict(set)
    for e in pool:
        for sid in e["slides"]:
            occ[sid].add(e["id"])
    co = collections.Counter()
    for sid, es in occ.items():
        es = sorted(es)
        for i in range(len(es)):
            for j in range(i + 1, len(es)):
                co[(es[i], es[j])] += 1
    N = n_slides
    edges, w = [], []
    for (a, b), c in co.items():
        if c < 2:
            continue
        pa, pb, pab = len(pool[pid[a]]["slides"]) / N, len(pool[pid[b]]["slides"]) / N, c / N
        npmi = math.log(pab / (pa * pb)) / -math.log(pab)
        if npmi > 0.05:
            edges.append((pid[a], pid[b]))
            w.append(npmi * math.sqrt(c))
    g = ig.Graph(n=len(pool), edges=edges)
    g.es["weight"] = w
    part = leidenalg.find_partition(g, leidenalg.RBConfigurationVertexPartition, weights="weight", resolution_parameter=1.0, seed=7)
    pr = g.pagerank(weights="weight") if g.ecount() else [0] * len(pool)
    topics = []
    for ci, members in enumerate(part):
        if len(members) < 3:
            continue
        members = sorted(members, key=lambda m: -pr[m])
        label = " · ".join(pool[m]["label"] for m in members[:3])
        tid = f"cluster-{len(topics) + 1}"
        for m in members:
            pool[m]["cluster"] = tid
        topics.append({"id": tid, "label": label, "members": [pool[m]["id"] for m in members]})
    layout = g.layout_fruchterman_reingold(weights="weight", niter=800, seed=None) if g.vcount() else []
    coords = {pool[i]["id"]: [round(x, 3), round(y, 3)] for i, (x, y) in enumerate(layout)}
    gedges = [[pool[a]["id"], pool[b]["id"], round(ww, 3)] for (a, b), ww in zip(edges, w)]
    return topics, coords, gedges


PATH_OF_TYPE = {"person": "people", "place": "places", "event": "topics", "thing": "topics", "theme": "topics",
                "group": "topics", "artist": "topics", "word": "words", "letter": "letters", "number": "numbers"}


def assign_urls(ents):
    used = set()
    for e in ents:
        t, eid = e["type"], e["id"]
        if t == "verse":
            b, c, v = eid[6:].split(".")
            e["url"] = f"/verses/{slugify(bible.NAME[b])}/{c}/#v{v}"
            continue
        if t == "word":
            if e.get("strongs"):
                slug = e["strongs"].lower()
            else:
                tr = sorted(e["translit"], key=len)[0] if e["translit"] else ""
                slug = f"{e.get('lang', 'he')}-" + (slugify(tr) if tr else str(abs(hash(eid)) % 100000))
        elif t == "letter":
            slug = eid.split(":", 1)[1]
        elif t == "number":
            slug = eid.split(":", 1)[1]
        else:
            slug = eid.split(":", 1)[1]
        base, k = f"{PATH_OF_TYPE.get(t, 'topics')}/{slug}", 2
        path = base
        while path in used:
            path, k = f"{base}-{k}", k + 1
        used.add(path)
        e["url"] = f"/{path}/"



# --------------------------------------------------------------------------------------------- multilingual names
LANG_NAMES = {"he": "Hebrew", "el": "Greek", "ar": "Arabic", "la": "Latin / KJV / other English", "es": "Spanish",
              "pt": "Portuguese", "fr": "French", "de": "German", "ru": "Russian"}


def common_words():
    try:
        return {w.strip() for w in open("/usr/share/dict/words", encoding="utf-8", errors="ignore") if w[:1].islower()}
    except OSError:
        return set()


def enrich_names(ents):
    """Attach names in other languages/traditions: curated KB (kb/multilingual.yaml) + STEPBible TIPNR (Hebrew/Greek/KJV)."""
    kb = yaml.safe_load(open(os.path.join(ROOT, "kb", "multilingual.yaml"), encoding="utf-8"))
    tipnr_path = os.path.join(WORK, "ref", "names.json")
    tipnr = json.load(open(tipnr_path, encoding="utf-8")) if os.path.exists(tipnr_path) else {}
    words = common_words()
    by_key = {}
    for e in ents:
        if e["type"] in ("person", "place", "event", "thing", "theme", "group", "artist"):
            by_key.setdefault(name_key(e["label"]), e)
    # names a TIPNR record shares with a *different* Bible name are ambiguous (KJV "Jesus" = Joshua in Heb 4:8,
    # Hebrew בית "house" inside Bethlehem / Beth-peor ...): never use them as alternate names
    form_owners = collections.defaultdict(set)
    for key, recs in tipnr.items():
        for r in recs:
            for f in r.get("he", []) + r.get("el", []):
                form_owners[f].add(key)
    # a name that is another entity's own name or alias belongs to that entity (Messiah, Crucifixion, David ...)
    owner = collections.defaultdict(set)
    for e in ents:
        if e["type"] in ("verse", "number", "word", "letter"):
            continue
        for a in [e["label"], *e.get("aliases", [])]:
            owner[name_key(a)].add(e["id"])
    linked = 0
    for section in kb.values():
        for label, langs in section.items():
            e = by_key.get(name_key(label))
            if not e:
                continue
            names = e.setdefault("names", {})
            for lang, lst in (langs or {}).items():
                for n in lst or []:
                    n = str(n).strip()
                    if n and name_key(n) != name_key(e["label"]) and n not in names.setdefault(lang, []):
                        names[lang].append(n)
            linked += 1
    for e in ents:
        if e["type"] not in ("person", "place"):
            continue
        recs = tipnr.get(e["label"].lower())
        if not recs:
            continue
        r = next((x for x in recs if x["kind"] == e["type"]), None)
        if not r:
            continue
        names = e.setdefault("names", {})
        for n in r.get("kjv", []) + r.get("also", []):
            n = n.strip()
            if ("(" in n or "," in n or len(n) < 3 or n.lower() in words or len(n.split()) > 3
                    or not all(w[:1].isupper() for w in n.split()) or name_key(n) == name_key(e["label"])):
                continue
            if n.lower() in tipnr and n.lower() != e["label"].lower():
                continue
            low, lab = n.lower(), e["label"].lower()
            # gentilic forms (Bethlehemite, Judean, Jew), fragments (Lehem) and other compound places (Jashubi-lehem)
            if (re.search(r"(ites?|ians?|ish|eans?|ic)$", low) or low in ("jew", "jews") or (low in lab and low != lab)
                    or ("-" in low and low.replace("-", "") != lab.replace("-", ""))):
                continue
            if n not in names.setdefault("la", []):
                names["la"].append(n)
        for lang in ("he", "el"):
            for n in r.get(lang, []):
                if "+" in n or "«" in n or "=" in n or len(n) < 2 or (lang == "he" and n == "יהוה" and e["label"] != "God"):
                    continue
                if len(form_owners.get(n, ())) > 1:
                    continue
                plain = "".join(c for c in unicodedata.normalize("NFD", n) if not unicodedata.combining(c)).lower()
                if lang == "el" and re.search(r"(ιος|ιοσ|ιτης|ιτησ|ιανος|ιανοσ|ικος|ικοσ|ικως|ιζω|αιος|αιοσ)$", plain):
                    continue   # Greek adjectives / gentilics (Ἰουδαῖος "Jew", Χριστιανός "Christian")
                if n not in names.setdefault(lang, []):
                    names[lang].append(n)
        if r.get("brief") and not e.get("brief"):
            e["brief"] = r["brief"]
    dropped = 0
    for e in ents:
        if "names" in e:
            for lang, lst in e["names"].items():
                keep = [n for n in lst if not (owner.get(name_key(n), set()) - {e["id"]})]
                dropped += len(lst) - len(keep)
                e["names"][lang] = keep
            e["names"] = {k: v for k, v in e["names"].items() if v}
            if not e["names"]:
                del e["names"]
    print(f"multilingual names: dropped {dropped} names that belong to another entry")
    print(f"multilingual names: KB entries linked {linked}, entities with names {sum(1 for e in ents if e.get('names'))}")

# --------------------------------------------------------------------------------------------- main
def main():
    decks = sorted(yaml.safe_load(open(os.path.join(ROOT, "decks.yaml"))), key=lambda d: d["order"])
    al = yaml.safe_load(open(os.path.join(ROOT, "aliases.yaml"))) or {}
    aliases = {}
    for canon, alts in al.items():
        for a in [canon, *(alts or [])]:
            aliases[name_key(a)] = canon
    slides = load_slides(decks)
    build_groups(slides)
    E = build_entities(slides, aliases)
    xrefs = corpus_xrefs(E)
    g, ents, idx = build_graph(slides, E, xrefs)
    ppr = personalized_pagerank(g, ents, idx, len(slides))
    pr_all = g.pagerank(weights="weight")
    rel = related_slides(slides, ents, xrefs)
    topics, coords, gedges = communities(ents, len(slides))
    pics = build_pictures(slides)

    # ---- write data
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(os.path.join(PUB, "pdfs"), exist_ok=True)
    for d in decks:
        dst = os.path.join(PUB, "pdfs", d["slug"] + ".pdf")
        src = os.path.join(ROOT, "..", "source-pdfs", d["file"])
        if not os.path.exists(dst) or os.path.getsize(dst) != os.path.getsize(src):
            shutil.copyfile(src, dst)
        d["pdf"] = f"/pdfs/{d['slug']}.pdf"
        d["pdfBytes"] = os.path.getsize(src)
    enrich_names(ents)
    eid_list = sorted(ents, key=lambda e: e["id"])
    ent_out = []
    for e in eid_list:
        o = {"id": e["id"], "type": e["type"], "label": e["label"], "aliases": sorted(e["aliases"]),
             "slides": sorted(e["slides"], key=lambda s: (-e["slides"][s], s)), "weights": None,
             "gloss": sorted(e["gloss"]), "translit": sorted(e["translit"]), "forms": sorted(e["forms"]),
             "rank": round(pr_all[idx[e["id"]]] * 1e4, 3), "cluster": e.get("cluster")}
        o["weights"] = [round(e["slides"][s], 2) for s in o["slides"]]
        for k in ("lang", "strongs", "lemma", "definition", "char", "value", "gematria", "names", "brief"):
            if e.get(k) is not None:
                o[k] = e[k]
        ent_out.append(o)
    assign_urls(ent_out)
    ent_index = {e["id"]: i for i, e in enumerate(ent_out)}
    slide_ents = collections.defaultdict(list)
    for e in ent_out:
        for s, w in zip(e["slides"], e["weights"]):
            slide_ents[s].append([ent_index[e["id"]], w])
    slides_out = []
    for i, s in enumerate(slides):
        t = s["t"]
        slides_out.append({
            "deck": s["deck"], "n": s["n"], "group": s["group"], "title": t.get("title"), "summary": t.get("summary"),
            "kinds": t.get("kinds", []), "text": t.get("text", []), "refs": t.get("refs", []), "words": t.get("words", []),
            "letters": t.get("letters", []), "numbers": t.get("numbers", []), "pictures": t.get("pictures", []),
            "keywords": t.get("keywords", []), "colorLinks": t.get("color_links", []), "confidence": t.get("confidence", 0),
            "missing": bool(t.get("_missing")), "entities": sorted(slide_ents[i], key=lambda x: -x[1]), "hl": s["hl"],
            "related": rel[i],
        })
    verses = collections.defaultdict(list)
    for e in ent_out:
        if e["type"] == "verse":
            verses[e["id"][6:]] = e["slides"]
    xref_out = collections.defaultdict(list)
    for (a, b), v in xrefs.items():
        xref_out[a].append([b, v])
        xref_out[b].append([a, v])
    json.dump(decks, open(os.path.join(DATA, "decks.json"), "w"), ensure_ascii=False)
    json.dump(slides_out, open(os.path.join(DATA, "slides.json"), "w"), ensure_ascii=False)
    json.dump(ent_out, open(os.path.join(DATA, "entities.json"), "w"), ensure_ascii=False)
    kjv = {}
    for o in set(verses) | {x for lst in xref_out.values() for x, _ in lst}:
        row = DB.execute("SELECT text FROM kjv WHERE osis=?", (o,)).fetchone()
        if row:
            kjv[o] = row[0]
    json.dump({"verses": verses, "xrefs": xref_out, "kjv": kjv}, open(os.path.join(DATA, "verses.json"), "w"), ensure_ascii=False)
    json.dump(pics, open(os.path.join(DATA, "pictures.json"), "w"), ensure_ascii=False)
    json.dump({"clusters": topics, "coords": coords, "edges": gedges}, open(os.path.join(DATA, "graph.json"), "w"), ensure_ascii=False)
    json.dump({ent_index[k]: v for k, v in ppr.items()}, open(os.path.join(DATA, "ppr.json"), "w"))
    missing = sum(1 for s in slides_out if s["missing"])
    print(f"slides {len(slides_out)} (missing transcripts: {missing}) · entities {len(ent_out)} · verses {len(verses)} · "
          f"xref pairs {len(xrefs)} · pictures {len(pics)} · clusters {len(topics)} · graph {g.vcount()} nodes / {g.ecount()} edges")


if __name__ == "__main__":
    main()
