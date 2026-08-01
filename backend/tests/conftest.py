"""
Shared fixtures.

The synthetic corpus reproduces the exact defect shapes found in the real
hexagrams.json, so the guardrail tests assert against the actual failure mode
rather than an idealised one:

  hexagram  1      — fully authored: real classical text, per-hexagram English
  hexagram  2      — fully authored, and shares a translated phrase with
                     hexagram 1 (the I Ching's own textual parallels, which
                     must NOT be mistaken for a template)
  hexagrams 20–23  — placeholder classical text ("第20卦", "雷地象",
                     "第3爻辞（third）") plus English generated from a fixed
                     skeleton and reused across all four

Four degraded hexagrams, not three: the detector treats text shared by fewer
than three hexagrams as authentic parallelism, so four leaves a margin that
lets a test repair one hexagram and still observe the rest staying flagged.
"""

import json
import math

import pytest

import config

DIMENSIONS = 4

# Reused verbatim across every degraded hexagram, and long enough to exceed the
# 60-character detection window.
BOILERPLATE_LINE_EN = (
    "Line {n}: Engage the situation's present quality with full awareness. "
    "This position serves directly beneath leadership, where loyalty and "
    "excellent execution define success."
)
BOILERPLATE_JUDGMENT_EN = (
    "Hexagram {n}: {name} — attend to its essential teaching. This hexagram "
    "embodies a specific principle; study the interaction of its trigrams as a "
    "map of your current situation."
)
BOILERPLATE_IMAGE_EN = (
    "The image of {name} captures the essential quality of this hexagram. "
    "Contemplate how that dynamic is operating in your current circumstances "
    "before you decide anything."
)

# A phrase two authentic translations genuinely share, mirroring 坤·六三 and
# 讼·六三 both carrying 「或从王事，无成」.
SHARED_AUTHENTIC_PHRASE = (
    "If by chance you are in the service of a king, seek not works, "
    "but bring to completion."
)


def _unit(vector):
    norm = math.sqrt(sum(v * v for v in vector))
    return [v / norm for v in vector]


def _chunk(hexagram, name_zh, name_en, chunk_type, vector, text_zh, text_en, line=None):
    suffix = f"line{line}" if line else chunk_type
    return {
        "hexagram_number": hexagram,
        "hexagram_name": {"chinese": name_zh, "pinyin": "Test", "english": name_en},
        "id": f"hex{hexagram:02d}-{suffix}",
        "chunk_type": chunk_type,
        "line_position": line,
        "text_zh": text_zh,
        "text_en": text_en,
        "embedding": _unit(vector),
    }


def _authored_hexagram(number, name_zh, name_en, base_vector, shared_phrase=False):
    """A hexagram authored properly in both languages."""
    chunks = [
        _chunk(number, name_zh, name_en, "judgment", base_vector,
               f"{name_zh}：元、亨、利、贞。\n{name_zh}卦的真实中文解析内容。",
               f"{name_en} works sublime success through perseverance."),
        _chunk(number, name_zh, name_en, "image",
               [v * 0.9 + 0.1 for v in base_vector],
               f"天行健，君子以自强不息。\n{name_zh}卦象辞的真实中文解析。",
               f"The movement of {name_en} is ever vigorous and unceasing."),
    ]
    for position in range(1, 7):
        english = f"Nine in place {position}: a distinct authored line for {name_en}."
        if shared_phrase and position == 3:
            english = f"Six in the third place: {SHARED_AUTHENTIC_PHRASE}"
        chunks.append(_chunk(
            number, name_zh, name_en, "line",
            [v + 0.05 * position for v in base_vector],
            f"九{position}：潜龙勿用之{position}。\n第{position}爻的真实中文解读内容。",
            english, line=position,
        ))
    return chunks


