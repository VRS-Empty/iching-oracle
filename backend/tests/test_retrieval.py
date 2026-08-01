"""
Retrieval and content-guardrail tests.

The guardrail cases carry the weight here: they encode the decision that source
content which is a placeholder or a generated template is withheld from the
model rather than passed through and hoped for.
"""

import json

import pytest

import retrieval
from conftest import (
    BOILERPLATE_JUDGMENT_EN,
    BOILERPLATE_LINE_EN,
    SHARED_AUTHENTIC_PHRASE,
    build_corpus_payload,
)

AUTHORED = 1        # fully authored hexagram
AUTHORED_PARALLEL = 2  # authored, shares a translated phrase with hexagram 1
DEGRADED = 20       # placeholder classical text + templated English


# ─── Loading ──────────────────────────────────────────────────────────────────

def test_corpus_loads_metadata_and_vectors(corpus):
    assert corpus.provider == "voyage"
    assert corpus.dimensions == 4
    assert len(corpus.chunks) == 48  # 6 hexagrams × (judgment + image + 6 lines)
    assert corpus.matrix.shape == (48, 4)


def test_vectors_are_normalised_on_load(corpus):
    norms = (corpus.matrix ** 2).sum(axis=1) ** 0.5
    assert all(abs(float(n) - 1.0) < 1e-6 for n in norms)


def test_empty_corpus_is_rejected(tmp_path):
    path = tmp_path / "empty.json"
    path.write_text('{"_meta": {"provider": "voyage", "model": "m", '
                    '"dimensions": 4}, "chunks": []}', encoding="utf-8")
    with pytest.raises(ValueError, match="no chunks"):
        retrieval.Corpus(path)


# ─── Guardrail: placeholder classical text ────────────────────────────────────

def test_authored_chunks_are_marked_quotable(corpus):
    for chunk_type, line in (("judgment", None), ("image", None), ("line", 3)):
        chunk = corpus.get(AUTHORED, chunk_type, line)
        assert chunk["has_classical"] is True, chunk["id"]


def test_placeholder_chunks_are_marked_not_quotable(corpus):
    for chunk_type, line in (("judgment", None), ("image", None), ("line", 3)):
        chunk = corpus.get(DEGRADED, chunk_type, line)
        assert chunk["has_classical"] is False, chunk["id"]


@pytest.mark.parametrize("head,expected", [
    ("乾：元、亨、利、贞。", True),
    ("天行健，君子以自强不息。", True),
    ("九三：君子终日乾乾。", True),
    ("第16卦", False),        # judgment placeholder
    ("第7卦", False),
    ("雷地象", False),        # image placeholder
    ("泽火象", False),
    ("第3爻辞（third）", False),   # line placeholder
    ("第3爻辞(third)", False),     # ASCII parentheses variant
    ("短", False),           # too short to be source text
    ("没有标点的一句话", False),  # authentic classical text is punctuated
])
def test_classical_authenticity_rules(head, expected):
    assert retrieval.is_authentic_classical(head) is expected


def test_placeholder_head_is_dropped_from_model_context(corpus):
    chunk = corpus.get(DEGRADED, "judgment")
    assert f"第{DEGRADED}卦" not in chunk["text_zh_clean"]
    assert "雷地象" not in corpus.get(DEGRADED, "image")["text_zh_clean"]
    assert "爻辞（" not in corpus.get(DEGRADED, "line", 1)["text_zh_clean"]


def test_authentic_head_is_preserved_for_quoting(corpus):
    chunk = corpus.get(AUTHORED, "judgment")
    assert chunk["text_zh_clean"].startswith("乾：元、亨、利、贞。")


def test_real_chinese_interpretation_always_survives(corpus):
    """Dropping a placeholder must never leave a chunk with nothing to say."""
    for chunk in corpus.chunks:
        assert len(chunk["text_zh_clean"].strip()) > 10, chunk["id"]


