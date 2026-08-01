"""
End-to-end tests for POST /api/ask.

These exercise the real request path — validation, quota, retrieval, prompt
assembly, response shaping — with only the two network calls (embedding and
Claude) replaced by fakes.
"""

import json

import pytest

import config
import embedding
import oracle
import quota
from app import create_app
from conftest import BOILERPLATE_LINE_EN, FakeClaude


@pytest.fixture
def client(corpus, fake_claude, fake_embed, db_path):
    app = create_app(corpus=corpus, claude_client=fake_claude,
                     embed_fn=fake_embed, db_path=db_path)
    app.config.update(TESTING=True)
    return app.test_client()


def payload(**overrides):
    body = {
        "device_id": "device-abc",
        "hexagram_id": 1,
        "changing_lines": [2, 5],
        "transformed_hexagram_id": 20,
        "question": "这个卦对我换工作意味着什么？",
        "lang": "zh",
        "is_premium": False,
    }
    body.update(overrides)
    return body


def post(client, **overrides):
    return client.post("/api/ask", json=payload(**overrides))


# ─── Health ───────────────────────────────────────────────────────────────────

def test_health_reports_corpus_state(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "ok"
    assert body["chunks"] == 48
    assert body["provider"] == "voyage"


# ─── Happy path ───────────────────────────────────────────────────────────────

def test_successful_question_returns_answer_and_quota(client, fake_claude):
    response = post(client)
    assert response.status_code == 200
    body = response.get_json()
    assert body["answer"] == fake_claude.reply
    assert body["daily_limit"] == config.FREE_DAILY_LIMIT
    assert body["remaining_quota"] == config.FREE_DAILY_LIMIT - 1


def test_sources_describe_the_cast_reading_then_related_passages(client):
    body = post(client).get_json()
    mandatory = [s for s in body["sources"] if s["mandatory"]]
    supplementary = [s for s in body["sources"] if not s["mandatory"]]

    assert [(s["hexagram"], s["chunk_type"], s["line"]) for s in mandatory] == [
        (1, "judgment", None), (1, "image", None),
        (1, "line", 2), (1, "line", 5), (20, "judgment", None),
    ]
    assert len(supplementary) == config.TOP_K


def test_answer_language_hint_is_passed_through(client, fake_claude):
    post(client, lang="en")
    assert 'lang="en"' in fake_claude.last_prompt


# ─── Prompt construction and guardrails ───────────────────────────────────────

def test_prompt_marks_authentic_lines_quotable(client, fake_claude):
    post(client, hexagram_id=1, changing_lines=[3], transformed_hexagram_id=None)
    prompt = fake_claude.last_prompt
    assert 'id="hex01-line3"' in prompt
    segment = prompt.split('id="hex01-line3"')[1].split("</passage>")[0]
    assert 'quotable="yes"' in segment


def test_prompt_marks_placeholder_lines_not_quotable(client, fake_claude):
    post(client, hexagram_id=20, changing_lines=[1], transformed_hexagram_id=None)
    prompt = fake_claude.last_prompt
    segment = prompt.split('id="hex20-line1"')[1].split("</passage>")[0]
    assert 'quotable="no"' in segment
    assert "No classical source text was supplied" in segment
    assert "do not reconstruct the original" in segment


def test_prompt_withholds_boilerplate_english(client, fake_claude):
    post(client, hexagram_id=20, changing_lines=[1, 2, 3],
         transformed_hexagram_id=None)
    prompt = fake_claude.last_prompt
    for position in (1, 2, 3):
        assert BOILERPLATE_LINE_EN.format(n=position) not in prompt


def test_prompt_keeps_genuine_english(client, fake_claude):
    post(client, hexagram_id=1, changing_lines=[2], transformed_hexagram_id=None)
    assert "a distinct authored line" in fake_claude.last_prompt


def test_prompt_never_leaks_the_placeholder_string(client, fake_claude):
    post(client, hexagram_id=20, changing_lines=[1, 2],
         transformed_hexagram_id=None)
    assert "爻辞（beginning）" not in fake_claude.last_prompt


def test_prompt_preserves_real_chinese_interpretation(client, fake_claude):
    post(client, hexagram_id=20, changing_lines=[1], transformed_hexagram_id=None)
    assert "观卦第1爻的真实中文解读" in fake_claude.last_prompt


def test_system_prompt_states_the_grounding_and_framing_rules(client, fake_claude):
    post(client)
    system = fake_claude.last_system
    assert "Never invent, reconstruct, or reword classical source text" in system
    assert "philosophical guidance" in system
    assert "not a prediction" in system


def test_question_is_included_verbatim(client, fake_claude):
    post(client, question="事业上我该进还是该退？")
    assert "事业上我该进还是该退？" in fake_claude.last_prompt


def test_model_and_token_cap_come_from_config(client, fake_claude):
    post(client)
    call = fake_claude.calls[-1]
    assert call["model"] == config.CLAUDE_MODEL
    assert call["max_tokens"] == config.MAX_TOKENS


# ─── Validation ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("overrides,expected_code", [
    ({"device_id": ""}, "invalid_request"),
    ({"device_id": None}, "invalid_request"),
    ({"question": "   "}, "invalid_request"),
    ({"question": "x" * 201}, "question_too_long"),
    ({"hexagram_id": 0}, "invalid_request"),
    ({"hexagram_id": 65}, "invalid_request"),
    ({"hexagram_id": "1"}, "invalid_request"),
    ({"changing_lines": [0]}, "invalid_request"),
    ({"changing_lines": [7]}, "invalid_request"),
    ({"changing_lines": "2"}, "invalid_request"),
    ({"transformed_hexagram_id": 99}, "invalid_request"),
])
def test_invalid_requests_are_rejected(client, overrides, expected_code):
    response = post(client, **overrides)
    assert response.status_code == 400
    assert response.get_json()["error"] == expected_code


