"""
stub_client.py
─────────────────────────────────────────────────────────────────────────────
A stand-in for the Claude client, for developing the client UI without an
Anthropic API key.

DEVELOPMENT ONLY. Enabled by ORACLE_STUB_MODE=1 and off by default. It is
deliberately conspicuous: every answer opens with a [STUB MODE] marker, and
GET /health reports `stub_mode: true`, so a service left in this state cannot
quietly look like it is working.

It plugs into the same `claude_client` injection point the tests use, so no
production code path branches on it — app.py simply wires a different object.

What it is good for: exercising the real request path end to end — validation,
quota accounting, retrieval, prompt assembly, response shape, and every state
in AskOracleSection (loading, answer, sources, quota exhausted, errors).

What it cannot tell you: how Claude actually writes, or whether the content
guardrails hold up against a real model. Both need a key.
─────────────────────────────────────────────────────────────────────────────
"""

import re

# Enough sentences to fill the answer card the way a real reply would, so
# layout and line-height problems show up during development.
FILLER_ZH = (
    "此卦所示，非定数，而是当下形势的一面镜子。所问之事，其机未至则宜守，其机既至则宜决；"
    "守非退缩，决非躁进，分寸皆在时机二字。观卦中所言，进退之间自有其序，勿以一时之得失论成败。"
)
FILLER_EN = (
    "This reading is not a fixed outcome but a mirror held up to the present. "
    "What you are weighing asks for patience while the moment is unripe, and "
    "decisiveness once it is not. Neither is passivity, and neither is haste — "
    "the distinction lies entirely in timing."
)


class _StubMessages:
    def create(self, **kwargs):
        prompt = kwargs["messages"][0]["content"]

        # Read the assembled prompt back so the stub answer reflects the real
        # retrieval result — useful when eyeballing which passages were chosen.
        hexagrams = re.findall(r'hexagram="第(\d+)卦 ([^ ]+) ', prompt)
        quotable = len(re.findall(r'quotable="yes"', prompt))
        withheld = len(re.findall(r'quotable="no"', prompt))
        is_chinese = bool(re.search(r'<question lang="zh">', prompt))

        cast = hexagrams[0] if hexagrams else ("?", "?")
        header = (
            f"[STUB MODE — no Claude API key configured. This text is generated "
            f"locally, not by a model.]"
        )
        detail = (
            f"第{cast[0]}卦 {cast[1]}｜上下文 {quotable + withheld} 段"
            f"（可引用原文 {quotable} 段，仅释义 {withheld} 段）"
            if is_chinese else
            f"Hexagram {cast[0]} {cast[1]} | {quotable + withheld} passages "
            f"({quotable} with source text, {withheld} interpretation-only)"
        )
        body = FILLER_ZH if is_chinese else FILLER_EN

        return _StubResponse(f"{header}\n\n{detail}\n\n{body}")


class _StubTextBlock:
    type = "text"

    def __init__(self, text):
        self.text = text


class _StubResponse:
    stop_reason = "end_turn"

    def __init__(self, text):
        self.content = [_StubTextBlock(text)]
        self.usage = type("Usage", (), {"input_tokens": 0, "output_tokens": 0})()


class StubClaudeClient:
    """Mirrors the slice of anthropic.Anthropic that oracle.ask_claude uses."""

    def __init__(self):
        self.messages = _StubMessages()