# ─── Guardrail: templated English ─────────────────────────────────────────────

def test_templated_english_is_withheld(corpus):
    for chunk_type, line in (("judgment", None), ("image", None), ("line", 2)):
        chunk = corpus.get(DEGRADED, chunk_type, line)
        assert chunk["en_usable"] is False, chunk["id"]
        assert chunk["text_en_clean"] == ""


def test_authored_english_is_kept(corpus):
    chunk = corpus.get(AUTHORED, "line", 2)
    assert chunk["en_usable"] is True
    assert "distinct authored line" in chunk["text_en_clean"]


def test_genuine_textual_parallels_are_not_mistaken_for_templates(corpus):
    """
    The I Ching's own parallels (坤·六三 and 讼·六三 share 「或从王事，无成」) give two
    hexagrams near-identical translations. That is authentic content and must
    survive; only text recurring across three or more hexagrams is a template.
    """
    chunk = corpus.get(AUTHORED_PARALLEL, "line", 3)
    assert chunk["en_usable"] is True
    assert SHARED_AUTHENTIC_PHRASE in chunk["text_en_clean"]


def test_the_two_detectors_agree_on_every_chunk(corpus):
    """
    Placeholder Chinese and templated English are detected by wholly independent
    signals. In this corpus — as in the real one — they identify the same
    records, which is the cross-check that neither rule has drifted.
    """
    for chunk in corpus.chunks:
        assert chunk["has_classical"] == chunk["en_usable"], chunk["id"]


def test_detection_is_data_driven_not_hardcoded(tmp_path):
    """Authoring the content properly must re-enable it with no code change."""
    payload = build_corpus_payload()
    for chunk in payload["chunks"]:
        if chunk["hexagram_number"] != DEGRADED:
            continue
        number = chunk["hexagram_number"]
        if chunk["chunk_type"] == "line":
            position = chunk["line_position"]
            chunk["text_zh"] = (f"九{position}：真实的爻辞原文之{position}。\n"
                               f"第{position}爻的解读。")
            chunk["text_en"] = f"A properly authored line {position} for hexagram {number}."
        else:
            chunk["text_zh"] = f"观：盥而不荐，有孚颙若。\n{chunk['chunk_type']} 的解读。"
            chunk["text_en"] = f"A properly authored {chunk['chunk_type']} for hexagram {number}."

    path = tmp_path / "fixed.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    fixed = retrieval.Corpus(path)

    for chunk_type, line in (("judgment", None), ("image", None), ("line", 2)):
        chunk = fixed.get(DEGRADED, chunk_type, line)
        assert chunk["has_classical"] is True, chunk["id"]
        assert chunk["en_usable"] is True, chunk["id"]

    # The three hexagrams left untouched still share the template with each
    # other, so they stay flagged — the rule tracks the data, it is not keyed
    # to hexagram numbers.
    for number in (21, 22, 23):
        assert fixed.get(number, "line", 2)["en_usable"] is False, number
        assert fixed.get(number, "judgment")["en_usable"] is False, number


def test_template_detection_needs_three_hexagrams_to_fire(tmp_path):
    """
    A documented trade-off: text shared by only two hexagrams is treated as
    authentic parallelism, because the I Ching contains exactly such pairs.
    Repairing all but two degraded hexagrams therefore leaves the last two
    unflagged — under-detection the real corpus never approaches, where the
    template recurs across forty-nine hexagrams.
    """
    payload = build_corpus_payload()
    payload["chunks"] = [
        c for c in payload["chunks"] if c["hexagram_number"] not in (22, 23)
    ]
    path = tmp_path / "two-degraded.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    corpus = retrieval.Corpus(path)

    # English slips through with only two sharers...
    assert corpus.get(DEGRADED, "line", 2)["en_usable"] is True
    # ...but the Chinese placeholder detector is independent and still fires,
    # so the model is never told it may quote source text it did not receive.
    assert corpus.get(DEGRADED, "line", 2)["has_classical"] is False


