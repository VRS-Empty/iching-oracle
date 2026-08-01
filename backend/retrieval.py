"""
retrieval.py
─────────────────────────────────────────────────────────────────────────────
In-memory retrieval over the 512-chunk hexagram corpus.

512 chunks × 512 dims is small enough that a single numpy matrix multiply
beats any vector database on both latency and operational cost. This is a
deliberate architectural choice, not a placeholder.

CONTENT GUARDRAILS (the "B′" decision)
──────────────────────────────────────
hexagrams.json is only partly authored. Auditing every record found two
independent defects, each with a different cut-off point:

  Classical source text (the `chinese` field) is a placeholder beyond a point:
    • judgment — authentic for hexagrams 1–15,  placeholder ("第16卦") for 16–64
    • image    — authentic for hexagrams 1–15,  placeholder ("雷地象")  for 16–64
    • lines    — authentic for hexagrams 1–14,  placeholder ("第3爻辞（third）")
                 for 15–64

  English prose is templated from hexagram 16 onward — a fixed skeleton with
  the hexagram's name and trigrams substituted in ("… attend to its essential
  teaching", "… study their interaction as a map of your current situation").
  Line-level English is worse still: 6 strings reused verbatim across 300 lines.

The Chinese interpretation fields (`summary_zh`, `interpretation_zh`) are the
one layer that is authentic and hexagram-specific everywhere — 512/512 chunks.
They are what actually grounds an answer, and Claude reads them regardless of
the language it replies in.

So rather than guess at missing content, this module detects what is unusable
and withholds it:

  1. `has_classical` — whether real source text was supplied, so the prompt can
     forbid quoting text the model never received. Determined from the leading
     line of each chunk, which is the `chinese` field.
  2. `text_zh_clean` — placeholder leading lines removed, interpretation kept.
  3. `en_usable` — English that is not hexagram-specific is withheld entirely.

Both detectors are data-driven, derived from the corpus at load time. Fixing
hexagrams.json and rebuilding the corpus automatically re-enables the content
with no code change — a property the tests assert directly.
─────────────────────────────────────────────────────────────────────────────
"""

import json
import re
from collections import defaultdict
from pathlib import Path

import numpy as np

# The three placeholder shapes occupying `chinese` where authoring stopped.
PLACEHOLDER_PATTERNS = (
    re.compile(r"^第\s*\d+\s*卦$"),                              # judgment
    re.compile(r"^[一-鿿]{1,4}象$"),                     # image
    re.compile(r"^第\s*\d+\s*爻辞\s*[（(][^）)]*[）)]$"),          # line
)

# Authentic classical text is punctuated; every placeholder shape above is not.
CJK_PUNCTUATION = frozenset("，。：；、！？")
MIN_CLASSICAL_CHARS = 4

# Window for detecting templated English. Tuned against the corpus: 40 chars
# false-positives on authentic translations that legitimately share a rendering
# of 元亨利贞, and 80 fails to catch the shorter image template. 60 separates
# cleanly — flagging exactly hexagrams 16–64 for both judgment and image.
TEMPLATE_SHINGLE_CHARS = 60

# How many distinct hexagrams must share a window before it counts as a
# template. Two is not enough: the I Ching itself contains genuine textual
# parallels — 坤·六三 and 讼·六三 both carry 「或从王事，无成」, 泰·初九 and
# 否·初六 both carry 「拔茅茹，以其汇」 — whose authentic translations legitimately
# coincide. The generated templates recur across roughly fifty hexagrams, so a
# threshold of three separates the two cases with a wide margin.
MIN_HEXAGRAMS_FOR_TEMPLATE = 3


def _split_classical(text_zh):
    """Splits a chunk's Chinese into (leading `chinese` field, remainder)."""
    head, _, rest = (text_zh or "").strip().partition("\n")
    return head.strip(), rest.strip()


def is_authentic_classical(head):
    """True when the leading line is real source text rather than a placeholder."""
    if len(head) < MIN_CLASSICAL_CHARS:
        return False
    if any(pattern.match(head) for pattern in PLACEHOLDER_PATTERNS):
        return False
    return any(char in CJK_PUNCTUATION for char in head)


def _shingles(text, size=TEMPLATE_SHINGLE_CHARS):
    normalised = " ".join((text or "").split())
    if len(normalised) < size:
        return frozenset()
    return frozenset(
        normalised[i:i + size] for i in range(len(normalised) - size + 1)
    )


