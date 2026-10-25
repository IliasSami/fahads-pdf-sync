"""Bible book table, reference parsing, Hebrew/Greek normalisation and gematria.

Shared by the offline tools. The website has a TypeScript port of the parsing and
normalisation rules (web/src/lib/search/normalize.ts); keep the two in sync.
"""
import re
import unicodedata

# (osis, english name, step code, kjv index name, extra english aliases, hebrew names, greek names)
BOOKS = [
    ("Gen", "Genesis", "Gen", ["gen", "ge", "gn"], ["בראשית"], []),
    ("Exod", "Exodus", "Exo", ["exod", "exo", "ex"], ["שמות"], []),
    ("Lev", "Leviticus", "Lev", ["lev", "le", "lv"], ["ויקרא"], []),
    ("Num", "Numbers", "Num", ["num", "nu", "nm", "nb"], ["במדבר"], []),
    ("Deut", "Deuteronomy", "Deu", ["deut", "deu", "dt", "de"], ["דברים"], []),
    ("Josh", "Joshua", "Jos", ["josh", "jos", "jsh"], ["יהושע"], []),
    ("Judg", "Judges", "Jdg", ["judg", "jdg", "jg", "jdgs"], ["שופטים"], []),
    ("Ruth", "Ruth", "Rut", ["ruth", "rut", "ru"], ["רות"], []),
    ("1Sam", "1 Samuel", "1Sa", ["1sam", "1sa", "1 sam", "i samuel", "1st samuel", "first samuel"], ["שמואל א"], []),
    ("2Sam", "2 Samuel", "2Sa", ["2sam", "2sa", "2 sam", "ii samuel", "2nd samuel", "second samuel"], ["שמואל ב"], []),
    ("1Kgs", "1 Kings", "1Ki", ["1kgs", "1ki", "1 kgs", "1 kin", "i kings", "1st kings", "first kings"], ["מלכים א"], []),
    ("2Kgs", "2 Kings", "2Ki", ["2kgs", "2ki", "2 kgs", "2 kin", "ii kings", "2nd kings", "second kings"], ["מלכים ב"], []),
    ("1Chr", "1 Chronicles", "1Ch", ["1chr", "1ch", "1 chron", "i chronicles", "first chronicles"], ["דברי הימים א"], []),
    ("2Chr", "2 Chronicles", "2Ch", ["2chr", "2ch", "2 chron", "ii chronicles", "second chronicles"], ["דברי הימים ב"], []),
    ("Ezra", "Ezra", "Ezr", ["ezra", "ezr"], ["עזרא"], []),
    ("Neh", "Nehemiah", "Neh", ["neh", "ne"], ["נחמיה"], []),
    ("Esth", "Esther", "Est", ["esth", "est", "es"], ["אסתר"], []),
    ("Job", "Job", "Job", ["job", "jb"], ["איוב"], []),
    ("Ps", "Psalms", "Psa", ["ps", "psa", "psalm", "pss", "psm"], ["תהילים", "תהלים"], []),
    ("Prov", "Proverbs", "Pro", ["prov", "pro", "prv", "pr"], ["משלי"], []),
    ("Eccl", "Ecclesiastes", "Ecc", ["eccl", "ecc", "eccles", "qoh"], ["קהלת"], []),
    ("Song", "Song of Solomon", "Sng", ["song", "sng", "song of songs", "sos", "canticles"], ["שיר השירים"], []),
    ("Isa", "Isaiah", "Isa", ["isa", "is"], ["ישעיהו", "ישעיה"], []),
    ("Jer", "Jeremiah", "Jer", ["jer", "je", "jr"], ["ירמיהו", "ירמיה"], []),
    ("Lam", "Lamentations", "Lam", ["lam", "la"], ["איכה"], []),
    ("Ezek", "Ezekiel", "Ezk", ["ezek", "eze", "ezk"], ["יחזקאל"], []),
    ("Dan", "Daniel", "Dan", ["dan", "da", "dn"], ["דניאל"], []),
    ("Hos", "Hosea", "Hos", ["hos", "ho"], ["הושע"], []),
    ("Joel", "Joel", "Jol", ["joel", "jol", "jl"], ["יואל"], []),
    ("Amos", "Amos", "Amo", ["amos", "amo", "am"], ["עמוס"], []),
    ("Obad", "Obadiah", "Oba", ["obad", "oba", "ob"], ["עובדיה", "עבדיה"], []),
    ("Jonah", "Jonah", "Jon", ["jonah", "jon", "jnh"], ["יונה"], []),
    ("Mic", "Micah", "Mic", ["mic", "mi"], ["מיכה"], []),
    ("Nah", "Nahum", "Nam", ["nah", "na"], ["נחום"], []),
    ("Hab", "Habakkuk", "Hab", ["hab", "hb"], ["חבקוק"], []),
    ("Zeph", "Zephaniah", "Zep", ["zeph", "zep", "zp"], ["צפניה"], []),
    ("Hag", "Haggai", "Hag", ["hag", "hg"], ["חגי"], []),
    ("Zech", "Zechariah", "Zec", ["zech", "zec", "zc"], ["זכריה"], []),
    ("Mal", "Malachi", "Mal", ["mal", "ml"], ["מלאכי"], []),
    ("Matt", "Matthew", "Mat", ["matt", "mat", "mt"], [], ["ματθαιον", "μαθθαιον", "ματθαιος", "μαθθαιος"]),
    ("Mark", "Mark", "Mrk", ["mark", "mrk", "mk", "mr"], [], ["μαρκον", "μαρκος"]),
    ("Luke", "Luke", "Luk", ["luke", "luk", "lk"], [], ["λουκαν", "λουκας"]),
    ("John", "John", "Jhn", ["john", "jhn", "jn"], [], ["ιωαννην", "ιωαννης", "ιωανην", "ιωανης"]),
    ("Acts", "Acts", "Act", ["acts", "act", "ac"], [], ["πραξεις"]),
    ("Rom", "Romans", "Rom", ["rom", "ro", "rm"], [], ["ρωμαιους"]),
    ("1Cor", "1 Corinthians", "1Co", ["1cor", "1co", "1 cor", "i corinthians", "first corinthians"], [], ["κορινθιους α"]),
    ("2Cor", "2 Corinthians", "2Co", ["2cor", "2co", "2 cor", "ii corinthians", "second corinthians"], [], ["κορινθιους β"]),
    ("Gal", "Galatians", "Gal", ["gal", "ga"], [], ["γαλατας"]),
    ("Eph", "Ephesians", "Eph", ["eph", "ephes"], [], ["εφεσιους"]),
    ("Phil", "Philippians", "Php", ["phil", "php", "pp"], [], ["φιλιππησιους"]),
    ("Col", "Colossians", "Col", ["col"], [], ["κολοσσαεις"]),
    ("1Thess", "1 Thessalonians", "1Th", ["1thess", "1th", "1 thess", "i thessalonians"], [], ["θεσσαλονικεις α"]),
    ("2Thess", "2 Thessalonians", "2Th", ["2thess", "2th", "2 thess", "ii thessalonians"], [], ["θεσσαλονικεις β"]),
    ("1Tim", "1 Timothy", "1Ti", ["1tim", "1ti", "1 tim", "i timothy"], [], ["τιμοθεον α"]),
    ("2Tim", "2 Timothy", "2Ti", ["2tim", "2ti", "2 tim", "ii timothy"], [], ["τιμοθεον β"]),
    ("Titus", "Titus", "Tit", ["titus", "tit"], [], ["τιτον"]),
    ("Phlm", "Philemon", "Phm", ["phlm", "phm", "philem"], [], ["φιλημονα"]),
    ("Heb", "Hebrews", "Heb", ["heb"], [], ["εβραιους"]),
    ("Jas", "James", "Jas", ["jas", "jm"], [], ["ιακωβου"]),
    ("1Pet", "1 Peter", "1Pe", ["1pet", "1pe", "1 pet", "i peter", "first peter"], [], ["πετρου α"]),
    ("2Pet", "2 Peter", "2Pe", ["2pet", "2pe", "2 pet", "ii peter", "second peter"], [], ["πετρου β"]),
    ("1John", "1 John", "1Jn", ["1john", "1jn", "1 jn", "i john", "first john"], [], ["ιωαννου α"]),
    ("2John", "2 John", "2Jn", ["2john", "2jn", "2 jn", "ii john", "second john"], [], ["ιωαννου β"]),
    ("3John", "3 John", "3Jn", ["3john", "3jn", "3 jn", "iii john", "third john"], [], ["ιωαννου γ"]),
    ("Jude", "Jude", "Jud", ["jude", "jud", "jd"], [], ["ιουδα"]),
    ("Rev", "Revelation", "Rev", ["rev", "re", "revelations", "apocalypse"], [], ["αποκαλυψις"]),
]
OSIS = [b[0] for b in BOOKS]
OSIS_INDEX = {b[0]: i for i, b in enumerate(BOOKS)}
STEP_TO_OSIS = {b[2]: b[0] for b in BOOKS}
NAME = {b[0]: b[1] for b in BOOKS}