def test_boilerplate_strings_never_reach_the_cleaned_text(corpus):
    for chunk in corpus.chunks:
        assert BOILERPLATE_LINE_EN.format(n=1) not in chunk["text_en_clean"]
        assert "attend to its essential teaching" not in chunk["text_en_clean"]


# ─── Similarity search ────────────────────────────────────────────────────────

def test_search_returns_k_results_ordered_by_similarity(corpus):
    results = corpus.search([0, 0, 1, 0], k=3)
    assert len(results) == 3
    scores = [score for score, _ in results]
    assert scores == sorted(scores, reverse=True)


def test_search_honours_exclusions(corpus):
    top_id = corpus.search([0, 0, 1, 0], k=1)[0][1]["id"]
    results = corpus.search([0, 0, 1, 0], k=3, exclude_ids={top_id})
    assert all(chunk["id"] != top_id for _, chunk in results)


def test_search_finds_the_semantically_nearest_chunk(corpus):
    score, chunk = corpus.search([1, 0, 0, 0], k=1)[0]
    assert chunk["id"] == "hex01-judgment"
    assert score == pytest.approx(1.0, abs=1e-5)


def test_search_rejects_wrong_dimensionality(corpus):
    with pytest.raises(ValueError, match="dims"):
        corpus.search([1, 0, 0], k=1)


def test_search_rejects_zero_vector(corpus):
    with pytest.raises(ValueError, match="zeros"):
        corpus.search([0, 0, 0, 0], k=1)


# ─── Context assembly ─────────────────────────────────────────────────────────

def test_mandatory_context_covers_the_cast_reading(corpus):
    mandatory, _ = retrieval.build_context(
        corpus, hexagram_id=AUTHORED, changing_lines=[2, 5],
        transformed_hexagram_id=DEGRADED, query_vector=None,
    )
    ids = [chunk["id"] for _, chunk in mandatory]
    assert ids == ["hex01-judgment", "hex01-image", "hex01-line2",
                   "hex01-line5", "hex20-judgment"]


def test_mandatory_context_scores_are_none(corpus):
    mandatory, _ = retrieval.build_context(corpus, hexagram_id=AUTHORED)
    assert all(score is None for score, _ in mandatory)


def test_changing_lines_are_deduplicated_and_sorted(corpus):
    mandatory, _ = retrieval.build_context(
        corpus, hexagram_id=AUTHORED, changing_lines=[5, 2, 5],
    )
    lines = [c["line_position"] for _, c in mandatory if c["chunk_type"] == "line"]
    assert lines == [2, 5]


def test_transformed_hexagram_equal_to_original_is_not_duplicated(corpus):
    mandatory, _ = retrieval.build_context(
        corpus, hexagram_id=AUTHORED, transformed_hexagram_id=AUTHORED,
    )
    ids = [chunk["id"] for _, chunk in mandatory]
    assert ids == ["hex01-judgment", "hex01-image"]


def test_supplementary_never_repeats_mandatory_chunks(corpus, fake_embed):
    vector = fake_embed("q", "voyage", "test-model", 4)
    mandatory, supplementary = retrieval.build_context(
        corpus, hexagram_id=21, changing_lines=[1, 2, 3],
        query_vector=vector, top_k=3,
    )
    mandatory_ids = {chunk["id"] for _, chunk in mandatory}
    supplementary_ids = {chunk["id"] for _, chunk in supplementary}
    assert not (mandatory_ids & supplementary_ids)
    assert len(supplementary) == 3


def test_no_query_vector_yields_no_supplementary_context(corpus):
    _, supplementary = retrieval.build_context(corpus, hexagram_id=AUTHORED,
                                               query_vector=None)
    assert supplementary == []


def test_unknown_hexagram_yields_empty_mandatory_context(corpus):
    mandatory, _ = retrieval.build_context(corpus, hexagram_id=64)
    assert mandatory == []
