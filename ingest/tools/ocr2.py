"""Second OCR pass for word positions (search-term highlighting), tuned for colourful slides.

The slide is turned into an "ink" image: every pixel's distance from the background colour becomes darkness,
so red, blue, gold and light-green text all become crisp black-on-white. It is enlarged 1.5x and read with
Tesseract in sparse-text mode for English, Hebrew and Greek together. Words are merged with the first pass
(work/ocr) by box overlap. Output: work/ocr2/<slug>/<nnn>.json  [{"t", "b", "c"}]

Usage: python ocr2.py            # slides without a usable PDF text layer (image-only slides)
       python ocr2.py --all      # every slide
       python ocr2.py <slug> <n> # one slide, prints the words
"""
import csv
import glob
import io
import json
import os
import subprocess
import sys
from multiprocessing import Pool

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, "work")
TESSDATA = os.path.join(WORK, "tessdata")
SCALE = 1.5


def ink_image(img):
    border = np.concatenate([img[:6].reshape(-1, 3), img[-6:].reshape(-1, 3), img[:, :6].reshape(-1, 3), img[:, -6:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    diff = np.abs(img.astype(np.int16) - bg.astype(np.int16)).max(axis=2).astype(np.uint8)
    ink = 255 - cv2.normalize(diff, None, 0, 255, cv2.NORM_MINMAX)
    ink = cv2.resize(ink, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_CUBIC)
    _, bw = cv2.threshold(ink, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return bw


def tesseract_words(png_bytes, W, H):
    env = {**os.environ, "OMP_THREAD_LIMIT": "1", "TESSDATA_PREFIX": TESSDATA}
    out = subprocess.run(["tesseract", "stdin", "stdout", "-l", "eng+heb+grc", "--psm", "11", "tsv"],
                         input=png_bytes, capture_output=True, env=env).stdout.decode("utf-8", "replace")
    words = []
    for r in csv.DictReader(io.StringIO(out), delimiter="\t", quoting=csv.QUOTE_NONE):
        t = (r.get("text") or "").strip()
        try:
            conf = float(r["conf"])
        except (TypeError, ValueError):
            continue
        if not t or conf < 40 or not any(ch.isalnum() for ch in t):
            continue
        x, y, w, h = (int(r[k]) for k in ("left", "top", "width", "height"))
        words.append({"t": t, "b": [round(x / W, 4), round(y / H, 4), round((x + w) / W, 4), round((y + h) / H, 4)], "c": round(conf)})
    return words


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter + 1e-9)


def job(path):
    slug, name = path.split(os.sep)[-2], os.path.basename(path)[:-4]
    out = os.path.join(WORK, "ocr2", slug, name + ".json")
    if os.path.exists(out):
        return 0
    img = cv2.imread(path)
    bw = ink_image(img)
    ok, buf = cv2.imencode(".png", bw)
    new = tesseract_words(buf.tobytes(), bw.shape[1], bw.shape[0])
    first = []
    p1 = os.path.join(WORK, "ocr", slug, name + ".json")
    if os.path.exists(p1):
        first = [w for w in json.load(open(p1)) if w["c"] >= 50]
    # Keep both readings of a word (e.g. "rayen" and "raven,"): highlighting matches either one.
    merged = list(first)
    for w in new:
        if not any(m["t"].lower().strip(".,;:!?") == w["t"].lower().strip(".,;:!?") and iou(m["b"], w["b"]) > 0.4 for m in merged):
            merged.append(w)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(merged, open(out, "w"), ensure_ascii=False)
    return len(merged)


def needs(path):
    slug, name = path.split(os.sep)[-2], os.path.basename(path)[:-4]
    tl = json.load(open(os.path.join(WORK, "textlayer", slug, name + ".json")))
    return len(tl["text"].strip()) <= 30


if __name__ == "__main__":
    if len(sys.argv) == 3:
        p = os.path.join(WORK, "master", sys.argv[1], f"{int(sys.argv[2]):03d}.png")
        out = os.path.join(WORK, "ocr2", sys.argv[1], f"{int(sys.argv[2]):03d}.json")
        if os.path.exists(out):
            os.remove(out)
        job(p)
        print(" ".join(w["t"] for w in json.load(open(out))))
        sys.exit()
    paths = sorted(glob.glob(os.path.join(WORK, "master", "*", "*.png")))
    if "--all" not in sys.argv:
        paths = [p for p in paths if needs(p)]
    with Pool(6) as pool:
        counts = pool.map(job, paths, chunksize=4)
    print(f"ocr2: {len(paths)} slides, {sum(counts)} words")
