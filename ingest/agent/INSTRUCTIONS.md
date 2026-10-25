# Slide transcription instructions

You are transcribing Bible-study PowerPoint slides (by a teacher known as "Dutch Uncle John") into
structured JSON. The JSON powers a search engine and a knowledge graph for older, non-technical
readers, so **accuracy and completeness matter more than speed**. Every slide is one JSON file.

Project root: `/Users/sami/Desktop/Fahad's PDF Sync` — always run shell commands as
`cd "/Users/sami/Desktop/Fahad's PDF Sync" && ingest/kg ...` (the path contains an apostrophe; keep the double quotes).

## Workflow for your batch

1. `ingest/kg todo <slug> <a-b>` → slides in your range that still need a transcript (skip the rest).
2. For a few slides at a time: `ingest/kg ctx <slug> <a-b>` → image path + hints for each slide.
3. **Read the image** (Read tool on the printed `IMAGE:` path). Always look at the image; hints are only hints.
   - `PDF TEXT HINT`: English is reliable; **Hebrew/Greek word order in it is scrambled** — read those from the image.
   - `OCR HINT`: machine OCR of English, may contain errors.
   - `PICTURE-REGION HINTS`: automatic boxes; often they are just text boxes. Use only if they really are pictures.
4. Tools when needed:
   - `ingest/kg verse "Num 19:2"` (also `"Gen 22:1-3"`, `"Num.19.2"`, `"במדבר יט:ב"`) → KJV + Hebrew (pointed & consonants) or Greek. **Use it for every verse block in Hebrew or Greek** to confirm each letter — copy the canonical spelling *only where it matches what the slide shows* (keep the slide's pointing style: if the slide has no vowel points, write none).
   - `ingest/kg lex <word>` → Strong's number candidates for a Hebrew/Greek word (or an English gloss).
   - `ingest/kg gem <word>` → gematria values (standard / ordinal / reduced / sofit; Greek isopsephy).
   - `ingest/kg zoom <slug> <n> x0 y0 x1 y1` → high-resolution crop (coords 0–1) when small text is hard to read; then Read the printed PNG.
5. Save transcripts with `ingest/kg put` (see "Work efficiently" below) — it writes `ingest/work/transcripts/<slug>/<nnn>.json`.
6. `ingest/kg check <slug> <a-b>` → fix every ERROR; look at every warn (Hebrew/Greek mismatches usually mean a misread letter).
7. When the whole range validates, reply with: slides done, slides with low confidence (< 0.8) and why.

**Work efficiently — in groups of 4 slides** (this matters a lot; every extra tool call re-sends your whole context):
1. ONE command: `ingest/kg ctx <slug> <a-b>` for the next 4 slides.
2. ONE message with 4 parallel Read calls (one per image). Batch any `kg verse` lookups for those 4 slides into a
   single command (`ingest/kg verse "Gen 4:1" "Heb 11:4" …`) and only when there is Hebrew/Greek verse text to confirm.
3. ONE Write of a scratch file holding a JSON **list** of the 4 transcripts, e.g.
   `ingest/work/scratch/<slug>-<a>.json`, then ONE command: `ingest/kg put <that file>` —
   it writes each transcript to its place and validates it (`OK` / `FIX` + errors). Fix and re-`put` only if needed.
Don't re-read files you just wrote, don't print transcripts back, keep your replies between steps very short.

**Build slides:** consecutive slides are often animation steps (same content plus one more line). Start from the
previous slide's JSON, then edit — but every slide must still describe exactly what *it* shows.

## JSON schema (all fields required; use [] / {} / null when empty)

```jsonc
{
  "id": "<slug>/<n>",                 // n without leading zeros, e.g. "red-heifer/118"
  "kinds": ["verse"],                 // 1–3 of: title verse word-study gematria letters list table chart calendar code-grid
                                      //   genealogy picture quote text diagram map humor end song timeline comparison
  "title": "…",                       // ≤ 80 chars, descriptive, plain English (what a reader would call this slide)
  "summary": "…",                     // 1–2 plain-English sentences: what the slide shows/teaches. No jargon.
  "text": [                           // EVERYTHING readable on the slide, in reading order, one block per line/box
    {"lang": "en|he|el|translit|other", "role": "heading|reference|verse|body|label|caption|list|table|number|note|quote",
     "text": "…", "osis": "Num.19.2"} // osis only on verse/reference blocks; may be a list for ranges: ["Gen.4.1","Gen.4.2"]
  ],
  "refs": [{"shown": "Genesis 4:1 / בראשית ד:א", "osis": ["Gen.4.1"], "role": "quoted|cited"}],
                                      // every Scripture reference on the slide. quoted = verse text is on the slide.
                                      // Expand ranges to every verse ("Gen.4.1","Gen.4.2"). Whole chapter only (e.g. "Numbers 19")
                                      // → list verse 1 of that chapter and mention the chapter in keywords.
  "words": [{"lang": "he|el|en|other", "word": "תמימה", "translit": "temimah", "gloss": "unblemished",
             "strongs": "H8549", "gematria": {"method": "standard|ordinal|reduced|sofit|isopsephy|other",
             "values": [5,40,10,40,400], "total": 495}}],
                                      // word studies & key Hebrew/Greek words the slide explains or highlights.
                                      // strongs: base number only (H8549, G3056) from `kg lex`; null if unsure.
                                      // gematria only when the slide shows numbers for the word (values in the order shown).
  "color_links": [{"en": "Eve", "other": "חוה"}],   // words shown in the SAME colour in English and Hebrew/Greek
  "letters": [{"lang": "he|el", "letter": "alef", "char": "א", "value": 1, "meaning": "strong / ox"}],
                                      // only when the slide teaches letters (alphabet tables, pictographs, letter meanings)
  "numbers": [{"value": 207, "note": "gematria of אור (light)"}],   // significant numbers the slide makes a point of
  "pictures": [{"type": "photo|painting|engraving|drawing|cartoon|map|diagram|chart|logo|screenshot|video-still|pictograph|calendar|table-image|icon|symbol|illustration|grid",
                "description": "…",   // 1–3 sentences: what is depicted, so someone can find it by searching
                "subjects": ["…"],    // 2–8 search tags: objects, places, people-roles, art style
                "text_in_picture": "…",   // words that are part of the picture itself (signs, logos, captions in the art)
                "credit": "Gustave Doré, 1870" | null,   // only if shown on the slide or unmistakable
                "box": [x0, y0, x1, y1]}],   // location on the slide, 0–1 (x0,y0 = top-left). Estimate generously;
                                             // edges are snapped automatically. Full-slide picture = [0,0,1,1].
  "entities": {"people": [], "places": [], "events": [], "things": [], "themes": [], "groups": []},
  "keywords": ["…"],                  // 6–15 things a reader might TYPE to find this slide: synonyms, plain-English
                                      // concepts, alternate spellings/transliterations, KJV wording, picture terms
  "uncertain": ["…"],                 // anything you could not read or are unsure about (empty if none)
  "confidence": 0.95                  // your overall confidence in this transcript
}
```

## Transcription rules

- **Hints can be missing or wrong.** Image-only decks have no PDF text (you'll get an OCR hint or nothing).
  Always trust your reading of the image over any hint.
- **Crossed-out words** (the teacher strikes through translators' additions like "Let there"): keep them in the
  text wrapped as `~~Let there~~`, and mention the strike-through in the summary.
- **Spaced-out letters** (א ו ר shown as separate letters): keep the spacing in `text`; use the joined word in `words`.
- **Gematria `values`**: in the order they appear on the slide, left to right.
- **Strong's numbers**: base number, no leading zeros, no suffix letter — `H216`, `H430`, `G3056` (even if
  `kg lex` prints `H0216` or `H0430G`).
- **`color_links`**: English (or a transliteration) ↔ Hebrew/Greek pairs shown in the same colour. Skip English↔English.
- **`letters`**: fill whenever the slide names letters, shows their values, or teaches their meanings/pictographs.
- **Summaries describe what this slide shows.** You may use the lesson's evident thread for keywords (closely related
  concepts a reader might search), but don't put claims in the summary that the slide itself doesn't make.
- **Book authors**: a reference such as 1 John 1:5 does not add a person. If a slide is *about* the apostle John,
  use `John (apostle)`; the Baptist is `John the Baptist`.
- **Exactness.** Transcribe what the slide shows. Do not correct the teacher's wording, spelling, or arithmetic
  (if his numbers don't add up, transcribe them and note it in `uncertain`). Do not invent text that is not there.
- **Hebrew:** logical (right-to-left reading) order, Unicode Hebrew. Keep maqaf (־), paseq (׀), sof pasuq (׃).
  Write vowel points **only if the slide shows them**. Verse numbers that appear inside the line stay in the text.
  Words split by colour are still one word (the PDF text breaks them; you read the image).
  Letters that are drawn as ancient/paleo-Hebrew glyphs are pictures (`type: "pictograph"`) — name them in `letters`.
- **Greek:** as shown (polytonic or capitals), Unicode Greek.
- **Transliterations** (italic Latin words like *chava*, *yahweh*, *bara*) → `lang: "translit"` blocks.
- **Reference headers** like `Genesis 4:1 ✡ בראשית ד:א` or `Luke 3:38 ✝ ΛΟΥΚΑΝ 3:38`: one `en` reference block,
  one `he`/`el` reference block. The ✡ / ✝ symbols are decoration (OT / NT markers) — don't transcribe them.
- **Dense grids** (Bible-code/ELS letter grids, calendars, long number tables): don't copy every cell. Transcribe the
  headings, labels, the highlighted/circled words and the point being made; describe the grid in `summary`.
  An ELS grid is `kinds: ["code-grid"]` plus a `pictures` entry of `type: "grid"`.
- **Pictures:** every photo, painting, engraving, drawing, cartoon, map, logo, diagram, icon-art or video still gets an
  entry — this is how people search for images. Describe *what is depicted* concretely (objects, setting, colours,
  style, mood) and add subjects people would type ("Dome of the Rock", "menorah", "dove", "ark", "lamb").
  Title slides that show a man talking in front of a world map are **video stills of the presenter**:
  `type: "video-still"`, describe the scene and on-screen title text; **never try to identify any person** — call them
  "the presenter" / "a man" / "a woman". Plain decorative symbols (the small ✡ / ✝ markers) are not pictures.
  Slides that are only text have `"pictures": []`.
- **Entity naming** (so the graph links up across 1,443 slides — use these exact forms):
  - people: common English Bible names: `God`, `Jesus` (also for Yeshua / Christ / Messiah when it refers to Jesus),
    `Holy Spirit`, `Satan`, `Adam`, `Eve`, `Cain`, `Abel`, `Seth`, `Enoch`, `Noah`, `Shem`, `Ham`, `Japheth`, `Abraham`
    (also Abram), `Sarah`, `Isaac`, `Rebekah`, `Ishmael`, `Hagar`, `Jacob`, `Esau`, `Eliezer`, `Moses`, `Aaron`,
    `Eleazar`, `David`, `Elijah`, `Elisha`, `John the Baptist`, `Peter`, `Paul`, `Pilate`, `Barabbas`, `Mary`, …
    `Messiah` only for the concept/title in Jewish expectation (not when it plainly means Jesus).
  - places: `Garden of Eden`, `Jerusalem`, `Mount Moriah`, `Beersheba`, `Egypt`, `Temple Mount`, `Israel` (land) …
  - events: `Creation`, `Fall of Man`, `the Flood`, `Binding of Isaac (Akedah)`, `Exodus`, `Passover`, `Crucifixion`,
    `Resurrection`, `Second Coming` …
  - things: concrete objects, lowercase: `red heifer`, `ark`, `ram`, `altar`, `hyssop`, `cedar wood`, `menorah`, `tree of life`…
  - themes: lowercase abstract ideas, reuse these when they fit: `sacrifice`, `blood`, `atonement`, `substitution`,
    `covenant`, `seed`, `sin`, `death`, `resurrection`, `faith`, `obedience`, `purification`, `clean and unclean`,
    `holiness`, `prophecy`, `typology`, `names of God`, `Hebrew letter meanings`, `gematria`, `Bible codes`,
    `biblical feasts`, `creation`, `wisdom`, `light and darkness`, `marriage`, `firstborn`, `messianic prophecy`,
    `genealogy`, `judgment`, `grace`, `redemption`, `Torah`, `temple`, `priesthood`, `humor`
  - groups: `Israel` (people), `Jews`, `Pharisees`, `priests`, `Levites`, `Gentiles`, `angels` …
- **Keywords** are the bridge to people's vocabulary. Include: plain-English concepts ("perfect sacrifice"),
  KJV wording where it differs ("without spot"), alternate spellings ("Akedah", "Akeda", "aleph"), the Bible book +
  chapter ("Numbers 19"), and picture words ("painting", "map", "photo of Jerusalem") when there is a picture.

## Examples (real slides)

Look at these finished, validated transcripts and match their style and depth:
`ingest/work/transcripts/red-heifer/118.json` (verse + word study + gematria),
`ingest/work/transcripts/genesis-1-1-part-1/039.json` (letters + pictographs),
`ingest/work/transcripts/noah-part-2/018.json` (calendar),
`ingest/work/transcripts/abel/185.json` (picture).
