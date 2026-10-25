"""Render every slide of every deck.

Outputs (idempotent; skips work whose output already exists):
  work/master/<slug>/<nnn>.png      1920x1080 PNG master (CV, OCR, crops)
  work/read/<slug>/<nnn>.png        1456x819 PNG for transcription reading
  work/textlayer/<slug>/<nnn>.json  PDF words + boxes, embedded-image boxes
  ../web/public/slides/<slug>/<nnn>-{320,960,1920,2560}.webp
"""
import io
import json
import os
import sys
from multiprocessing import Pool

import pymupdf
import yaml
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "..", "source-pdfs")
WORK = os.path.join(ROOT, "work")
PUB = os.path.join(ROOT, "..", "web", "public", "slides")


def webp_best(im, quality):
    """Pixel-exact lossless WebP unless lossy (visually lossless) is clearly smaller."""
    a = io.BytesIO()
    im.save(a, "WEBP", lossless=True, method=4)
    b = io.BytesIO()
    im.save(b, "WEBP", quality=quality, method=5)
    return a.getvalue() if a.tell() <= b.tell() * 1.15 else b.getvalue()


def render_page(job):
    slug, path, i = job
    n = f"{i + 1:03d}"
    out_master = os.path.join(WORK, "master", slug, f"{n}.png")
    out_read = os.path.join(WORK, "read", slug, f"{n}.png")
    out_tl = os.path.join(WORK, "textlayer", slug, f"{n}.json")
    pub = os.path.join(PUB, slug)
    outs = {w: os.path.join(pub, f"{n}-{w}.webp") for w in (320, 960, 1920, 2560)}
    if all(os.path.exists(p) for p in [out_master, out_read, out_tl, *outs.values()]):
        return slug, i, "skip"
    doc = pymupdf.open(path)
    page = doc[i]
    W, H = page.rect.width, page.rect.height

    def pil(width):
        z = width / W
        pix = page.get_pixmap(matrix=pymupdf.Matrix(z, z), alpha=False)
        return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)

    im1920 = pil(1920)
    im1920.save(out_master, "PNG", optimize=False)
    im1920.resize((1456, 819), Image.LANCZOS).save(out_read, "PNG")
    im2560 = pil(2560)
    with open(outs[2560], "wb") as f:
        f.write(webp_best(im2560, 90))
    with open(outs[1920], "wb") as f:
        f.write(webp_best(im1920, 92))
    im1920.resize((960, 540), Image.LANCZOS).save(outs[960], "WEBP", quality=85, method=5)
    im1920.resize((320, 180), Image.LANCZOS).save(outs[320], "WEBP", quality=80, method=5)

    words = [
        {"t": w[4], "b": [round(w[0] / W, 4), round(w[1] / H, 4), round(w[2] / W, 4), round(w[3] / H, 4)]}
        for w in page.get_text("words")
    ]
    images = []
    for im in page.get_image_info():
        r = pymupdf.Rect(im["bbox"]) & page.rect
        if r.is_empty or r.width * r.height < 0.01 * W * H:
            continue
        images.append([round(r.x0 / W, 4), round(r.y0 / H, 4), round(r.x1 / W, 4), round(r.y1 / H, 4)])
    with open(out_tl, "w") as f:
        json.dump({"text": page.get_text("text"), "words": words, "images": images}, f, ensure_ascii=False)
    return slug, i, "ok"


def main():
    decks = yaml.safe_load(open(os.path.join(ROOT, "decks.yaml")))
    jobs = []
    for d in decks:
        path = os.path.join(SRC, d["file"])
        n = len(pymupdf.open(path))
        for sub in ("master", "read", "textlayer"):
            os.makedirs(os.path.join(WORK, sub, d["slug"]), exist_ok=True)
        os.makedirs(os.path.join(PUB, d["slug"]), exist_ok=True)
        jobs += [(d["slug"], path, i) for i in range(n)]
    done = 0
    with Pool(int(sys.argv[1]) if len(sys.argv) > 1 else 6) as pool:
        for slug, i, status in pool.imap_unordered(render_page, jobs, chunksize=4):
            done += 1
            if done % 100 == 0:
                print(f"{done}/{len(jobs)}", flush=True)
    print(f"rendered {len(jobs)} slides")


if __name__ == "__main__":
    main()