def test_errors_carry_bilingual_messages(client):
    body = post(client, question="x" * 201).get_json()
    assert body["message_zh"] and body["message_en"]
    assert body["message_zh"] != body["message_en"]
    assert body["max_chars"] == config.MAX_QUESTION_CHARS


def test_question_at_the_limit_is_accepted(client):
    assert post(client, question="问" * config.MAX_QUESTION_CHARS).status_code == 200


def test_unknown_language_falls_back_rather_than_failing(client, fake_claude):
    assert post(client, lang="fr").status_code == 200
    assert 'lang="zh"' in fake_claude.last_prompt


def test_empty_body_is_rejected(client):
    response = client.post("/api/ask", data="", content_type="application/json")
    assert response.status_code == 400


# ─── Quota ────────────────────────────────────────────────────────────────────

def test_free_allowance_is_enforced_across_requests(client, tight_limits):
    for expected in (2, 1, 0):
        body = post(client).get_json()
        assert body["remaining_quota"] == expected

    response = post(client)
    assert response.status_code == 429
    body = response.get_json()
    assert body["error"] == "quota_exceeded"
    assert body["remaining_quota"] == 0
    assert body["daily_limit"] == 3


def test_premium_flag_raises_the_ceiling(client, tight_limits):
    for _ in range(3):
        post(client)
    assert post(client).status_code == 429  # free ceiling reached
    assert post(client, is_premium=True).status_code == 200


def test_quota_is_tracked_per_device(client, tight_limits):
    for _ in range(3):
        post(client, device_id="device-a")
    assert post(client, device_id="device-a").status_code == 429
    assert post(client, device_id="device-b").status_code == 200


def test_exhausted_quota_does_not_call_claude(client, fake_claude, tight_limits):
    for _ in range(3):
        post(client)
    calls_before = len(fake_claude.calls)
    post(client)
    assert len(fake_claude.calls) == calls_before


# ─── Rate limiting ────────────────────────────────────────────────────────────

def test_rate_limit_blocks_bursts(client, monkeypatch):
    monkeypatch.setattr(quota.limiter, "max_requests", 2)
    quota.limiter.reset()
    assert post(client, device_id="d1").status_code == 200
    assert post(client, device_id="d2").status_code == 200
    response = post(client, device_id="d3")
    assert response.status_code == 429
    assert response.get_json()["error"] == "rate_limited"


def test_rate_limited_request_consumes_no_quota(client, monkeypatch, db_path,
                                                tight_limits):
    monkeypatch.setattr(quota.limiter, "max_requests", 1)
    quota.limiter.reset()
    post(client, device_id="dev-x")
    post(client, device_id="dev-x")  # rejected by the rate limiter
    assert quota.remaining("dev-x", False, db_path) == 2


# ─── Upstream failures ────────────────────────────────────────────────────────

def test_embedding_failure_returns_502_and_refunds(corpus, fake_claude, db_path,
                                                   tight_limits):
    def failing_embed(*args, **kwargs):
        raise embedding.EmbeddingError("provider down")

    app = create_app(corpus=corpus, claude_client=fake_claude,
                     embed_fn=failing_embed, db_path=db_path)
    response = app.test_client().post("/api/ask", json=payload())

    assert response.status_code == 502
    assert response.get_json()["error"] == "upstream_error"
    # The user was not charged for an answer they never received.
    assert quota.remaining("device-abc", False, db_path) == 3


def test_claude_failure_returns_502_and_refunds(corpus, fake_embed, db_path,
                                                tight_limits):
    broken = FakeClaude(error=RuntimeError("boom"))
    app = create_app(corpus=corpus, claude_client=broken,
                     embed_fn=fake_embed, db_path=db_path)
    response = app.test_client().post("/api/ask", json=payload())

    assert response.status_code in (500, 502)
    assert quota.remaining("device-abc", False, db_path) == 3


def test_model_refusal_is_surfaced_and_refunded(corpus, fake_embed, db_path,
                                                tight_limits):
    refusing = FakeClaude(stop_reason="refusal")
    app = create_app(corpus=corpus, claude_client=refusing,
                     embed_fn=fake_embed, db_path=db_path)
    response = app.test_client().post("/api/ask", json=payload())

    assert response.status_code == 502
    assert response.get_json()["error"] == "upstream_error"
    assert quota.remaining("device-abc", False, db_path) == 3


def test_upstream_errors_do_not_leak_internals(corpus, fake_embed, db_path):
    broken = FakeClaude(error=RuntimeError("ANTHROPIC_API_KEY=sk-ant-secret"))
    app = create_app(corpus=corpus, claude_client=broken,
                     embed_fn=fake_embed, db_path=db_path)
    body = app.test_client().post("/api/ask", json=payload()).get_json()
    assert "sk-ant" not in json.dumps(body)
