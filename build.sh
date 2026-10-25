#!/bin/sh
# Rebuild everything from the PDFs in source-pdfs/ and (optionally) deploy.
#   ./build.sh            render new slides, rebuild knowledge graph + search index + website
#   ./build.sh deploy     ... then publish to Cloudflare (needs `npx wrangler login` once)
set -e
cd "$(dirname "$0")"
PY=ingest/.venv/bin/python

echo "1/6  Rendering slides (only new ones)…"
$PY ingest/tools/render.py
echo "2/6  Finding picture regions…"
$PY ingest/tools/pictures.py
echo "3/6  OCR word positions for highlighting (only new ones)…"
$PY ingest/tools/ocr.py
$PY ingest/tools/ocr2.py --all          # second pass: coloured text, Hebrew and Greek
[ -f ingest/work/ref/ref.sqlite ] || $PY ingest/tools/build_refdb.py
[ -f ingest/work/ref/names.json ] || $PY ingest/tools/tipnr.py   # Bible names: Hebrew/Greek/KJV spellings
$PY ingest/tools/books.py               # Bible book names in English, Hebrew, Greek and 6 other languages

echo "4/6  Checking transcripts…"
missing=0
for slug in $($PY -c "import yaml;print(' '.join(d['slug'] for d in yaml.safe_load(open('ingest/decks.yaml'))))"); do
  left=$(ingest/kg todo "$slug" all)
  if [ "$left" != "all done" ]; then echo "     $slug: slides still to transcribe: $left"; missing=1; fi
done
[ $missing = 0 ] || echo "     (the site will still build; untranscribed slides show their image with OCR text)"

echo "5/6  Building knowledge graph…"
$PY ingest/tools/build_kg.py
echo "6/6  Building search index + website…"
(cd web && npm run build --silent)
echo "Done. Preview locally:  cd web && npx wrangler dev"

if [ "$1" = "deploy" ]; then
  (cd web && npx wrangler deploy)
fi
