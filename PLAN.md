# Slide Study Library: Build & Deploy Plan

> **Status (18 Oct 2026): built.** See `README.md` for how to publish and maintain it. Decisions made after this plan was written:
> **no AI or LLM at runtime** (search is a client-side engine: BM25F + topic linking + Personalized PageRank graph + verse index,
> merged with weighted RRF), **no database or server code** (a static site on Cloudflare Workers Static Assets at a `*.workers.dev`
> address), **public but not indexable**, and lessons in the PDFs' own order. AI was used only while building, to read the slides;
> every Hebrew and Greek quotation was checked against the canonical text. Sections 3–10 below describe the original, heavier
> design and are kept for reference.

*A searchable, connected website for the 12 "Dutch Uncle John" Bible-study slide decks (1,443 slides), hosted on Cloudflare.*

Prepared 17 Oct 2026. Every number in this plan comes from inspecting the actual PDFs or from current Cloudflare/Anthropic documentation (sources at the end).

---

## 0. The short version

1. **The PDFs are PowerPoint slide decks, not documents.** There are 1,443 slides, all 16:9 (960×540 pt). **924 of them (64%) are pictures of slides with no text inside them.** On the slides that do have text, the **Hebrew comes out scrambled** because single letters are coloured differently, which breaks up the words. Any plan built on extracting the PDF text (the `pdf-parse` step in the original plan) would index about a third of the content, and that third would have broken Hebrew.
2. **Every slide is read by a vision AI model, then checked automatically.** Claude Sonnet 5.5 (through the Batch API) looks at each slide image and transcribes it. Bible verses are then compared against the real Hebrew and Greek Bible texts, and gematria arithmetic is recalculated. A one-time cost of about **$35–50** gets the whole library transcribed accurately.
3. **The site shows each slide exactly as it is in the PDF.** Each slide is rendered from the PDF to a pixel-identical image, and a hidden text layer is added for search, highlighting, screen readers and a "Read as text" view. Nothing is re-typed, so the colours, Hebrew, Greek, gematria grids and Bible-code grids all look exactly as John made them. Lossless WebP measured on these slides: **median 69 KB per slide.**
4. **The knowledge graph is designed around Bible study**, not generic "CONCEPT/ORGANIZATION" labels. Its node types are Bible verses, Hebrew and Greek words (linked to Strong's numbers), Hebrew letters and their pictographs, gematria numbers, people, places, events, themes and artworks. Each connection records where it came from: *the teacher's slide* or *reference data*. Public datasets (OpenBible cross-references, STEPBible lexicons) connect slides across decks even when the wording differs.
5. **Search combines four methods in one ranking:** keyword search, meaning-based search in many languages, graph search (the HippoRAG method), and exact Bible-verse lookup. The results are merged, spread across lessons, and each one says *why* it matched. An optional "Ask a question" mode gives a short answer that cites the slides it came from.
6. **Everything runs on Cloudflare, and nothing has to stay running.** The pages are pre-built static files, which Cloudflare serves free with no request limit. One small Worker handles search. D1 holds the search index and graph, Vectorize the meaning vectors, R2 the images, and Workers AI the query-time models. **$0/month on the free tier.** I recommend the **$5/month Workers Paid plan** once real users arrive, for more headroom.
7. **The interface is built for older, non-technical users.** It has one big search box, 20 px text, 48 px buttons with words on them (not just icons), large Previous/Next buttons, accepts misspellings, has no hover menus and no jargon. The "graph" appears as plain lists of **"Connected slides"**. The visual map is optional.
8. **Build time is about 6 weeks for one developer** working with Claude Code, in 7 phases with a quality check at the end of each.

---

## 1. What is actually inside the 12 PDFs (audit results)

I unzipped the archive to `source-pdfs/` and checked every page with PyMuPDF: text layer, images, fonts, writing systems and page sizes.

### 1.1 Inventory

| File | Slides | Text layer | Other scripts | Created |
|---|---:|---|---|---|
| Genesis-1.1-p1.pdf | 115 | **Images only** (1/115 pages have text) | Hebrew, Greek (inside images) | 2020-10 |
| Genesis-1.1-p2.pdf | 132 | **Images only** (0/132) | inside images | 2020-10 |
| Gods-Garden-in-Eden.pdf | 89 | **Images only** (0/89) | inside images | 2020-10 |
| Fall-of-Man-Genesis-3.pdf | 72 | **Images only** (0/72) | inside images | 2020-11 |
| What-you-should-know-about-Noah-Part-I.pdf | 78 | **Images only** (2/78) | inside images | 2020-11 |
| What-you-should-know-about-Noah-Part-2.pdf | 131 | **Images only** (0/131) | inside images | 2020-11 |
| Akeda-I-Binding-of-Isaac.pdf | 125 | **Images only** (2/125) | Hebrew | 2021-01 |
| Akeda-II-Briding-of-Isaac-1.pdf | 157 | **Mostly images** (21/157) | Hebrew | 2021-01 |
| Elijah-Elisha-Part-1-2.pdf | 88 | Real text (71/88) | Hebrew, Greek | 2021-03 |
| Abel-Slides.pdf | 185 | Real text (178/185) | Hebrew, Greek | 2021-11 |
| Red-Heifer-PDF.pdf | 127 | Real text (105/127) | Hebrew, Greek | 2022-11 |
| Genesis-1.1-Wisdom-Understanding.pdf | 144 | Real text (139/144) | Hebrew, Greek | 2024-05 |
| **Total** | **1,443** | **924 slides have no usable text** | | |

- All files were exported from Microsoft PowerPoint. There are no links, form fields or annotations. One file has 144 meaningless bookmarks in Russian ("Слайд 1…") left by a Russian-language PowerPoint export; we ignore them.
- In the image-only decks each slide is a 4:3 raster (often 2135×1650 px, JPEG or Flate) placed on the 16:9 page. That resolution is good enough for AI reading and for zooming.
- Rendering is fast: PyMuPDF renders 10 slides at 1920×1080 in 0.77 s, so all 1,443 slides take about 2 minutes.

### 1.2 What the slides contain

I viewed contact sheets of 16 slides from each deck. The recurring slide types are:

- **Verse slides.** A reference in English and Hebrew (`Genesis 4:1  ✡  בראשית ד:א`) or English and Greek (`Luke 3:38 ✝ ΛΟΥΚΑΝ 3:38`), the English verse with **colour-coded key words**, and the Hebrew or Greek original with matching colours.
- **Word studies.** A transliteration, the Hebrew word and the English meaning (`chava · חוה · Eve`, `dam · דם · Blood` / `adam · אדם · Man`), with the same colours linking languages.
- **Gematria.** Letter values and a total (`ore אור = 200+6+1 = 207`, `תמימה = 495`, `Ἰησοῦς = 888`), sometimes using *ordinal* values ("Ordinate Value … = 37").
- **Hebrew letter pictographs** in paleo-Hebrew (`alef = ox/strength, tav = cross/covenant`). These are drawn glyphs, not Unicode characters.
- **Bible-code (ELS) grids**, Hebrew calendars, genealogy lists, typology tables ("Two Seeds from Two Trees", "1st Adam / Last Adam").
- **Images**: Gustave Doré engravings, photos (Jerusalem, Temple Mount), video stills of the presenter as title slides ("Fall of Man 5", "7 Noah Part 2"), and humour slides (a "Coke is it!" logo, an OSHA joke).

### 1.3 Text-layer test (Red Heifer, slide 118)

The slide shows Numbers 19:2. This is what the PDF's built-in text gives you:

```
זאת חקת התורה אשר־צוה / והי ה לאמר / דבר ׀ אל־ / בני / ישר / לא ויקחו אליך פרה אדמה
```

"יהוה" comes out as "והי ה" and "ישראל" is split into "ישר … לא". This happens because John colours individual letters, and each colour change breaks the text run. **Conclusion: the PDF text layer cannot be used for Hebrew. English text from it is usable only as a cross-check.**

### 1.4 What this means for the design

| Finding | Design response |
|---|---|
| 64% of slides have no text layer | A vision AI transcribes every slide, the same way for all decks |
| Hebrew in the text layer is scrambled | Use the AI transcription for Hebrew, then check it against the real Bible text |
| Colour carries meaning (it links English to Hebrew) | Show the original slide image and never re-typeset. The AI also extracts the "colour-linked word pairs" as graph edges |
| The content is Bible-specific | Use a Bible-study ontology with verses, Strong's numbers, letters and gematria (§4) |
| Several languages and scripts (English, unpointed and pointed Hebrew, polytonic Greek, transliterations) | Multilingual embeddings (bge-m3), script-aware normalisation, and fuzzy matching of transliterations |
| Slides are short (about 50–70 words) and self-contained | **One slide is one retrieval unit.** No chunking, and every result points to an exact slide |
| The audience is older and not technical | Lists and big buttons come first; the graph picture is optional (§7) |

---

## 2. The original plan: what to keep and what to change

The original plan has the right idea: process the PDFs offline, then use hybrid search plus a graph and an LLM answer. Several of its choices don't fit this corpus or the "free and light on Cloudflare" requirement:

| Original | Recommended | Why |
|---|---|---|
| `pdf-parse`/`unpdf` text extraction in Node | **Python + PyMuPDF rendering, Claude vision transcription, and checks against the real Bible text** | 64% of slides have no text, and the Hebrew in the rest is scrambled (§1.3) |
| Supabase Postgres + pgvector | **Cloudflare D1 (SQLite + FTS5) + Vectorize** | Supabase **pauses free projects after 7 days of low activity**, which would take a quiet Bible-study site offline. Keeping everything on Cloudflare means one vendor, one deploy and no idle servers |
| Next.js on Pages/Vercel | **Astro static site + small Worker endpoints**, deployed as one Worker with static assets | Cloudflare serves static asset requests **free and without limit**. Free Workers get **10 ms of CPU** per request, which server-rendering every page would burn through. `@cloudflare/next-on-pages` has been replaced by OpenNext. Cloudflare bought Astro in Jan 2026, so Astro is a first-party framework there |
| react-pdf (PDF.js) viewer | **Pre-rendered slide images (lossless WebP/AVIF) + text overlay**; original PDF still downloadable | Pixel-identical, instant on old iPads, no 10 MB PDF download, and search words can be highlighted |
| 600-word chunks with a 100-word overlap | **One slide = one unit**, plus deck-level and topic-level summaries | Slides average about 60 words, so chunking would mix unrelated slides |
| Generic entity types (CONCEPT, METRIC, ORGANIZATION…) | **Bible-study ontology**: verse, Hebrew/Greek word, letter, number, person, place, event, theme, artwork | Generic types would miss what users actually look up: verses, words and gematria |
| Recursive SQL graph traversal at query time | **Graph scores computed offline** (Personalized PageRank, related slides) plus cheap lookups at query time | Keeps each request inside the 10 ms CPU budget. Better quality (HippoRAG-style) |
| Gemini `text-embedding-004` | **bge-m3 on Workers AI** (1024-dim, 100+ languages) | That model is retired. Using the same model at indexing and query time, at the edge, is about $0 per query and handles Hebrew and Greek |
| User pastes an API key into `localStorage` | **Server-side Workers AI** (optionally Claude through AI Gateway) | Older users can't manage API keys |
| Graph visualiser as the main screen | **"Connected slides" lists first**, a small diagram per topic, and the full map as an optional page | Older users do well with lists and poorly with force-directed graphs |

**Alternatives considered and rejected:** Neo4j or another graph database (too heavy for about 30k edges). Cloudflare AI Search / AutoRAG (its built-in PDF-to-markdown step would lose the image-only slides and the Hebrew, it has no graph, and it gives weak slide-level citations). Client-only search with Pagefind or Orama (no meaning-based or cross-language search). The Gemini free tier for transcription (Google may use free-tier content to improve its products, which is a concern for John's material).

---

## 3. Architecture

### 3.1 Overview

```
 OFFLINE (your Mac, re-run whenever a PDF is added)                ONLINE (Cloudflare)
 ──────────────────────────────────────────────────                ───────────────────────────────────────────
 source-pdfs/*.pdf                                                 Browser (iPad / PC / phone)
   │ 1 inventory + sha256 (idempotent)                               │  static HTML/CSS/JS  ←── Workers Static Assets
   │ 2 render 1920 px & 2880 px (PyMuPDF) ──► images ─────► R2 ─────►│  slide images        ←── R2 via media.<domain> (CDN-cached)
   │ 3 text layer + OCR geometry (word boxes for highlights)         │
   │ 4 Claude Sonnet 5.5 vision → structured JSON (Batch API)        │  /api/suggest  /api/search  /api/ask
   │ 5 validate: Bible ref parser, canonical-text alignment,         ▼
   │   gematria re-computation, English cross-check, review queue   ┌──────────── Worker (Astro endpoints) ───────────┐
   │ 6 entity resolution (Strong's, STEP names, aliases, LLM)       │ query analysis → 4 channels in parallel:        │
   │ 7 graph build + analytics (Leiden, PageRank, PPR, related)     │  ① D1 FTS5 BM25   ② Vectorize (bge-m3)          │
   │ 8 embeddings via Workers AI REST (bge-m3)                      │  ③ graph (precomputed PPR)  ④ exact verse index │
   │ 9 export: D1 SQL, Vectorize NDJSON, site JSON                  │ → weighted RRF → diversity → (rerank) → explain │
   └─10 publish: wrangler d1 / vectorize / R2 sync → build → deploy │ /api/ask → Workers AI LLM, cached, cited        │
                                                                    └──── D1 · Vectorize · Workers AI · AI Gateway ───┘
```

**Design principle:** anything that doesn't depend on the user's query is computed offline and shipped as static files. That covers slide pages, verse indexes, word pages, topic pages, related slides and graph layouts. The Worker only handles what does depend on the query, so it stays cheap and fast.

### 3.2 Stack

| Layer | Choice | Notes |
|---|---|---|
| Offline pipeline | **Python 3.12 + uv**, PyMuPDF, Pillow (WebP/AVIF), Tesseract (`eng`+`heb`+`grc`, for word boxes), `anthropic` SDK, igraph + leidenalg, rapidfuzz, pydantic | Python has the best libraries for PDF, OCR and graph work. Pydantic models generate the JSON Schema, which then generates the TypeScript types |
| Transcription and extraction | **Claude Sonnet 5.5**, Message Batches API (50% off), JSON-schema structured output; Opus 5.5 re-runs low-confidence slides | Reads up to 2576 px images directly. In Phase 0 we compare it against a Gemini Flash model on 40 hard slides and score both against the canonical text |
| Website | **Astro 6** (static output) + `@astrojs/cloudflare` endpoints; Preact islands; PhotoSwipe (zoom); Sigma.js (optional map page) | Ships almost no JavaScript, and every slide is a real URL you can bookmark, email or print |
| API | Astro server endpoints in the same Worker (`prerender = false`) | One deploy. Static requests never wake the Worker |
| Keyword search | **D1 FTS5** (`unicode61 remove_diacritics 2`, prefix indexes, `bm25()` column weights) | The search CPU runs inside D1, not inside the Worker |
| Meaning-based search | **Vectorize** (cosine, 1024-d) + **`@cf/baai/bge-m3`** | Multilingual. Embedding a query costs a tiny fraction of a neuron. Phase 0 compares it with `qwen3-embedding-0.6b` and `embeddinggemma-300m` |
| Reranker (optional, kept only if tests show a gain) | `@cf/baai/bge-reranker-base` | Applied only to English-text candidates |
| Answer model | Workers AI: test `@cf/google/gemma-4-26b-a4b-it`, `@cf/qwen/qwen3-30b-a3b-fp8` and `@cf/openai/gpt-oss-120b`; optionally Claude Haiku 4.5 through AI Gateway | Picked by answer-quality tests. Routed through AI Gateway for caching, logs and rate limits |
| Images and PDFs | **R2** + custom domain `media.<domain>`, content-hashed filenames, `Cache-Control: immutable` | 10 GB free and no bandwidth charges |
| Auth (only if the site is private) | Cloudflare Access with an email one-time PIN (free up to 50 users), month-long session | No passwords for older users to remember |

### 3.3 Free-tier budget (based on this corpus)

| Resource | Free allowance | Our expected use | Headroom |
|---|---|---|---|
| Static asset requests (pages, JS, CSS) | **Unlimited, free** | All page views | ∞ |
| Worker requests | 100,000/day | Search, suggest and ask calls only | Large |
| Worker CPU | 10 ms per request | About 2–5 ms (everything else is waiting on I/O) | OK; Paid plan gives 30 s |
| D1 storage | 500 MB per database | About 30–60 MB | 10× |
| D1 rows written | 100,000/day | Initial load about 40–60k rows (graph data packed as JSON blobs) | OK |
| D1 rows read | 5M/day | About 300–800 per search | About 6–10k searches/day |
| Vectorize stored | 5M dimensions | about 3,000 vectors × 1024 ≈ 3.1M (slides + meaning-bearing entities + topics) | OK |
| Vectorize queried | 30M dimensions/month, counted as (stored + queries) × dims | About 26,000 searches/month | OK for a community site; repeat queries are edge-cached |
| Workers AI | 10,000 neurons/day | Search ≈ 2–3 neurons (embedding + rerank). AI answer ≈ 40–150 neurons, depending on model | About 3,000 searches/day **or** about 70–250 AI answers/day |
| R2 | 10 GB, 1M writes, 10M reads/month | About 400 MB of images + 72 MB of PDFs. Reads are mostly served from the CDN cache | Large |

**Measured image sizes** (36 random slides rendered at 1920×1080): PNG median 132 KB · **lossless WebP median 69 KB (≈155 MB for all slides)** · WebP q88 66 KB · AVIF q70 42 KB · 960-px WebP 28 KB · 320-px thumbnail 6 KB.

---

## 4. The knowledge model (the "graph")

### 4.1 Node types

| Type | Key (deterministic where possible) | Examples from the corpus |
|---|---|---|
| `deck` (lesson) | slug | `red-heifer`, `akedah-2`, `genesis-1-1-part-1` |
| `slide` | `deck/n` | `red-heifer/118` |
| `verse`, plus `chapter` and `book` | OSIS ID | `Num.19.2`, `Gen.22.13`, `Heb.9.13`; ranges are expanded to individual verses |
| `hword` (Hebrew word or lemma) | Strong's number (STEPBible TBESH) or the consonantal form | `חוה` *chavah* "Eve" · `תמימה` "unblemished" · `את` *alef-tav* |
| `gword` (Greek word) | Strong's G-number | `λόγος`, `ἄνθρωπος`, `Ἰησοῦς` |
| `letter` | fixed list of 22 Hebrew + 24 Greek letters | `alef` (ox, strength, value 1), `tav` (mark/cross, 400) |
| `number` | integer, plus the gematria method | `207`, `495`, `888`, `13`, `40` |
| `person` / `place` / `event` | STEPBible TIPNR ID where one exists | Abel, Cain, Eliezer, Yeshua · Eden, Moriah, Beersheba · the Flood, the Akedah |
| `theme` / `thing` | resolved name | sacrifice, blood, seed, clean/unclean · red heifer, ark, hyssop, ram |
| `artwork` | title + artist | Doré, *Cain and Abel Offering Their Sacrifices* (1870) |
| `topic` | Leiden community ID | for example, "Substitutionary sacrifice: from the Akedah to the Red Heifer" |

### 4.2 Edge types, and where each connection comes from

Every edge stores `source ∈ {slide, lexicon, crossref, computed}` along with the slide it came from. The site shows **"From the slides"** and **"Reference"** connections separately. This keeps John's interpretations clearly apart from standard reference facts, and stops the AI from putting words in his mouth.

| Edge | Source | Meaning |
|---|---|---|
| slide `CITES` verse (role: quoted / referenced) | slide | The verse appears on the slide |
| slide `DEFINES` hword/gword (gloss, transliteration as shown) | slide | A word-study box |
| slide `MENTIONS` person/place/event/theme/thing | slide | Weighted by prominence (title > body > image) |
| hword `LINKED_BY_COLOR` English phrase | slide | The colour-matched pair (Eve ↔ חוה) |
| hword `HAS_GEMATRIA` number (method) | slide + computed | Verified by re-computing the arithmetic |
| hword `WORDPLAY` / `SHARES_LETTERS` hword | slide | The teacher's link (דם ⊂ אדם; אור "light" / עור "skin") |
| person `TYPE_OF` / `CONTRASTS_WITH` person | slide | Typology ("Two seeds": Cain ↔ Abel/Shem, Ishmael ↔ Isaac) |
| person `PARENT_OF` / `SPOUSE_OF` | lexicon (TIPNR) | Genealogy |
| hword `SAME_ROOT` hword · hword `STRONGS` lemma | lexicon | Standard lexicon facts |
| verse `CROSS_REF` verse (weighted by votes) | crossref (OpenBible.info) | Connects decks that discuss related passages |
| slide `NEXT` slide | computed | Reading order |
| slide `RELATED` slide (score, reasons) | computed | §6.5 |
| entity `IN_TOPIC` topic | computed | Leiden communities |

### 4.3 External reference data (open licences)

| Dataset | Use | Licence |
|---|---|---|
| Open Scriptures Hebrew Bible (WLC + morphology) | Check the Hebrew transcriptions, map Hebrew to lemma and Strong's numbers | CC BY 4.0 |
| SBLGNT or Nestle 1904 Greek NT | Check the Greek transcriptions | CC BY 4.0 / public domain |
| STEPBible TBESH / TBESG (lexicons), TAHOT/TAGNT (tagged text), TIPNR (proper names) | Strong's numbers, glosses, people and places with all their references | CC BY 4.0 |
| OpenBible.info cross-references (based on the Treasury of Scripture Knowledge, community-scored with votes) | Verse-to-verse edges, filtered by vote count | CC BY |
| Bible Passage Reference Parser (openbibleinfo, v4.0.0) | Parse "Gen 4:1-2", "Jn 3 16" and similar into OSIS IDs | MIT |

Two small tables we write ourselves: **Hebrew book names** (`בראשית`→Gen, `במדבר`→Num, `תהילים`→Ps…) with Hebrew-numeral chapter and verse parsing (`יט:ב` → 19:2, with `טו`/`טז` handled), and **Greek book names** (`ΛΟΥΚΑΝ`, `ΕΒΡΑΙΟΥΣ`, `Ἰωάνης`, `ΘΕΣΣΑΛΟΝΙΚΕΙΣ Β`…).

### 4.4 Expected size

About 2,500–4,000 entities, about 15–20k slide→entity mentions, about 25–35k edges including the cross-references we keep (only those touching verses in the corpus, plus one hop), and about 60 topics. **That fits comfortably in SQLite, so no graph database is needed.**

---

## 5. Offline processing pipeline

Each step is a command (`uv run kg <step>`) that caches its output under `ingest/out/` by **content hash**. Re-running is therefore cheap, and adding one PDF only processes that PDF.

**5.1 Inventory.** Record the deck slug, a cleaned title (fixing typos such as "Briding" → "Binding"), series and part, Bible order, slide count and a sha256 hash, in `decks.yaml`. The client can edit this file to set titles and order.

**5.2 Render.** PyMuPDF renders each page at 1920×1080 and 2880×1620 (for zoom). From those we produce lossless WebP at 1920, AVIF at 1920 (if it passes the fidelity check), WebP q85 at 960, a WebP thumbnail at 320, and a 32-px blur placeholder stored inline. **Fidelity check:** an SSIM score of at least 0.995 against the PNG master, else fall back to lossless. Filenames include the content hash.

**5.3 Text layer and word boxes.**
- For text decks, PyMuPDF `get_text("words")` gives English words with exact positions.
- For image decks, Tesseract (`eng+heb+grc`) gives word positions only. We don't trust its text; it is matched to the AI transcription afterwards.
- The result is `boxes[]`: normalised (0–1) word rectangles, used to draw yellow highlights over search terms on the slide image.

**5.4 Vision transcription.** Claude Sonnet 5.5 through the Batch API (50% off), with structured JSON output. Each request contains the slide image (1920 px, or 2576 px for dense slides such as Bible-code grids and calendars), the deck title, the previous and next slide titles (for context), the text layer as a *hint* when one exists, and the schema. Prompt rules:
- Transcribe exactly. Hebrew in logical (reading) order. Keep maqaf, paseq and sof pasuq. **Never add vowel points that aren't on the slide.** Mark uncertain letters `[?]`.
- Split the content into blocks by language: `en`, `he`, `el`, `translit`.
- Give every scripture reference as shown, plus normalised.
- List word-study boxes (word, transliteration, gloss) and gematria (letters, values, total, method).
- **Colour-linked pairs:** words in one language that share a colour with words in another.
- Describe images, diagrams and pictographs in words. Don't identify people; title slides are tagged "presenter video still".
- Assign the slide's kind(s), a short title, a 1–2 sentence plain-English summary, and self-rated confidence per script.

**A real example.** This is Red Heifer slide 118, which I transcribed by looking at the rendered slide:

```json
{
  "slide_id": "red-heifer/118",
  "kinds": ["verse", "word-study", "gematria"],
  "title": "Numbers 19:2: unblemished, without defect, never yoked",
  "blocks": [
    {"lang": "en", "role": "reference", "text": "Numbers 19:2"},
    {"lang": "he", "role": "reference", "text": "במדבר יט:ב"},
    {"lang": "he", "role": "verse", "osis": "Num.19.2",
     "text": "זאת חקת התורה אשר־צוה יהוה לאמר דבר ׀ אל־בני ישראל ויקחו אליך פרה אדמה תמימה אשר אין־בה מום אשר לא־עלה עליה על׃"}
  ],
  "scripture_refs": [{"shown": ["Numbers 19:2", "במדבר יט:ב"], "osis": "Num.19.2", "role": "quoted"}],
  "word_studies": [
    {"lang": "he", "word": "תמימה", "gloss": "Unblemished",
     "gematria": {"method": "standard", "values_shown": [5, 40, 10, 40, 400], "total_shown": 495, "recomputed": 495, "ok": true}},
    {"lang": "he", "word": "אין־בה מום", "gloss": "Without Defect"},
    {"lang": "he", "word": "לא־עלה עליה על", "gloss": "No Yoke"}
  ],
  "color_links": [
    {"color": "pink",  "he": "תמימה", "en": "Unblemished"},
    {"color": "brown", "he": "אין־בה מום", "en": "Without Defect"},
    {"color": "ochre", "he": "לא־עלה עליה על", "en": "No Yoke"},
    {"color": "red",   "he": "פרה אדמה", "en": null}
  ],
  "entities": [
    {"type": "thing", "name": "Red heifer", "aliases": ["parah adumah", "פרה אדמה"]},
    {"type": "theme", "name": "Without blemish"},
    {"type": "number", "value": 495}
  ],
  "visual": "White slide. Verse header with a blue Star of David between the English and Hebrew references. Hebrew verse with the three requirements colour-coded to the English glosses below.",
  "summary": "Numbers 19:2 in Hebrew, highlighting the three requirements for the red heifer: unblemished (תמימה, gematria 495), without defect, and never yoked.",
  "confidence": {"en": 0.99, "he": 0.95}
}
```

This matches the consonantal Westminster Leningrad Codex text of Numbers 19:2 exactly, and 400+40+10+40+5 = 495 checks out. Compare it with the scrambled text layer in §1.3.

**5.5 Validation and automatic correction**
1. **References.** Run the reference parser on the English, plus our Hebrew and Greek book tables. If the parsed English and Hebrew references disagree, send the slide for review.
2. **Canonical alignment.** For each verse block, compute the character error rate against WLC (with vowel points stripped when the slide has none) or SBLGNT/Nestle 1904 (accents normalised). If the error rate is at most 15%, **replace the text with the canonical spelling** (keeping the slide's pointing style) and log the change. Above 15%, re-run on Opus 5.5 and send it to review. *This turns Hebrew OCR from "probably right" into "verified against the Bible text."*
3. **Gematria.** Re-compute with standard, ordinal (*mispar siduri*), reduced and Greek isopsephy values. If what the slide shows matches one of them, record the method. If none match, flag it. We never silently "fix" the teacher's arithmetic.
4. **English cross-check.** Compare the AI text with the PDF text layer where one exists (word error rate under 3% expected).
5. **Review queue.** Anything with confidence below 0.85 or a failed check goes into a small local review page that shows the slide image beside editable fields. Corrections are saved to `overrides/*.yaml`, which **every re-run applies**, so a human correction is never lost.

**5.6 Entity resolution**
- **Exact keys first:** verses (OSIS), letters, numbers, and Hebrew/Greek words matched to Strong's numbers through STEPBible (consonantal form plus gloss).
- **Fuzzy matching for the rest:** group candidates by type. Score pairs using character n-grams, Jaro-Winkler on a **transliteration key** (`ch/kh/h→h`, double letters collapsed, final `-ah→-a`, so *chava = hava = chavah*), bge-m3 cosine similarity, and alias lists (Yeshua = Jesus = Ἰησοῦς = ישוע; Akeda = Akedah = Binding of Isaac). Pairs scoring 0.75–0.9 are decided by Sonnet. Clusters are formed with union-find. The canonical name comes from TIPNR or the lexicon, otherwise the most frequent form.

**5.7 Graph assembly.** Combine the slide edges, the reference edges (TIPNR, lexicon, OpenBible cross-references above a vote threshold) and the computed edges into one weighted, multi-type graph. Every edge keeps where it came from.

**5.8 Graph analytics** (igraph/leidenalg; minutes on a laptop)
- **Topics.** Leiden clustering on the entity co-occurrence graph, weighted by NPMI across slides, tuned to give about 40–60 topics in two levels. Sonnet writes each topic a plain-English title and a 2-sentence summary from its most central slides.
- **Importance.** PageRank, used to size nodes and as a small ranking prior.
- **Personalised PageRank per entity** (HippoRAG 2 style). On the combined slide + entity graph, with damping 0.5, we keep each entity's top 100 slides and top 30 entities. Because **PPR is linear in the seed vector**, a query with several seed entities is just the weighted *sum* of the stored vectors. The Worker gets multi-hop graph search for a few additions.
- **Related slides** (top 8 per slide; at least 4 from *other* lessons):
  `S(a,b) = 0.45·Σ_e idf(e)·w_a(e)·w_b(e)/‖·‖  +  0.30·cos(v_a,v_b)  +  0.20·xref(a,b)  +  0.05·adjacent(a,b)`
  Each pair stores its top reasons, e.g. *"Both cite Genesis 22:13"* or *"Both explain the Hebrew word את (alef-tav)"*.
- **Layout.** ForceAtlas2 coordinates for the optional map, plus a small pre-drawn SVG connections diagram for each entity and topic page (no JavaScript needed).

**5.9 Embeddings.** bge-m3 through the Workers AI REST API (the same model the Worker uses for queries). Three kinds of vectors:
- **slide**: built from the title, English text, transliterations, glosses, Hebrew and Greek without diacritics, the image description and the summary.
- **entity**: only the meaning-bearing ones (people, places, themes, things, words). Verses, numbers and letters are matched exactly instead.
- **topic.**

Metadata stored with each vector: `kind`, `deck`.

**5.10 Export and publish.**
- `out/d1/*.sql` (batched, under 100 KB per statement) → `wrangler d1 execute --remote --file`.
- `out/vectorize/*.ndjson` → `wrangler vectorize insert`.
- Images → R2 with rclone (S3 API, parallel, skips files already there).
- `out/site/*.json` → read by Astro at build time.

**5.11 Cost of the one-time AI processing** (Batch prices: Sonnet 5.5 $1 in / $5 out per million tokens; a 1920×1080 image is about 2,700 tokens)

| Pass | Volume | Estimate |
|---|---|---|
| Transcription (Sonnet 5.5) | 1,443 × (~5.5k in + ~1.5k out) | **≈ $19** |
| Re-runs on Opus 5.5 (~10% of slides) | ~150 slides | ≈ $5 |
| Entity decisions, topic and deck summaries | text only | ≈ $8–12 |
| Embeddings (Workers AI) | ~3k vectors | ≈ $0 |
| **Total** | | **≈ $35–50 once** (about $2–3 for each new 120-slide deck) |

---

## 6. Search engine (what happens on a query)

### 6.1 Understanding the query (pure CPU, under 1 ms)
- **Bible reference?** Parse it ("gen 22", "Genesis 22:13", "jn 3 16", "במדבר יט"). If the whole query is a reference, the verse channel gets 3× weight and the page offers **"Go to Genesis 22 in the verse index."**
- **Script detection.** Hebrew: strip vowel points and cantillation (U+0591–U+05C7), map final letters, turn maqaf into a space. Greek: NFD, drop accents and breathings, lowercase, map final sigma. **The same normalisation code runs in Python and TypeScript**, and shared test vectors make sure they agree.
- **Transliteration key and spelling.** Use the transliteration key from §5.6. Suggest corrections from an FTS5 trigram index over the corpus vocabulary ("Did you mean *Melchizedek*?").
- **Entity linking.** Match the alias table (exact, prefix or fuzzy) to get seed entities with confidence scores.
- **Intent** (`reference | word | entity | question | phrase`) sets the channel weights. A full question routes to Ask mode when it is enabled.

### 6.2 Four channels, run in parallel (`Promise.all`)

| # | Channel | How | Strength |
|---|---|---|---|
| ① | **Keyword** | D1 FTS5 `bm25(slide_fts, …weights)` over title (8), keywords and aliases (5), English (4), transliteration, Hebrew and Greek (3), summary (2), visual description (1.5). AND first, OR if there are fewer than 5 hits. Prefix matching for autocomplete | Exact words and names; Hebrew typed directly |
| ② | **Meaning** | bge-m3 query embedding → Vectorize top 50 slides and top 10 entities (the entity hits also feed ③) | Paraphrases, cross-language matches ("lamb without spot" → תמימה) |
| ③ | **Graph** | Seed entities → Σ wᵢ·PPR(entityᵢ) from packed rows → slide scores | Multi-hop connections across lessons |
| ④ | **Verse** | Exact OSIS lookup in `verse_index`, plus cross-referenced verses at reduced weight | "Show me everything on Genesis 22" |

### 6.3 Merging, spreading and explaining results
- **Weighted reciprocal-rank fusion:** `score(s) = Σ_c w_c(intent) / (60 + rank_c(s))`. Weights are tuned by grid search on the test question set (§11).
- **Diversity (MMR, λ = 0.7):** stops one lesson from filling the first page.
- **Optional rerank** of the top 30 with bge-reranker-base, kept only if it improves nDCG@10 in tests.
- **Explanation:** each result carries reasons such as *"cites Numbers 19:2"*, *"Hebrew word תמימה"* or *"related to: Akedah"*, a highlighted snippet, and the word boxes to highlight on the slide image.
- **Caching:** the Cache API stores results by normalised query for 24 hours at the edge, so a repeated query costs no D1, Vectorize or AI usage.
- **Degrading gracefully:** if the AI or vector quota runs out, the keyword, graph and verse channels still return results.

### 6.4 "Ask a question" (optional; can be switched off)
1. Retrieve as above and take the top 8 slides.
2. Build a prompt from their transcriptions, labelled `[S1]…[S8]`.
3. The system rule: *"Answer only from these slides, in plain English, in 3–6 sentences. Cite [S#] after each claim. If the slides don't cover it, say so."*
4. Stream the answer (Server-Sent Events). **Check the citations afterwards:** any `[S#]` not among the supplied slides is removed.
5. Show the answer under the heading **"Summary from the slides (AI-generated: check the slides below)"** with big thumbnails of the cited slides.
6. Cache answers in D1 by normalised question. Rate-limit per IP with the Workers Rate Limiting binding. Keep a daily neuron budget; when it's used up, show search results only.

### 6.5 Computed offline, served as static pages
"Connected slides" on every slide page; "Every slide on this verse" pages (a Bible-order concordance); "Word study" pages (every slide that uses `את`, with its gematria and lexicon entry); person, place and topic pages, each with its small connections diagram. **None of these use the Worker at all.**

### 6.6 Performance targets
Search p50 under 300 ms and p95 under 800 ms worldwide. Worker CPU under 5 ms. Slide page LCP under 1.2 s on 4G (thumbnail placeholder, then the 960 px image, then the 1920 px image). Lighthouse at least 95 for Performance and 100 for Accessibility.

---

## 7. Website and user experience for older users

### 7.1 Design rules

| Area | Rule |
|---|---|
| Type | 20 px base text, 1.6 line height, headings 28–40 px. **Atkinson Hyperlegible** (designed by the Braille Institute for low vision) for the interface. Frank Ruhl Libre / Noto Serif Hebrew for Hebrew, Gentium Book Plus for Greek |
| Text size control | **A / A+ / A++** buttons in the header, remembered on the device |
| Contrast | At least 7:1 for text (WCAG AAA). Visible 3 px focus rings |
| Buttons | At least 48×48 px with 8 px spacing, and **always a word with any icon** ("◀ Previous slide", not "◀") |
| Navigation | The same header everywhere: *Home · Lessons · Bible Verses · Hebrew & Greek Words · Topics · Help*. A plain-language breadcrumb ("Lessons › The Red Heifer › Slide 118 of 127"). No hover menus or carousels; on mobile, a labelled "Menu" button |
| Forgiving input | Misspellings, "gen 4 1", Hebrew typed with or without vowel points, transliteration variants. **Never a dead end:** zero results always offers suggestions and topics |
| Language | No jargon. "Connections", not "knowledge graph"; "Topics", not "communities"; "Words", not "entities" |
| Movement | Keyboard ← →, swipe on tablets, big on-screen buttons, no timeouts, no surprise pop-ups |
| Sharing and printing | "Email this slide" (mailto with the link) and "Print this slide" (a print layout with the slide plus its text) |
| Help | A one-page illustrated guide, a 60-second video, and a contact line |
| Install | A PWA manifest so the site can sit on an iPad home screen with a big icon. Recently viewed slides work offline |

### 7.2 Site map

```
/                         Home: search box, example searches, lessons in Bible order
/lessons/                 All lessons (Bible order or date order), big cards
/lessons/red-heifer/      Lesson overview: summary, grid of numbered thumbnails, "Download original PDF"
/lessons/red-heifer/118   Slide page (the main screen)
/verses/                  Bible books → chapters → verses, each with a slide count
/verses/num/19            Numbers 19: every slide that cites it, verse by verse
/words/                   Hebrew and Greek words A–Z (transliteration, script, meaning)
/words/h8549-tamim        One word: every slide, gematria, lexicon entry, connected words
/people/ /places/ /topics/  Entity pages with connected slides and a small diagram
/search?q=…               Results (keyword + meaning + graph + verse)
/ask                      Ask a question (optional)
/map                      Optional interactive map of connections (Sigma.js, loads only here)
/help
```

### 7.3 Main screens (wireframes)

**Home**
```
┌──────────────────────────────────────────────────────────────────────────┐
│ Dutch Uncle John's Bible Study Slides                     [A] [A+] [A++] │
│ Home · Lessons · Bible Verses · Hebrew & Greek Words · Topics · Help     │
├──────────────────────────────────────────────────────────────────────────┤
│                 What would you like to find?                             │
│   ┌──────────────────────────────────────────────────┐ ┌────────────┐    │
│   │ A word, a name, or a Bible verse…                │ │  🔍 Search  │    │
│   └──────────────────────────────────────────────────┘ └────────────┘    │
│   Try:  [ Genesis 22 ]  [ red heifer ]  [ alef tav ]  [ Noah's raven ]   │
│                                                                          │
│   Lessons, in Bible order                                                │
│   [thumb] In the Beginning (Gen 1:1), Part 1 · 115 slides                │
│   [thumb] In the Beginning (Gen 1:1), Part 2 · 132 slides   …            │
└──────────────────────────────────────────────────────────────────────────┘
```

**Slide page**
```
Lessons › The Red Heifer › Slide 118 of 127
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│          [ the slide, exactly as in the PDF ]                │
│          search words highlighted in yellow · tap to zoom    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
[ ◀ Previous slide ]        Slide 118 of 127        [ Next slide ▶ ]
[ 🔍 Zoom ]   [ 📄 Read as text ]   [ 🖨 Print ]   [ ✉ Email this slide ]

On this slide
  Bible verse   [ Numbers 19:2 ]  → see every slide on this verse
  Hebrew words  [ תמימה · "unblemished" · 495 ]  [ פרה אדמה · "red heifer" ]
  Topics        [ The Red Heifer ]  [ Without blemish ]

Connected slides in other lessons
  [thumb] <Lesson> · Slide N   Why: both cite <verse> / both explain <word>
  [thumb] …                    (8 items, at least 4 from other lessons)
```

**Search results**
```
Results for "red heifer"    (also searched: פרה אדמה · parah adumah)
Best matches
  [big thumb]  The Red Heifer · Slide 34
               "The Ordinance of the Red Heifer is the most mysterious of the chukat…"
               Why: title match · Numbers 19
  …
Bible verses on this subject:   [ Numbers 19 (many slides) ]  [ Hebrews 9:13-14 ]
Related words and people:       [ hyssop ]  [ Eleazar ]  [ תמימה ]
```

### 7.4 Front-end notes
- Slides use `<picture>`: AVIF, then WebP, with `srcset` at 960, 1920 and 2880 px; explicit width and height (no layout shift); a blur placeholder.
- Highlights are absolutely positioned boxes from the normalised `boxes[]`, scaled with the image.
- "Read as text" shows each language block with `lang="he" dir="rtl"`. It doubles as the screen-reader text; the image `alt` is the one-line summary.
- JavaScript budget: about 15 KB on slide pages (zoom, keyboard, highlights) and about 25 KB on search (Preact search box). The map page loads Sigma.js on demand.
- If the site is public, each static slide page includes its transcription and JSON-LD (`PresentationDigitalDocument`), so search engines can send people straight to the right slide.

---

## 8. Database schema (D1 / SQLite)

```sql
-- migrations/0001_init.sql
CREATE TABLE deck (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, series TEXT, part INT, bible_order INT,
  slide_count INT NOT NULL, pdf_key TEXT NOT NULL, sha256 TEXT NOT NULL, summary TEXT
);
CREATE TABLE slide (
  id TEXT PRIMARY KEY,                    -- 'red-heifer/118'
  deck_id TEXT NOT NULL REFERENCES deck(id), n INT NOT NULL,
  title TEXT, kinds TEXT, summary TEXT,   -- kinds: JSON array
  img_key TEXT NOT NULL, thumb_key TEXT NOT NULL, boxes TEXT,  -- boxes: JSON (normalised word rects)
  confidence REAL, reviewed INT DEFAULT 0, UNIQUE(deck_id, n)
);
CREATE VIRTUAL TABLE slide_fts USING fts5(
  slide_id UNINDEXED, title, keywords, body_en, translit, hebrew, greek, summary, visual,
  tokenize = "unicode61 remove_diacritics 2", prefix = '2 3'
);
CREATE TABLE entity (
  id TEXT PRIMARY KEY,                    -- 'hword:H8549', 'person:abel', 'verse:Num.19.2', 'number:495'
  type TEXT NOT NULL, label TEXT NOT NULL, label_he TEXT, label_el TEXT, translit TEXT,
  gloss TEXT, description TEXT, strongs TEXT, osis TEXT, value INT,
  slide_count INT DEFAULT 0, pagerank REAL DEFAULT 0, topic_id TEXT
);
CREATE TABLE alias (alias_norm TEXT NOT NULL, entity_id TEXT NOT NULL, alias TEXT, lang TEXT,
  PRIMARY KEY (alias_norm, entity_id)) WITHOUT ROWID;
CREATE VIRTUAL TABLE entity_fts USING fts5(entity_id UNINDEXED, label, aliases, gloss,
  tokenize = "unicode61 remove_diacritics 2", prefix = '2 3');
CREATE TABLE mention (slide_id TEXT NOT NULL, entity_id TEXT NOT NULL, role TEXT NOT NULL, weight REAL NOT NULL,
  PRIMARY KEY (slide_id, entity_id, role)) WITHOUT ROWID;
CREATE INDEX mention_by_entity ON mention(entity_id, weight DESC);
CREATE TABLE edge (src TEXT NOT NULL, rel TEXT NOT NULL, dst TEXT NOT NULL, weight REAL NOT NULL,
  source TEXT NOT NULL, slide_id TEXT, evidence TEXT, PRIMARY KEY (src, rel, dst, source));
CREATE INDEX edge_by_dst ON edge(dst, rel);
CREATE TABLE verse_index (osis TEXT NOT NULL, book INT, chapter INT, verse INT, slide_id TEXT NOT NULL, role TEXT,
  PRIMARY KEY (osis, slide_id)) WITHOUT ROWID;
CREATE TABLE crossref (from_osis TEXT, to_osis TEXT, votes INT, PRIMARY KEY (from_osis, to_osis)) WITHOUT ROWID;
-- Graph data packed as JSON so row writes stay small (free tier allows 100k writes/day):
CREATE TABLE ppr_pack (entity_id TEXT PRIMARY KEY, slides TEXT NOT NULL, entities TEXT NOT NULL); -- [[slide_id,score],…]
CREATE TABLE topic (id TEXT PRIMARY KEY, parent_id TEXT, title TEXT, summary TEXT, size INT);
CREATE TABLE vocab_fts_src (term TEXT PRIMARY KEY, freq INT);           -- spelling suggestions
CREATE VIRTUAL TABLE vocab_fts USING fts5(term, tokenize = 'trigram'); -- tested in Phase 0
CREATE TABLE answer_cache (qhash TEXT PRIMARY KEY, question TEXT, answer TEXT, slide_ids TEXT,
  model TEXT, created_at TEXT, hits INT DEFAULT 0);
CREATE TABLE query_log (ts TEXT, q TEXT, intent TEXT, n INT, clicked TEXT, helpful INT); -- no personal data
```

Related slides, entity pages and verse pages are static files, so they don't need tables in D1.

### Search core (TypeScript, in the Worker)

```ts
export async function search(env: Env, raw: string, limit = 20) {
  const q = analyzeQuery(raw);                       // refs, script, translit key, aliases, intent (<1 ms CPU)
  const [kw, sem, graph, verse] = await Promise.all([
    keywordChannel(env.DB, q),                       // FTS5 bm25 with column weights, AND→OR fallback
    semanticChannel(env.AI, env.VEC, q),             // bge-m3 → Vectorize (slides + entities)
    graphChannel(env.DB, q),                         // Σ w_i · PPR(seed_i) from ppr_pack
    verseChannel(env.DB, q),                         // exact OSIS + cross-refs (down-weighted)
  ]);
  const fused = weightedRRF({ kw, sem, graph, verse }, WEIGHTS[q.intent], 60);
  const diverse = mmrByDeck(fused, 0.7).slice(0, 30);
  const ranked = env.RERANK === "on" ? await rerank(env.AI, q.text, diverse) : diverse;
  return explain(ranked.slice(0, limit), q);         // reasons, snippet, highlight boxes
}
```

---

## 9. Repository layout

```
fahads-pdf-sync/
├─ source-pdfs/                 # originals (kept out of git; stored in R2 too)
├─ ingest/                      # Python 3.12 + uv
│  ├─ kg/ inventory.py render.py textlayer.py ocr_boxes.py transcribe.py schema.py
│  │      bible/{refparse.py, hebrew_numerals.py, books_he_el.yaml, canon_align.py, gematria.py}
│  │      resolve.py graph.py embed.py export.py publish.py review_app.py
│  ├─ refdata/                  # OSHB, SBLGNT, STEPBible TSVs, OpenBible cross-refs (scripted download)
│  ├─ decks.yaml  overrides/    # human-editable titles/order and corrections (in git)
│  └─ out/                      # generated, content-hash cached (git-ignored; backed up to R2)
├─ web/                         # Astro 6 + @astrojs/cloudflare
│  ├─ src/pages/  index · lessons/[deck]/index · lessons/[deck]/[n] · verses/… · words/… · topics/… · search · ask · map · help
│  ├─ src/pages/api/  suggest.ts · search.ts · ask.ts · feedback.ts     (prerender = false)
│  ├─ src/lib/retrieval/  analyze.ts normalize.ts refparse.ts channels/*.ts rrf.ts mmr.ts explain.ts
│  ├─ src/components/  SlideViewer · SearchBox · ConnectionsList · ConnectionsSvg · TextSize · AskPanel
│  ├─ migrations/  0001_init.sql
│  └─ wrangler.jsonc
├─ shared/  normalize-test-vectors.json  schema.json (generated from pydantic)
├─ eval/    golden.yaml  run_eval.ts  report.md
└─ .github/workflows/  ci.yml  deploy.yml
```

---

## 10. Deployment and DevOps

### 10.1 One-time Cloudflare setup
```bash
npm i -g wrangler && wrangler login
wrangler d1 create slide-library
wrangler vectorize create slides-bge-m3 --dimensions=1024 --metric=cosine
wrangler vectorize create-metadata-index slides-bge-m3 --property-name=kind --type=string
wrangler vectorize create-metadata-index slides-bge-m3 --property-name=deck --type=string
wrangler r2 bucket create slide-media
# Dashboard: add the domain; connect R2 custom domain media.<domain>; cache rule "cache everything, edge TTL 1y"
# Dashboard: create an AI Gateway "slide-library" (caching + rate limit + logs)
```

### 10.2 `web/wrangler.jsonc` (outline; the exact paths follow the Astro Cloudflare adapter docs)
```jsonc
{
  "name": "slide-library",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "directory": "./dist", "binding": "ASSETS", "not_found_handling": "404-page" },
  "d1_databases": [{ "binding": "DB", "database_name": "slide-library", "database_id": "<id>", "migrations_dir": "migrations" }],
  "vectorize": [{ "binding": "VEC", "index_name": "slides-bge-m3" }],
  "ai": { "binding": "AI" },
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "slide-media" }],
  "vars": { "MEDIA_BASE": "https://media.<domain>", "ASK_ENABLED": "true", "RERANK": "off" },
  "observability": { "enabled": true }
}
```

### 10.3 CI/CD (GitHub Actions)
- **On every pull request:** typecheck, lint, unit tests (normalisation parity, reference parsing, RRF), **the search-quality check against the golden set** (it fails if Recall@10 drops more than 2 points), Astro build, then `wrangler versions upload` for a preview URL.
- **On merge to `main`:** `wrangler d1 migrations apply --remote`, then `wrangler deploy`.
- **Publishing data is a separate step**, run by hand after ingestion: `make publish-data` (R2 sync, D1 load, Vectorize upsert), then `make deploy`. Code deploys and data deploys stay independent.

### 10.4 Adding a new PDF later (runbook)
```bash
cp "New-Lesson.pdf" source-pdfs/
cd ingest && uv run kg all --only new          # render, transcribe (~$2-3), validate, resolve, graph, embed
uv run kg review                               # fix anything flagged (opens local review page)
uv run kg publish                              # R2 + D1 + Vectorize
cd ../web && npm run build && npx wrangler deploy
```
Expect about 30–60 minutes of hands-off batch time and about 10 minutes of review per deck. The graph analytics (topics, PageRank, related slides) are recomputed for the whole library, which takes minutes. Existing slide URLs never change.

### 10.5 Operations
- **Backups.** D1 Time Travel keeps 7 days on Free and 30 days on Paid. More importantly, **the database can be thrown away and rebuilt**: `ingest/out` plus `overrides/` is the real source, mirrored to a private R2 bucket. Rebuilding everything takes minutes.
- **Monitoring.** Workers Observability logs, Cloudflare Web Analytics (free, no cookies), AI Gateway dashboards, and a weekly "zero-result queries" report from `query_log`. That report feeds new aliases and synonyms.
- **Security.** Read-only public API. Rate limits on `/api/ask` and `/api/search`. AI routes go through AI Gateway. No secrets in the browser. CSP headers. Turnstile in invisible mode on Ask only if abuse appears; no CAPTCHA puzzles for older users.
- **Privacy.** No accounts or cookies unless Access is turned on. Query logs store no IP address.

---

## 11. Testing quality

| What | How | Target |
|---|---|---|
| Hebrew and Greek transcription | Character error rate against WLC and SBLGNT on all verse blocks, plus a 5% stratified human spot-check | CER ≤ 1% after correction |
| English transcription | Word error rate against the text layer (text decks) and a spot-check (image decks) | WER ≤ 2% |
| Gematria | Re-computed total matches what the slide shows | 100% matched or explained |
| Entity merges | Hand-check 100 sampled merges and 50 non-merges | Precision ≥ 95% |
| Search | A **golden set of about 80 real questions** collected from Fahad and John's audience (examples below). Metrics: Recall@10, MRR, nDCG@10 | Verse and word lookups: Recall@10 ≥ 0.95. Concept questions: ≥ 0.80 |
| AI answers | 30 questions, rated for faithfulness to the slides and checked for citation accuracy | No uncited claims; at least 90% judged faithful |
| Usability | 5 users aged 65+, think-aloud test, 6 tasks (find a verse, find a word, follow a connection, print, share, return home) | Task success ≥ 90%, SUS score ≥ 80 |
| Speed and accessibility | Lighthouse, axe-core, real iPad and older Android phone | Performance ≥ 95, Accessibility 100 |

**Golden-set examples taken from the actual slides:**
- "Genesis 22:13" → the Akedah decks and Fall of Man slide 48 ("The Progression of Blood")
- "what does alef tav mean" → Abel slide 37, Akedah II slide 11, Genesis 1:1 Part 1 slide 54
- "red heifer requirements" → Red Heifer slides 34 and 118
- "Jesus 888" → Noah Part 2 slide 79
- "Noah's raven" → Noah Part 2 slides 61 and 70
- "Barabbas son of the father" → Genesis 1:1 Part 1 slide 16
- "Satan letters" → Fall of Man slide 67
- "first Adam last Adam" → Fall of Man slide 72
- "Hebrew alphabet pictures" → Akedah II slide 73, Genesis 1:1 Part 1 slide 39
- "elohim" → Genesis 1:1 Part 1 slides 39 and 46
- "תמימה" → Red Heifer slide 118

---

## 12. Phased timeline (one developer + Claude Code)

| Phase | Duration | Output | Gate to pass |
|---|---|---|---|
| **0. Tests and decisions** | 3 days | Transcription comparison (Sonnet 5.5 vs Gemini Flash) on 40 of the hardest slides; check D1 FTS5 trigram and `remove_diacritics`; embedding comparison (bge-m3, qwen3-embedding, embeddinggemma); golden set v1; decisions from §15 | Measured CER and Recall numbers; Fahad signs off on the decisions |
| **1. Processing v1** | 5 days | Render, word boxes, Batch transcription of all 1,443 slides, validation, review page | ≥ 95% of slides pass checks; review queue cleared |
| **2. Knowledge graph** | 5 days | Entity resolution, reference data, graph, topics, PPR, related slides, embeddings, exports | Merge precision ≥ 95%; every edge records where it came from |
| **3. Search and Ask API** | 4 days | Four channels, fusion, explanations, Ask with citation checks, caching, rate limits, eval harness in CI | Golden-set targets met |
| **4. Website** | 7 days | All pages in §7.2, slide viewer, highlights, text view, print and share, PWA, optional map | Lighthouse ≥ 95/100; works on iPad and phone |
| **5. Testing and polish** | 4 days | Usability test with 5 older users, fixes, content QA with Fahad/John | SUS ≥ 80; task success ≥ 90% |
| **6. Launch and handover** | 2 days | Production deploy, domain, monitoring, runbook (§10.4), training video for the admin | The client adds a test PDF using the runbook alone |

**About 30 working days, or 6 calendar weeks.** A usable preview (search and slide pages) is ready at the end of Phase 3, around week 3.

---

## 13. Costs

| Item | Cost |
|---|---|
| One-time AI processing of the current 12 decks | ≈ $35–50 |
| Each additional 120-slide deck | ≈ $2–3 |
| Hosting on the Cloudflare free tier | **$0/month** |
| Recommended once there are real users: Workers Paid (30 s CPU, far higher D1/Vectorize limits, Workers AI billed beyond the free 10k neurons/day) | $5/month |
| Optional: Claude Haiku 4.5 for "Ask" answers instead of Workers AI | ≈ $0.01 per answer (cached repeats are free) |
| Domain name | ≈ $10–15/year |

---

## 14. Risks and how we handle them

| Risk | Mitigation |
|---|---|
| Hebrew or Greek transcription errors | Automatic replacement with the canonical Bible text, Opus re-runs, a human review queue, and overrides that survive re-runs |
| The AI misstates John's teaching | Answers come only from the slides, carry citations, are clearly labelled, and can be switched off. "From the slides" and "Reference" connections are shown separately |
| Free-tier limits | Edge caching, packed graph data, graceful fallback to keyword search, usage alerts. Move to $5 Workers Paid when needed |
| Content rights (third-party photos, logos, Bible translations, John's own material) | Confirm publication rights with John and Fahad. Option to put the site behind Cloudflare Access |
| Older users get lost | Lists before graphs, persistent Home, plain words, a usability test before launch, and a Help page with a contact line |
| Vendor or model changes | Models are referenced in config; the transcription output is plain JSON; the database can be rebuilt; the embedding model is pinned and switching it is a scripted re-index |

---

## 15. Decisions needed from Fahad

1. **Public or private site?** Public gets search-engine traffic. Private uses Cloudflare Access with an email code.
2. **Domain name** for the site and for `media.`
3. **"Ask a question" AI answers:** yes or no, and is John comfortable with AI summaries of his slides?
4. **Lesson titles and order** (`decks.yaml`): Bible order (recommended) or teaching order.
5. **Videos:** the title slides are video stills ("Fall of Man 5", "7 Noah Part 2"). If YouTube links exist, each lesson can link to its video. Later, video transcripts could add a **"Watch John explain this slide"** button at the right moment in the video.
6. **Reviewer:** who will spend about 2–3 hours checking the flagged transcriptions (ideally someone who reads Hebrew)?
7. **Budget approval:** about $50 one-time for AI processing; $0–5/month hosting.

---

## 16. Later: turning it into a multi-user platform

- **Tenancy.** A D1 database per tenant (D1 is designed for many small databases: 50k databases on Paid), a Vectorize namespace per tenant, R2 key prefixes, and Cloudflare Access or Zero Trust per workspace.
- **Uploads.** Browser to R2 with presigned URLs, then a Queue, then Cloudflare Workflows (durable, step-by-step ingestion). PDF rendering and OCR run in Cloudflare Containers using the same Python pipeline packaged as an image, with Claude Batch for transcription.
- **General documents.** The slide-as-unit design generalises to a "page-as-unit" design. The Bible-specific parts (references, Strong's, gematria) become one domain pack among several.

---

## Sources
- Cloudflare: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [Workers pricing (static assets free and unlimited; D1/KV free limits)](https://developers.cloudflare.com/workers/platform/pricing/) · [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) · [D1 SQL (FTS5 support)](https://developers.cloudflare.com/d1/sql-api/sql-statements/) · [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) · [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/) · [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) · [Workers AI models](https://developers.cloudflare.com/workers-ai/models/) · [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare acquires Astro (Jan 16 2026)](https://secure.businesswire.com/news/home/20260116386991/en/Cloudflare-Acquires-Astro-to-Accelerate-the-Future-of-High-Performance-Web-Development)
- [Supabase free-project pausing](https://supabase.com/docs/guides/platform/free-project-pausing.md)
- Anthropic: [Claude pricing and Batch discount](https://platform.claude.com/docs/en/about-claude/pricing) · [Vision: image token costs and high-resolution tier](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Bible Passage Reference Parser (MIT)](https://github.com/openbibleinfo/Bible-Passage-Reference-Parser) · [STEPBible Data (CC BY 4.0)](https://github.com/STEPBible/STEPBible-Data)
- [HippoRAG overview](https://www.emergentmind.com/topics/hipporag) · [Spreading activation for KG-RAG (arXiv 2512.15922)](https://arxiv.org/pdf/2512.15922)
- [NN/g: Usability for older adults](https://www.nngroup.com/articles/usability-for-senior-citizens/)