class Corpus:
    """The embedded hexagram corpus plus the guardrails described above."""

    def __init__(self, path):
        path = Path(path)
        if not path.exists():
            # The corpus is gitignored, so "file missing" is the expected first
            # failure on a fresh deploy. Say what to do about it rather than
            # letting a bare FileNotFoundError surface from gunicorn's startup.
            raise FileNotFoundError(
                f"Embedded corpus not found at {path}.\n"
                f"It is deliberately not committed — see README.md → "
                f"'Supplying the corpus without committing it'.\n"
                f"  • locally:  python scripts/build_embeddings.py "
                f"--provider voyage\n"
                f"  • on Render: set EMBEDDINGS_PATH to the mounted Secret "
                f"File, or have the build download it"
            )
        with open(path, encoding="utf-8") as f:
            payload = json.load(f)

        self.meta = payload["_meta"]
        self.provider = self.meta["provider"]
        self.model = self.meta["model"]
        self.dimensions = self.meta["dimensions"]
        self.chunks = payload["chunks"]

        if not self.chunks:
            raise ValueError(f"{path} contains no chunks")

        self.matrix = np.asarray(
            [c["embedding"] for c in self.chunks], dtype=np.float32
        )
        # The build script emits unit vectors; re-normalise defensively so a
        # dot product is always exactly cosine similarity.
        norms = np.linalg.norm(self.matrix, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        self.matrix /= norms

        self._apply_guardrails()
        self._by_id = {c["id"]: c for c in self.chunks}
        self._by_key = {
            (c["hexagram_number"], c["chunk_type"], c["line_position"]): c
            for c in self.chunks
        }

    # ── Guardrails ────────────────────────────────────────────────────────────

    def _apply_guardrails(self):
        """Annotates every chunk with cleaned text and usability flags."""
        templated_ids = self._find_templated_english()

        for chunk in self.chunks:
            raw_en = (chunk.get("text_en") or "").strip()
            head, body = _split_classical(chunk.get("text_zh"))

            authentic = is_authentic_classical(head)
            chunk["has_classical"] = authentic
            # A placeholder head is dropped; an authentic one is kept so the
            # model can quote it. The interpretation body is always kept — it is
            # the layer that is trustworthy for every hexagram.
            chunk["text_zh_clean"] = (
                f"{head}\n{body}".strip() if authentic else body
            )

            chunk["en_usable"] = bool(raw_en) and chunk["id"] not in templated_ids
            chunk["text_en_clean"] = raw_en if chunk["en_usable"] else ""

    def _find_templated_english(self):
        """
        Returns the ids of chunks whose English is not hexagram-specific.

        Text is judged templated when a long verbatim window recurs across at
        least MIN_HEXAGRAMS_FOR_TEMPLATE different hexagrams' text of the same
        kind. That catches both the verbatim reuse in line records and the
        slot-substituted skeletons in judgment and image records, while leaving
        the I Ching's own textual parallels — which recur across exactly two
        hexagrams — intact.
        """
        templated = set()
        by_type = defaultdict(list)
        for chunk in self.chunks:
            by_type[chunk["chunk_type"]].append(chunk)

        for chunks in by_type.values():
            hexagrams_per_shingle = defaultdict(set)
            shingles_per_chunk = {}
            for chunk in chunks:
                shingles = _shingles(chunk.get("text_en"))
                shingles_per_chunk[chunk["id"]] = shingles
                for shingle in shingles:
                    hexagrams_per_shingle[shingle].add(chunk["hexagram_number"])

            for chunk in chunks:
                if any(
                    len(hexagrams_per_shingle[shingle]) >= MIN_HEXAGRAMS_FOR_TEMPLATE
                    for shingle in shingles_per_chunk[chunk["id"]]
                ):
                    templated.add(chunk["id"])
        return templated

    # ── Lookup ────────────────────────────────────────────────────────────────

    def get(self, hexagram_number, chunk_type, line_position=None):
        return self._by_key.get((hexagram_number, chunk_type, line_position))

    def by_id(self, chunk_id):
        return self._by_id.get(chunk_id)

    # ── Similarity search ─────────────────────────────────────────────────────

    def search(self, query_vector, k=3, exclude_ids=()):
        """Returns the k most similar chunks as (score, chunk), best first."""
        vector = np.asarray(query_vector, dtype=np.float32)
        if vector.shape != (self.dimensions,):
            raise ValueError(
                f"query vector has {vector.shape} dims, corpus expects "
                f"({self.dimensions},)"
            )
        norm = np.linalg.norm(vector)
        if norm == 0:
            raise ValueError("query vector is all zeros")
        vector = vector / norm

        scores = self.matrix @ vector  # unit vectors -> dot product is cosine

        excluded = set(exclude_ids)
        # Rank by score, then filter — k is tiny relative to the corpus, so
        # sorting the full array is cheaper than maintaining a heap.
        order = np.argsort(-scores)
        results = []
        for idx in order:
            chunk = self.chunks[int(idx)]
            if chunk["id"] in excluded:
                continue
            results.append((float(scores[int(idx)]), chunk))
            if len(results) >= k:
                break
        return results


# ─── Context assembly ─────────────────────────────────────────────────────────

def build_context(corpus, hexagram_id, changing_lines=(), transformed_hexagram_id=None,
                  query_vector=None, top_k=3):
    """
    Assembles the chunks the model may cite.

    Mandatory context (always included, never subject to similarity ranking) is
    the reading actually cast: the hexagram's judgment and image, every changing
    line, and the transformed hexagram's judgment. Supplementary context is the
    top-k corpus matches for the user's question, which surface thematically
    related passages the cast itself would not include.

    Returns (mandatory, supplementary) where each entry is (score, chunk); the
    score is None for mandatory chunks since they bypass ranking.
    """
    mandatory = []

    def add(chunk):
        if chunk is not None and all(c["id"] != chunk["id"] for _, c in mandatory):
            mandatory.append((None, chunk))

    add(corpus.get(hexagram_id, "judgment"))
    add(corpus.get(hexagram_id, "image"))
    for position in sorted(set(changing_lines)):
        add(corpus.get(hexagram_id, "line", position))
    if transformed_hexagram_id and transformed_hexagram_id != hexagram_id:
        add(corpus.get(transformed_hexagram_id, "judgment"))

    supplementary = []
    if query_vector is not None and top_k > 0:
        exclude = {c["id"] for _, c in mandatory}
        supplementary = corpus.search(query_vector, k=top_k, exclude_ids=exclude)

    return mandatory, supplementary
