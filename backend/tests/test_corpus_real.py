"""
Regression tests against the real 512-chunk corpus.

The synthetic fixtures elsewhere prove the guardrail *logic*; this file pins its
verdict on the actual shipped data. It is skipped when embeddings.json has not
been built, so a fresh clone can still run the suite.

Expected counts come from auditing hexagrams.json. Authoring stopped at a
different point for each kind of record:

    judgment  classical text authentic for hexagrams 1–15   → 15 of 64
    image     classical text authentic for hexagrams 1–15   → 15 of 64
    lines     classical text authentic for hexagrams 1–14   → 84 of 384

Beyond those points the `chinese` field holds a placeholder ("第16卦",
"雷地象", "第3爻辞（third）") and the English is generated from a fixed skeleton.
The Chinese interpretation prose is authentic throughout — it is what grounds
an answer for the remaining hexagrams.

If hexagrams.json is ever repaired, these numbers should rise and this file is
where that shows up first.
"""

import pytest

import config
import retrieval

pytestmark = pytest.mark.skipif(
    not config.EMBEDDINGS_PATH.exists(),
    reason="embeddings.json not built; run scripts/build_embeddings.py",
)

AUTHORED_JUDGMENTS = 15
AUTHORED_IMAGES = 15
AUTHORED_LINES = 84
LAST_AUTHORED_JUDGMENT_HEXAGRAM = 15
LAST_AUTHORED_LINE_HEXAGRAM = 14


@pytest.fixture(scope="module")
def real_corpus():
    return retrieval.Corpus(config.EMBEDDINGS_PATH)


def test_corpus_covers_every_hexagram_and_line(real_corpus):
    assert len(real_corpus.chunks) == 512
    assert len({c["hexagram_number"] for c in real_corpus.chunks}) == 64
    counts = {}
    for chunk in real_corpus.chunks:
        counts[chunk["chunk_type"]] = counts.get(chunk["chunk_type"], 0) + 1
    assert counts == {"judgment": 64, "image": 64, "line": 384}


@pytest.mark.parametrize("chunk_type,expected,last_hexagram", [
    ("judgment", AUTHORED_JUDGMENTS, LAST_AUTHORED_JUDGMENT_HEXAGRAM),
    ("image", AUTHORED_IMAGES, LAST_AUTHORED_JUDGMENT_HEXAGRAM),
    ("line", AUTHORED_LINES, LAST_AUTHORED_LINE_HEXAGRAM),
])
def test_quotable_counts_match_the_data_audit(real_corpus, chunk_type,
                                              expected, last_hexagram):
    chunks = [c for c in real_corpus.chunks if c["chunk_type"] == chunk_type]
    quotable = [c for c in chunks if c["has_classical"]]
    assert len(quotable) == expected
    # Authentic source text is contiguous from hexagram 1 to the cut-off.
    assert max(c["hexagram_number"] for c in quotable) == last_hexagram


def test_the_two_detectors_agree_on_every_chunk(real_corpus):
    """
    Placeholder Chinese and templated English are found by wholly independent
    signals — a regex over the leading line versus verbatim windows recurring
    across hexagrams. They classify all 512 chunks identically, which is the
    cross-check that neither has drifted.
    """
    disagreements = [
        c["id"] for c in real_corpus.chunks
        if c["has_classical"] != c["en_usable"]
    ]
    assert disagreements == []


def test_degraded_english_is_withheld_entirely(real_corpus):
    withheld = [c for c in real_corpus.chunks if not c["en_usable"]]
    assert len(withheld) == 512 - (AUTHORED_JUDGMENTS + AUTHORED_IMAGES
                                   + AUTHORED_LINES)
    assert all(c["text_en_clean"] == "" for c in withheld)


def test_no_placeholder_text_survives_into_model_context(real_corpus):
    import re

    placeholder = re.compile(r"^(第\s*\d+\s*卦$|[一-鿿]{1,4}象$|第\s*\d+\s*爻辞)")
    for chunk in real_corpus.chunks:
        assert not placeholder.match(chunk["text_zh_clean"]), chunk["id"]


def test_every_chunk_still_carries_real_chinese_content(real_corpus):
    """Stripping a placeholder must never leave a chunk with nothing to say."""
    for chunk in real_corpus.chunks:
        assert len(chunk["text_zh_clean"].strip()) > 20, chunk["id"]


def test_authentic_classical_text_is_preserved_for_quoting(real_corpus):
    judgment = real_corpus.get(1, "judgment")
    assert judgment["has_classical"] is True
    assert judgment["text_zh_clean"].startswith("乾：元、亨、利、贞。")


def test_retrieval_surfaces_thematically_related_passages(real_corpus):
    revolution = real_corpus.get(49, "judgment")  # 革 — Revolution
    results = real_corpus.search(revolution["embedding"], k=5,
                                 exclude_ids={revolution["id"]})
    assert len(results) == 5
    assert all(score > 0.5 for score, _ in results)
    assert any(chunk["hexagram_number"] == 49 for _, chunk in results)


def test_context_assembly_on_a_real_cast(real_corpus):
    mandatory, supplementary = retrieval.build_context(
        real_corpus, hexagram_id=49, changing_lines=[2, 4],
        transformed_hexagram_id=17,
        query_vector=real_corpus.get(49, "judgment")["embedding"],
        top_k=3,
    )
    ids = [c["id"] for _, c in mandatory]
    assert ids == ["hex49-judgment", "hex49-image", "hex49-line2",
                   "hex49-line4", "hex17-judgment"]
    assert len(supplementary) == 3
    assert not ({c["id"] for _, c in supplementary} & set(ids))
