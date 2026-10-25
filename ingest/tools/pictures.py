"""Detect picture regions (photos, paintings, engravings, logos, maps) on each slide.

Classical image analysis only: a block is "pictorial" when it is mostly non-background
and has many distinct tones (text blocks are sparse strokes with few tones).
Candidates are merged with the PDF's own embedded-image boxes (exact, text decks).

Output: work/pictures/<slug>/<nnn>.json  {"candidates": [[x0,y0,x1,y1], ...]}  (normalised 0-1)
Usage:  python pictures.py            # all slides
        python pictures.py --sheet red-heifer   # debug contact sheet with boxes
"""
import glob
import json
import os
import sys
from multiprocessing import Pool

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, "work")
B = 24  # block size in px at 1920x1080


def background(img):
    border = np.concatenate([img[:6].reshape(-1, 3), img[-6:].reshape(-1, 3), img[:, :6].reshape(-1, 3), img[:, -6:].reshape(-1, 3)])
    q = (border // 16).astype(np.int32)
    keys = q[:, 0] * 256 + q[:, 1] * 16 + q[:, 2]
    k = np.bincount(keys).argmax()
    return np.array([(k // 256) * 16 + 8, ((k // 16) % 16) * 16 + 8, (k % 16) * 16 + 8])


def detect(path):
    img = cv2.imread(path)
    H, W = img.shape[:2]
    bg = background(img)
    diff = np.abs(img.astype(np.int16) - bg.astype(np.int16)).max(axis=2) > 40
    q = (img // 32).astype(np.int32)
    codes = q[:, :, 0] * 64 + q[:, :, 1] * 8 + q[:, :, 2]
    gh, gw = H // B, W // B
    mask = np.zeros((gh, gw), np.uint8)
    for by in range(gh):
        for bx in range(gw):
            ys, xs = slice(by * B, (by + 1) * B), slice(bx * B, (bx + 1) * B)
            cov = diff[ys, xs].mean()
            if cov < 0.35:
                continue
            distinct = len(np.unique(codes[ys, xs]))
            gray = img[ys, xs].mean(axis=2)
            tones = len(np.unique((gray // 8).astype(np.int32)))
            if (cov > 0.7 and tones >= 18 and distinct >= 14) or (cov > 0.5 and distinct >= 40):
                mask[by, bx] = 1
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    boxes = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if w * h < 0.012 * gw * gh or w < 3 or h < 3 or area / (w * h) < 0.6:
            continue
        boxes.append([round(x / gw, 3), round(y / gh, 3), round(min(1, (x + w) / gw), 3), round(min(1, (y + h) / gh), 3)])
    return boxes


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter + 1e-9)


def job(path):
    slug, name = path.split(os.sep)[-2], os.path.basename(path)[:-4]
    out = os.path.join(WORK, "pictures", slug, name + ".json")
    tl = json.load(open(os.path.join(WORK, "textlayer", slug, name + ".json")))
    # Embedded images that cover the whole slide are flattened slides, not pictures.
    pdf = [b for b in tl["images"] if (b[2] - b[0]) * (b[3] - b[1]) < 0.6]
    cv = detect(path)
    boxes = pdf + [b for b in cv if all(iou(b, p) < 0.5 for p in pdf)]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({"candidates": boxes}, open(out, "w"))
    return len(boxes)


def sheet(slug):
    paths = sorted(glob.glob(os.path.join(WORK, "master", slug, "*.png")))
    tiles = []
    for p in paths:
        img = cv2.resize(cv2.imread(p), (480, 270))
        boxes = json.load(open(p.replace("master", "pictures").replace(".png", ".json")))["candidates"]
        for b in boxes:
            cv2.rectangle(img, (int(b[0] * 480), int(b[1] * 270)), (int(b[2] * 480), int(b[3] * 270)), (0, 0, 255), 3)
        cv2.putText(img, os.path.basename(p)[:3], (4, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 0), 2)
        tiles.append(img)
    while len(tiles) % 6:
        tiles.append(np.full((270, 480, 3), 255, np.uint8))
    rows = [np.hstack(tiles[i:i + 6]) for i in range(0, len(tiles), 6)]
    for k in range(0, len(rows), 6):
        out = os.path.join(WORK, f"sheet-{slug}-{k // 6}.jpg")
        cv2.imwrite(out, np.vstack(rows[k:k + 6]), [cv2.IMWRITE_JPEG_QUALITY, 70])
        print(out)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--sheet":
        sheet(sys.argv[2])
    else:
        paths = sorted(glob.glob(os.path.join(WORK, "master", "*", "*.png")))
        with Pool(6) as pool:
            counts = pool.map(job, paths, chunksize=8)
        print(f"{len(paths)} slides, {sum(counts)} picture candidates, {sum(1 for c in counts if c)} slides with pictures")
