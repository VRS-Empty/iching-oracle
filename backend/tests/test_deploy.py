"""
Deploy-path tests.

The corpus is gitignored, so on a fresh deploy it arrives either as a mounted
Secret File or via a build-time download. Both routes fail in ways the app
should explain rather than crash on, and the download runs unattended during a
Render build — the place where a silent bug costs the most to diagnose.
"""

import json

import pytest

import config
import fetch_corpus
import retrieval
from app import create_app
from conftest import build_corpus_payload
from stub_client import StubClaudeClient


# ─── Missing corpus ───────────────────────────────────────────────────────────

def test_missing_corpus_raises_an_actionable_error(tmp_path):
    missing = tmp_path / "nowhere" / "embeddings.json"
    with pytest.raises(FileNotFoundError) as excinfo:
        retrieval.Corpus(missing)

    message = str(excinfo.value)
    assert "not committed" in message              # says why it is absent
    assert "build_embeddings.py" in message        # how to make one locally
    assert "EMBEDDINGS_PATH" in message            # how to point at one on Render


def test_corpus_accepts_a_path_outside_the_package(tmp_path):
    """A Secret File mounts under /etc/secrets, not inside the source tree."""
    mounted = tmp_path / "etc" / "secrets" / "embeddings.json"
    mounted.parent.mkdir(parents=True)
    mounted.write_text(json.dumps(build_corpus_payload(), ensure_ascii=False),
                       encoding="utf-8")

    corpus = retrieval.Corpus(mounted)
    assert len(corpus.chunks) == 48


# ─── Build-time download validation ───────────────────────────────────────────

