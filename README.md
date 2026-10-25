# Bible Study Slide Library

A searchable, interconnected website for Dutch Uncle John's 12 Bible-study slide decks (1,443 slides).
Every slide is shown **exactly as in the original PDF**, and the whole library is linked through a
knowledge graph of Bible verses, Hebrew and Greek words, letters, gematria numbers, people, places,
topics and pictures. The site has **no server code and no AI at runtime**. It is static files on Cloudflare,
and the search engine runs in the visitor's browser.

## Live site

**https://slides.bible-study-library.workers.dev** is hosted on Cloudflare (free plan, account "Marko@artiviesta.com's Account").
It is public but kept out of search engines: every page sends `X-Robots-Tag: noindex`, carries a `robots` meta tag, and
`robots.txt` disallows crawling. Optional extra: Cloudflare dashboard → Security → turn on **Block AI bots**.

## Publish an update

From this folder, after any change (new PDF, corrected transcript, design tweak), run:

```bash
./build.sh deploy
```

The first time on a new computer, log in once with `cd web && npx wrangler login`. On a server, set `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` instead. Only changed files are uploaded, so an update takes a minute or two.

## Add a new PDF later

1. Copy the PDF into `source-pdfs/` and add a line to `ingest/decks.yaml` (slug, file, title, order).
2. Run `./build.sh`. It renders the new slides, finds picture regions and word positions, and tells you
   which slides still need transcribing.
3. Transcribe the new slides with Claude Code. In this folder, ask:
   *"Transcribe deck `<slug>` following ingest/agent/INSTRUCTIONS.md"*. Each slide is checked automatically:
   Hebrew and Greek verses against the Bible text, gematria sums recomputed, schema validated.
4. Run `./build.sh deploy`.

## What's inside

```
source-pdfs/            the original PDFs (also downloadable from the site)
ingest/                 offline pipeline (Python 3.12, run once per new PDF)
  decks.yaml            lesson titles and order
  aliases.yaml          name merging (Yeshua = Jesus, Abram = Abraham, Akeda = Akedah …)
  kb/multilingual.yaml  names of people, places and ideas in Hebrew, Greek, Arabic, KJV/Latin, Spanish, Portuguese,
                        French, German and Russian (Elias, Ilyas, إلياس, Eliyahu → Elijah)
  kb/books.yaml         Bible book names in those languages (Génesis, 1. Mose, Juan, سفر التكوين, Бытие)
  kb/groups.json        plain-English names for the groups of related ideas on the map
  agent/INSTRUCTIONS.md how each slide is transcribed (schema, rules, examples)
  tools/render.py       PDF → pixel-exact slide images (lossless WebP at 320/960/1920/2560 px)
  tools/pictures.py     picture-region hints (classical image analysis)
  tools/ocr.py          word positions for highlighting search terms on image-only slides
  tools/ocr2.py         second OCR pass for coloured lettering, Hebrew and Greek (better yellow highlighting)
  tools/tipnr.py        STEPBible TIPNR proper names → Hebrew/Greek forms and KJV spellings of every Bible name
  tools/books.py        Bible book table (English, Hebrew, Greek + 6 languages) for reference parsing
  tools/build_refdb.py  Hebrew OT, Greek NT, KJV, Strong's lexicons, cross-references → SQLite
  tools/agent.py        `ingest/kg` helper: context, verse/lexicon lookup, gematria, zoom, validation
  tools/build_kg.py     knowledge graph + all website data (see "How search works")
  work/transcripts/     one JSON per slide: the verified text, words, verses, pictures, entities
web/                    the website (Astro, static)
  scripts/build-search.ts   builds the in-browser search index
  scripts/build-explore.ts  builds the data for the Map of Ideas explorer
  src/lib/search/       the search engine (runs in a Web Worker)
  src/pages/            lessons, slides, verses, words, topics, letters, pictures, search, help,
                        map/ (explore step by step), map/outline/, map/story/
  wrangler.jsonc        Cloudflare config (static assets only)
build.sh                rebuild everything (and deploy)
PLAN.md                 the original plan and research
```

## How search works (no AI, all in the browser)

One query runs through four channels, and their rankings are merged:

1. **Words.** BM25F over 10 weighted fields: title, topic words, subjects, slide text, Hebrew, Greek,
   transliteration sound-alikes, summary, picture descriptions, and Hebrew without prefixes. It handles prefixes as you type,
   typos (edit distance), transliteration variants (*chava = hava*), Hebrew with or without vowel points, Greek with
   or without accents, and a curated Bible-study thesaurus (Pesach = Passover, Akeda = Binding of Isaac, …).
   Scores are precomputed per word and slide, so a query is a sum of small integer lists.
2. **Topics.** Phrases in the query are linked to the knowledge graph's people, places, words, letters,
   numbers and themes, which returns the slides that mention them.
3. **Graph.** Personalized PageRank from those entities finds slides that are connected through shared verses,
   words and ideas, even when they use different wording.
4. **Verses.** Bible references are parsed (`gen 22:13`, `Psalm 91:11-13`, `במדבר יט:ב`). This finds slides that cite
   those verses, plus OpenBible.info cross-references at a lower weight.

**Names in any language or tradition.** Every person, place and idea carries its names in Hebrew, Greek, Arabic,
KJV/Latin, Spanish, Portuguese, French, German and Russian (curated list plus STEPBible's TIPNR names). A query phrase is
linked to the knowledge graph as typed, through any of those names, with Hebrew/Arabic prefixes removed, by sound
(*Yitzchak* ≈ *Yitzhak*), or with one typing slip (*Elijha*). When the slides don't use the typed name (*Ilyas*, *Noé*),
the entry's own name is searched in its place, and a card at the top of the results says *"Elias" is another name for
Elijah*. Bible references work with book names in those languages and as *Genesis chapter 22 verse 13*. Question words
(*who was*, *meaning of*, *story of*) are ignored.

The lists are merged with weighted Reciprocal Rank Fusion. The weights depend on the query: a reference, a single
topic, or a free phrase. Animation-step slides are grouped together, and every result says why it matched.
Pictures are first-class: each picture on each slide has a description, subjects and an exact crop. Identical pictures
reused in several lessons are found with perceptual hashing.

**Connected slides** on every slide page come from IDF-weighted entity overlap, TF-IDF text similarity and
Bible cross-references, with at least half from other lessons. Clusters of related ideas come from Leiden
community detection.

**Yellow highlighting** uses word positions from the PDF text layer and two OCR passes (the second one reads coloured
lettering, Hebrew and Greek). The slide page also marks the other names and spellings the search matched, joins words split
into coloured pieces, repairs common OCR misreads, and says plainly when a slide was found by topic rather than by its words.

**Map of Ideas** (`/map/`): an expandable/collapsible mind map in columns (groups → ideas → connections, with lines),
an outline of every group and idea, and the story of the lessons in Bible order with the ideas carried from one lesson
to the next and a "train map" of the main threads.

## Data sources and licences

- Slides: © Dutch Uncle John.
- STEPBible.org TAHOT/TAGNT/TBESH/TBESG (Hebrew OT, Greek NT, Strong's lexicons), Tyndale House, CC BY 4.0.
- OpenBible.info cross-references, CC BY.
- King James Version, public domain.
- Fonts: Atkinson Hyperlegible, Frank Ruhl Libre, Gentium Book Plus, SIL OFL.

## Local preview

```bash
cd web && npx wrangler dev
```

Open <http://localhost:8787>. After a rebuild, restart `wrangler dev` so it picks up new file names.
