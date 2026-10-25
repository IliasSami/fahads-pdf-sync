"""Tesseract English OCR for every slide -> word boxes (used for search-term highlighting
and as an English reading hint). Output: work/ocr/<slug>/<nnn>.json [{"t": word, "b": [x0,y0,x1,y1], "c": conf}]"""
import csv, glob, io, json, os, subprocess
from multiprocessing import Pool

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, "work")

def job(path):
    slug, name = path.split(os.sep)[-2], os.path.basename(path)[:-4]
    out = os.path.join(WORK, "ocr", slug, name + ".json")
    if os.path.exists(out):
        return
    tsv = subprocess.run(["tesseract", path, "stdout", "-l", "eng", "--psm", "3", "tsv"],
                         capture_output=True, text=True, env={**os.environ, "OMP_THREAD_LIMIT": "1"}).stdout
    words = []
    for r in csv.DictReader(io.StringIO(tsv), delimiter="\t", quoting=csv.QUOTE_NONE):
        t = (r.get("text") or "").strip()
        try:
            conf = float(r["conf"])
        except (TypeError, ValueError):
            continue
        if not t or conf < 30:
            continue
        x, y, w, h = (int(r[k]) for k in ("left", "top", "width", "height"))
        words.append({"t": t, "b": [round(x / 1920, 4), round(y / 1080, 4), round((x + w) / 1920, 4), round((y + h) / 1080, 4)], "c": round(conf)})
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(words, open(out, "w"), ensure_ascii=False)

if __name__ == "__main__":
    paths = sorted(glob.glob(os.path.join(WORK, "master", "*", "*.png")))
    with Pool(7) as p:
        p.map(job, paths, chunksize=4)
    print("ocr done", len(paths))
