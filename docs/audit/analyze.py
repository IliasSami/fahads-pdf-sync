import pymupdf, sys, os, json, re, collections, unicodedata
SRC = sys.argv[1]
OUT = sys.argv[2]
def scripts(text):
    c = collections.Counter()
    for ch in text:
        if not ch.isalpha(): continue
        o = ord(ch)
        if 0x0590 <= o <= 0x05FF or 0xFB1D <= o <= 0xFB4F: c['Hebrew'] += 1
        elif 0x0370 <= o <= 0x03FF or 0x1F00 <= o <= 0x1FFF: c['Greek'] += 1
        elif 0x0600 <= o <= 0x06FF: c['Arabic'] += 1
        elif 0x0700 <= o <= 0x074F: c['Syriac'] += 1
        elif o < 0x250: c['Latin'] += 1
        else: c['Other:'+unicodedata.name(ch,'?').split()[0]] += 1
    return c
report = {}
for fn in sorted(os.listdir(SRC)):
    if not fn.lower().endswith('.pdf'): continue
    doc = pymupdf.open(os.path.join(SRC, fn))
    meta = doc.metadata
    sizes = collections.Counter()
    fonts = collections.Counter()
    sc_total = collections.Counter()
    pages = []
    for i, page in enumerate(doc):
        r = page.rect
        sizes[(round(r.width), round(r.height))] += 1
        text = page.get_text("text")
        words = page.get_text("words")
        imgs = page.get_image_info()
        area = r.width * r.height
        img_cov = 0.0
        for im in imgs:
            b = pymupdf.Rect(im['bbox']) & r
            img_cov += b.width * b.height / area
        sc = scripts(text)
        sc_total.update(sc)
        drawings = len(page.get_drawings())
        for f in page.get_fonts():
            fonts[f[3]] += 1
        pages.append(dict(p=i+1, chars=len(text.strip()), words=len(words), imgs=len(imgs), img_cov=round(min(img_cov,9),2), drawings=drawings, scripts=dict(sc), links=len(page.get_links()), annots=len(list(page.annots() or []))))
    n = len(doc)
    low_text = sum(1 for p in pages if p['chars'] < 40)
    img_heavy = sum(1 for p in pages if p['img_cov'] > 0.8)
    img_heavy_low_text = sum(1 for p in pages if p['img_cov'] > 0.5 and p['chars'] < 40)
    report[fn] = dict(pages=n, meta={k:v for k,v in meta.items() if v}, sizes={f"{w}x{h}":c for (w,h),c in sizes.items()},
        toc=len(doc.get_toc()), total_chars=sum(p['chars'] for p in pages), avg_words=round(sum(p['words'] for p in pages)/n,1),
        low_text_pages=low_text, img_cov_gt80=img_heavy, image_only_like=img_heavy_low_text,
        scripts=dict(sc_total), top_fonts=fonts.most_common(12), per_page=pages)
json.dump(report, open(OUT,'w'), indent=1, default=str)
tot=0
for fn,r in report.items():
    tot+=r['pages']
    print(f"\n=== {fn}: {r['pages']} pages, sizes={r['sizes']}, toc={r['toc']}")
    print("  meta:", {k:r['meta'][k] for k in r['meta'] if k in ('title','author','creator','producer','creationDate')})
    print(f"  total_chars={r['total_chars']} avg_words/page={r['avg_words']} low_text_pages(<40ch)={r['low_text_pages']} imgcov>80%={r['img_cov_gt80']} image-only-like={r['image_only_like']}")
    print("  scripts:", r['scripts'])
    print("  fonts:", [f[0] for f in r['top_fonts']])
print("\nTOTAL PAGES:", tot)
