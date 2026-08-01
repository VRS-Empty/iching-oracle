"""
oracle.py
─────────────────────────────────────────────────────────────────────────────
Prompt assembly and the Claude call.

Each retrieved passage is rendered with an explicit `quotable` flag derived from
the corpus guardrails in retrieval.py. That flag is what lets the system prompt
draw a hard line: classical source text may be quoted only where it was
actually supplied. For the 300 line records whose classical original is missing
from hexagrams.json, the model receives the interpretation and is told, in the
same breath, that it does not have the original — which is what stops it from
reconstructing one.
─────────────────────────────────────────────────────────────────────────────
"""

import anthropic

import config

SYSTEM_PROMPT = """\
You are the interpretive voice of 易鉴 (I-Ching Oracle). A user has cast a \
hexagram and is asking a follow-up question about what it means for their \
situation.

GROUNDING — the strictest rule, and the one that matters most:
- Answer only from the passages inside <context>. They are the entirety of what \
you know about this reading.
- Never invent, reconstruct, or reword classical source text (卦辞, 爻辞, 象辞). \
Quote classical text only where it appears verbatim in a passage marked \
quotable="yes".
- A passage marked quotable="no" means its classical original was NOT supplied \
to you. Use its interpretation freely, but do not present any sentence as the \
original wording, do not translate a paraphrase back into classical Chinese, \
and do not claim to know what the original says.
- If the context does not speak to the question, say so plainly and offer what \
this reading does address. Do not fill the gap from general I-Ching knowledge.

LANGUAGE:
- Reply in the same language the user wrote their question in. If the question \
mixes languages, follow its dominant one.
- Some passages are supplied in Chinese only. Read them and answer in the \
user's language regardless; do not apologise for the source language or \
mention which languages the passages were in.

VOICE:
- Traditional in register, modern in readability. Speak the way a thoughtful \
teacher of the 易 would to someone in the middle of a real decision.
- Concrete over ornate. No mystical padding, no emoji, no bullet-point lists.

FRAMING:
- This is philosophical guidance for reflection — a mirror for the user's own \
judgement, not a prediction and not a guarantee about the future. Let that \
show in how you phrase things ("this suggests", "the hexagram counsels") \
rather than in a disclaimer bolted to the end.
- Never give medical, legal, or financial advice. If asked, redirect to the \
reflective question underneath.
- Do not tell the user what will happen. Tell them what the reading asks them \
to weigh.

LENGTH: two to three short paragraphs. Stop when the point is made.\
"""


class OracleError(RuntimeError):
    """Generation failed; the caller should refund the consumed quota."""


def _render_passage(chunk, role, score=None):
    name = chunk["hexagram_name"]
    header = (
        f'第{chunk["hexagram_number"]}卦 {name["chinese"]} '
        f'({name["pinyin"]} / {name["english"]})'
    )
    quotable = "yes" if chunk["has_classical"] else "no"
    attrs = [
        f'id="{chunk["id"]}"',
        f'role="{role}"',
        f'hexagram="{header}"',
        f'quotable="{quotable}"',
    ]
    if score is not None:
        attrs.append(f'similarity="{score:.3f}"')

    body = []
    # The constraint leads, so the model reads it before the content it governs.
    if not chunk["has_classical"]:
        body.append(
            "[No classical source text was supplied for this passage. "
            "Everything below is interpretation — do not reconstruct the "
            "original, do not render any of it back into classical Chinese, "
            "and do not present any sentence as the source text.]"
        )
    body.append(chunk["text_zh_clean"])
    # English is included only where it is genuine per-hexagram content; the
    # templated variants are withheld rather than shown as if meaningful.
    if chunk["text_en_clean"]:
        body.append(chunk["text_en_clean"])

    return f'<passage {" ".join(attrs)}>\n' + "\n".join(body) + "\n</passage>"


def _role_for(chunk, hexagram_id, transformed_id):
    if chunk["chunk_type"] == "judgment":
        if chunk["hexagram_number"] == transformed_id and transformed_id != hexagram_id:
            return "变卦卦辞 transformed hexagram judgment"
        return "本卦卦辞 judgment"
    if chunk["chunk_type"] == "image":
        return "本卦象辞 image"
    return f'变爻 changing line {chunk["line_position"]}'


def build_prompt(mandatory, supplementary, question, hexagram_id,
                 transformed_id=None, lang="zh"):
    """Returns the user-turn text: the reading, related passages, the question."""
    blocks = ["<context>", "<!-- The cast reading. This is the primary basis. -->"]
    for _, chunk in mandatory:
        blocks.append(_render_passage(chunk, _role_for(chunk, hexagram_id, transformed_id)))

    if supplementary:
        blocks.append(
            "<!-- Thematically related passages retrieved for this question. "
            "Supporting material only — the reading above takes precedence. -->"
        )
        for score, chunk in supplementary:
            blocks.append(_render_passage(chunk, "相关参考 related passage", score))

    blocks.append("</context>")
    blocks.append("")
    blocks.append(f"<question lang=\"{lang}\">\n{question}\n</question>")
    blocks.append("")
    blocks.append(
        "Answer the question above, grounded in the passages, in the "
        "language the question was written in."
    )
    return "\n".join(blocks)


def ask_claude(prompt, client=None):
    """Calls Claude and returns the answer text. Raises OracleError on failure."""
    if client is None:
        if not config.ANTHROPIC_API_KEY:
            raise OracleError("ANTHROPIC_API_KEY is not configured")
        client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)

    try:
        response = client.messages.create(
            model=config.CLAUDE_MODEL,
            max_tokens=config.MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.APIStatusError as exc:
        raise OracleError(f"Claude API error {exc.status_code}: {exc.message}") from exc
    except anthropic.APIConnectionError as exc:
        raise OracleError(f"could not reach the Claude API: {exc}") from exc

    if response.stop_reason == "refusal":
        raise OracleError("the model declined to answer this question")

    text = "".join(
        block.text for block in response.content if block.type == "text"
    ).strip()
    if not text:
        raise OracleError("the model returned an empty answer")

    return text, response