HEB_POINTS = re.compile(r"[֑-ׇ]")  # cantillation + vowel points (keeps letters 05D0-05EA)
FINALS = str.maketrans("ךםןףץ", "כמנפצ")


def heb_plain(s: str) -> str:
    """Consonants only; maqaf -> space; drop sof pasuq/paseq/geresh."""
    s = s.replace("־", " ").replace("־", " ")
    s = HEB_POINTS.sub("", s)
    s = re.sub(r"[׃׀|׳״'\"]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def heb_key(s: str) -> str:
    """Matching key: consonants, final letters folded, no spaces."""
    return heb_plain(s).translate(FINALS).replace(" ", "")


def greek_plain(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower().replace("ς", "σ")
    return re.sub(r"[^\w\s]", "", s).strip()


def latin_fold(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.lower()


def translit_key(s: str) -> str:
    """Phonetic key so chava = hava = chavah, yeshua = y'shua, elohim = eloheem."""
    s = latin_fold(s)
    s = re.sub(r"[^a-z]", "", s)
    for a, b in [("sch", "sh"), ("ch", "h"), ("kh", "h"), ("ph", "f"), ("tz", "ts"), ("ee", "i"),
                 ("oo", "u"), ("ou", "u"), ("y", "i"), ("w", "v"), ("q", "k"), ("c", "k")]:
        s = s.replace(a, b)
    s = re.sub(r"(.)\1+", r"\1", s)          # collapse doubles
    s = re.sub(r"h$", "", s)                 # final -ah -> -a
    s = re.sub(r"(?<=.)[aeiou]+$", lambda m: m.group(0)[0], s)
    return s


# ---------------------------------------------------------------- gematria
HEB_VAL = {"א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9, "י": 10, "כ": 20, "ך": 20,
           "ל": 30, "מ": 40, "ם": 40, "נ": 50, "ן": 50, "ס": 60, "ע": 70, "פ": 80, "ף": 80, "צ": 90, "ץ": 90,
           "ק": 100, "ר": 200, "ש": 300, "ת": 400}
HEB_ORD = {k: i + 1 for i, k in enumerate("אבגדהוזחטיכלמנסעפצקרשת")}
HEB_ORD.update({"ך": 11, "ם": 13, "ן": 14, "ף": 17, "ץ": 18})
HEB_FINAL_BIG = {"ך": 500, "ם": 600, "ן": 700, "ף": 800, "ץ": 900}
GRK_VAL = {"α": 1, "β": 2, "γ": 3, "δ": 4, "ε": 5, "ϛ": 6, "ϝ": 6, "ζ": 7, "η": 8, "θ": 9, "ι": 10, "κ": 20, "λ": 30,
           "μ": 40, "ν": 50, "ξ": 60, "ο": 70, "π": 80, "ϟ": 90, "ϙ": 90, "ρ": 100, "σ": 200, "τ": 300, "υ": 400,
           "φ": 500, "χ": 600, "ψ": 700, "ω": 800}


def gematria(word: str) -> dict:
    """All common methods; the validator accepts whichever matches the slide."""
    h = [c for c in HEB_POINTS.sub("", word) if c in HEB_VAL]
    if h:
        std = sum(HEB_VAL[c] for c in h)
        return {
            "standard": std,
            "ordinal": sum(HEB_ORD[c] for c in h),
            "reduced": sum(((HEB_VAL[c] - 1) % 9) + 1 for c in h),
            "sofit": sum(HEB_FINAL_BIG.get(c, HEB_VAL[c]) for c in h),
            "letters": [HEB_VAL[c] for c in h],
        }
    g = [c for c in greek_plain(word) if c in GRK_VAL]
    if g:
        return {"isopsephy": sum(GRK_VAL[c] for c in g), "letters": [GRK_VAL[c] for c in g]}
    return {}


def heb_number(s: str) -> int:
    """Hebrew numeral (יט -> 19, טו -> 15, קמה -> 145)."""
    return sum(HEB_VAL.get(c, 0) for c in heb_plain(s).replace(" ", ""))


# ---------------------------------------------------------------- reference parsing
_ALIAS = {}
for osis, name, _step, aliases, he, el in BOOKS:
    for a in [name.lower(), osis.lower(), *aliases]:
        _ALIAS[a.replace(".", "")] = osis
    for a in he:
        _ALIAS[heb_plain(a)] = osis
    for a in el:
        _ALIAS[a] = osis
_ALIAS_KEYS = sorted(_ALIAS, key=len, reverse=True)
_BOOK_RE = re.compile(
    r"(?<![\w])(" + "|".join(re.escape(k).replace(r"\ ", r"\s*") for k in _ALIAS_KEYS if re.match(r"[0-9a-z ]", k)) + r")\.?\s*"
    r"(\d{1,3})(?:\s*[:.]\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3})(?:\s*[:.]\s*(\d{1,3}))?)?)?(?!\d)",
    re.I,
)


def parse_refs(text: str):
    """English references -> list of (osis_book, chapter, verse_from|None, chapter_to, verse_to|None)."""
    out = []
    for m in _BOOK_RE.finditer(latin_fold(text)):
        key = re.sub(r"\s+", " ", m.group(1).lower()).replace(".", "")
        osis = _ALIAS.get(key) or _ALIAS.get(key.replace(" ", ""))
        if not osis:
            continue
        ch, v1, a, b = int(m.group(2)), m.group(3), m.group(4), m.group(5)
        if v1 is None:
            out.append((osis, ch, None, ch, None))
        elif b is not None:
            out.append((osis, ch, int(v1), int(a), int(b)))
        elif a is not None:
            out.append((osis, ch, int(v1), ch, int(a)))
        else:
            out.append((osis, ch, int(v1), ch, int(v1)))
    return out


def osis_verses(ref):
    """Expand a parsed ref into OSIS verse ids (needs verse counts for cross-chapter ranges)."""
    book, c1, v1, c2, v2 = ref
    if v1 is None:
        return [f"{book}.{c1}"]
    if c1 == c2:
        return [f"{book}.{c1}.{v}" for v in range(v1, v2 + 1)]
    return [f"{book}.{c1}.{v1}", f"{book}.{c2}.{v2}"]