def _degraded_hexagram(number, name_zh, name_en, base_vector):
    """A hexagram whose classical text is a placeholder and English a template."""
    chunks = [
        _chunk(number, name_zh, name_en, "judgment", base_vector,
               f"第{number}卦\n{name_zh}卦的真实中文解析内容，这一层始终可信。",
               BOILERPLATE_JUDGMENT_EN.format(n=number, name=name_en)),
        _chunk(number, name_zh, name_en, "image",
               [v * 0.9 + 0.1 for v in base_vector],
               f"雷地象\n{name_zh}卦象辞的真实中文解析，这一层同样可信。",
               BOILERPLATE_IMAGE_EN.format(name=name_en)),
    ]
    for position in range(1, 7):
        chunks.append(_chunk(
            number, name_zh, name_en, "line",
            [v + 0.05 * position for v in base_vector],
            f"第{position}爻辞（third）\n{name_zh}卦第{position}爻的真实中文解读。",
            BOILERPLATE_LINE_EN.format(n=position), line=position,
        ))
    return chunks


def build_corpus_payload():
    chunks = []
    chunks += _authored_hexagram(1, "乾", "Qian", [1, 0, 0, 0])
    chunks += _authored_hexagram(2, "坤", "Kun", [0.95, 0.05, 0, 0],
                                 shared_phrase=True)
    chunks += _degraded_hexagram(20, "观", "Guan", [0, 1, 0, 0])
    chunks += _degraded_hexagram(21, "噬嗑", "Shike", [0, 0, 1, 0])
    chunks += _degraded_hexagram(22, "贲", "Bi", [0, 0, 0, 1])
    chunks += _degraded_hexagram(23, "剥", "Bo", [0, 0.5, 0.5, 0])

    return {
        "_meta": {
            "provider": "voyage",
            "model": "test-model",
            "dimensions": DIMENSIONS,
            "total_chunks": len(chunks),
            "source": "synthetic",
        },
        "chunks": chunks,
    }


@pytest.fixture
def corpus_path(tmp_path):
    path = tmp_path / "embeddings.json"
    path.write_text(json.dumps(build_corpus_payload(), ensure_ascii=False),
                    encoding="utf-8")
    return path


@pytest.fixture
def corpus(corpus_path):
    import retrieval

    return retrieval.Corpus(corpus_path)


@pytest.fixture
def db_path(tmp_path):
    return tmp_path / "quota.db"


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    import quota

    quota.limiter.reset()
    yield
    quota.limiter.reset()


@pytest.fixture
def tight_limits(monkeypatch):
    """Small allowances keep quota assertions readable."""
    monkeypatch.setattr(config, "FREE_DAILY_LIMIT", 3)
    monkeypatch.setattr(config, "PREMIUM_DAILY_LIMIT", 5)


class FakeTextBlock:
    type = "text"

    def __init__(self, text):
        self.text = text


class FakeResponse:
    def __init__(self, text, stop_reason="end_turn"):
        self.content = [FakeTextBlock(text)]
        self.stop_reason = stop_reason
        self.usage = type("U", (), {"input_tokens": 100, "output_tokens": 50})()


class FakeMessages:
    def __init__(self, parent):
        self._parent = parent

    def create(self, **kwargs):
        self._parent.calls.append(kwargs)
        if self._parent.error:
            raise self._parent.error
        return FakeResponse(self._parent.reply, self._parent.stop_reason)


class FakeClaude:
    """Stands in for anthropic.Anthropic; records the prompts it was given."""

    def __init__(self, reply="卦象所示，静候其时。", stop_reason="end_turn", error=None):
        self.reply = reply
        self.stop_reason = stop_reason
        self.error = error
        self.calls = []
        self.messages = FakeMessages(self)

    @property
    def last_prompt(self):
        return self.calls[-1]["messages"][0]["content"]

    @property
    def last_system(self):
        return self.calls[-1]["system"]


@pytest.fixture
def fake_claude():
    return FakeClaude()


@pytest.fixture
def fake_embed():
    """A fixed unit vector, nearest to hexagram 21's chunks."""
    def _embed(text, provider, model, dimensions):
        return _unit([0, 0, 1, 0.1])
    return _embed