def _write(tmp_path, payload, name="c.json"):
    path = tmp_path / name
    path.write_text(payload if isinstance(payload, str)
                    else json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def test_validate_accepts_a_real_corpus(tmp_path, monkeypatch):
    monkeypatch.setattr(fetch_corpus, "EXPECTED_CHUNKS", 48)
    ok, message = fetch_corpus.validate(_write(tmp_path, build_corpus_payload()))
    assert ok is True
    assert "48 chunks" in message
    assert "voyage" in message


def test_validate_rejects_an_html_error_page(tmp_path):
    """The most likely real failure: an expired link returning a web page."""
    ok, message = fetch_corpus.validate(
        _write(tmp_path, "<!DOCTYPE html><html><body>404 Not Found</body></html>"))
    assert ok is False
    assert "not valid JSON" in message
    assert "HTML error page" in message


def test_validate_rejects_a_truncated_corpus(tmp_path, monkeypatch):
    monkeypatch.setattr(fetch_corpus, "EXPECTED_CHUNKS", 48)
    payload = build_corpus_payload()
    payload["chunks"] = payload["chunks"][:10]
    ok, message = fetch_corpus.validate(_write(tmp_path, payload))
    assert ok is False
    assert "expected 48 chunks, found 10" in message


def test_validate_rejects_a_corpus_missing_provider_metadata(tmp_path, monkeypatch):
    """Without provider/model the backend cannot embed queries comparably."""
    monkeypatch.setattr(fetch_corpus, "EXPECTED_CHUNKS", 48)
    payload = build_corpus_payload()
    payload["_meta"].pop("provider")
    ok, message = fetch_corpus.validate(_write(tmp_path, payload))
    assert ok is False
    assert "provider/model" in message


def test_validate_rejects_vectors_that_disagree_with_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr(fetch_corpus, "EXPECTED_CHUNKS", 48)
    payload = build_corpus_payload()
    payload["_meta"]["dimensions"] = 512  # vectors are 4-dimensional
    ok, message = fetch_corpus.validate(_write(tmp_path, payload))
    assert ok is False
    assert "do not match _meta.dimensions" in message


def test_validate_rejects_an_unreadable_path(tmp_path):
    ok, message = fetch_corpus.validate(tmp_path / "does-not-exist.json")
    assert ok is False
    assert "unreadable" in message


def test_fetch_without_a_url_fails_with_guidance(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("EMBEDDINGS_PATH", str(tmp_path / "absent.json"))
    monkeypatch.delenv("CORPUS_URL", raising=False)

    assert fetch_corpus.main() == 1
    stderr = capsys.readouterr().err
    assert "CORPUS_URL is not set" in stderr
    assert "README.md" in stderr


def test_fetch_skips_when_a_valid_corpus_is_already_present(tmp_path, monkeypatch,
                                                            capsys):
    """Re-running the build step must not re-download."""
    monkeypatch.setattr(fetch_corpus, "EXPECTED_CHUNKS", 48)
    present = _write(tmp_path, build_corpus_payload(), "embeddings.json")
    monkeypatch.setenv("EMBEDDINGS_PATH", str(present))
    # No CORPUS_URL set: if it tried to download, it would fail.
    monkeypatch.delenv("CORPUS_URL", raising=False)

    assert fetch_corpus.main() == 0
    assert "skipping download" in capsys.readouterr().out


# ─── Stub mode ────────────────────────────────────────────────────────────────

def test_stub_mode_is_off_by_default():
    assert config.STUB_MODE is False


@pytest.mark.parametrize("value,expected", [
    ("1", True), ("true", True), ("TRUE", True), ("yes", True),
    ("0", False), ("false", False), ("", False), ("no", False),
])
def test_stub_mode_env_parsing(value, expected, monkeypatch):
    monkeypatch.setenv("ORACLE_STUB_MODE", value)
    import importlib
    reloaded = importlib.reload(config)
    try:
        assert reloaded.STUB_MODE is expected
    finally:
        monkeypatch.delenv("ORACLE_STUB_MODE", raising=False)
        importlib.reload(config)


def test_health_reports_stub_mode(corpus, fake_embed, db_path, monkeypatch):
    monkeypatch.setattr(config, "STUB_MODE", True)
    app = create_app(corpus=corpus, embed_fn=fake_embed, db_path=db_path)
    body = app.test_client().get("/health").get_json()
    assert body["stub_mode"] is True


def test_stub_answers_are_conspicuously_marked(corpus, fake_embed, db_path,
                                               monkeypatch):
    """A stub answer must never be mistakable for a real one."""
    monkeypatch.setattr(config, "STUB_MODE", True)
    app = create_app(corpus=corpus, embed_fn=fake_embed, db_path=db_path)
    response = app.test_client().post("/api/ask", json={
        "device_id": "stub-dev", "hexagram_id": 1, "changing_lines": [2],
        "question": "换工作合适吗？", "lang": "zh",
    })
    assert response.status_code == 200
    answer = response.get_json()["answer"]
    assert answer.startswith("[STUB MODE")
    assert "no Claude API key" in answer


def test_stub_mode_exercises_the_real_request_path(corpus, fake_embed, db_path,
                                                   monkeypatch):
    """Quota, retrieval and response shape must behave exactly as in production."""
    monkeypatch.setattr(config, "STUB_MODE", True)
    monkeypatch.setattr(config, "FREE_DAILY_LIMIT", 2)
    app = create_app(corpus=corpus, embed_fn=fake_embed, db_path=db_path)
    client = app.test_client()

    def ask():
        return client.post("/api/ask", json={
            "device_id": "stub-dev", "hexagram_id": 1, "changing_lines": [2],
            "transformed_hexagram_id": 20, "question": "问", "lang": "zh",
        })

    first = ask().get_json()
    assert first["remaining_quota"] == 1
    # The cast contributes judgment + image + one changing line + the
    # transformed hexagram's judgment; retrieval adds TOP_K on top.
    mandatory = [s for s in first["sources"] if s["mandatory"]]
    supplementary = [s for s in first["sources"] if not s["mandatory"]]
    assert len(mandatory) == 4
    assert len(supplementary) == config.TOP_K

    ask()
    exhausted = ask()
    assert exhausted.status_code == 429
    assert exhausted.get_json()["error"] == "quota_exceeded"


def test_stub_reflects_the_retrieved_context(corpus, fake_embed, db_path):
    """The canned text reports the real guardrail verdict, so it stays useful."""
    stub = StubClaudeClient()
    app = create_app(corpus=corpus, claude_client=stub, embed_fn=fake_embed,
                     db_path=db_path)
    answer = app.test_client().post("/api/ask", json={
        "device_id": "d", "hexagram_id": 20, "changing_lines": [1],
        "question": "问", "lang": "zh",
    }).get_json()["answer"]

    # Hexagram 20 is a placeholder hexagram in the fixture, so its passages
    # are interpretation-only and the stub should say so.
    assert "第20卦" in answer
    assert "仅释义" in answer


def test_explicit_client_wins_over_stub_mode(corpus, fake_embed, db_path,
                                             fake_claude, monkeypatch):
    """Tests inject their own client; stub mode must not override it."""
    monkeypatch.setattr(config, "STUB_MODE", True)
    app = create_app(corpus=corpus, claude_client=fake_claude,
                     embed_fn=fake_embed, db_path=db_path)
    answer = app.test_client().post("/api/ask", json={
        "device_id": "d", "hexagram_id": 1, "changing_lines": [2],
        "question": "问", "lang": "zh",
    }).get_json()["answer"]
    assert answer == fake_claude.reply
