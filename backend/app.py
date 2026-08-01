"""
app.py
─────────────────────────────────────────────────────────────────────────────
Flask backend for the 易鉴 "Ask the Oracle" feature.

POST /api/ask
  request : { device_id, hexagram_id, changing_lines[], transformed_hexagram_id,
              question, lang, is_premium }
  response: { answer, sources[], remaining_quota, daily_limit }

Every error carries a machine-readable `error` code plus bilingual `message_zh`
and `message_en`, so the client renders the right text without parsing prose.

API keys live only in this process's environment. The client holds nothing but
the base URL.
─────────────────────────────────────────────────────────────────────────────
"""

from flask import Flask, jsonify, request

import config
import embedding
import oracle
import quota
import retrieval

VALID_LANGS = {"zh", "en"}
MAX_DEVICE_ID_LEN = 128


class ApiError(Exception):
    """A client-visible failure with a stable code and bilingual messages."""

    def __init__(self, status, code, message_zh, message_en, **extra):
        super().__init__(message_en)
        self.status = status
        self.code = code
        self.message_zh = message_zh
        self.message_en = message_en
        self.extra = extra

    def to_response(self):
        payload = {
            "error": self.code,
            "message_zh": self.message_zh,
            "message_en": self.message_en,
        }
        payload.update(self.extra)
        return jsonify(payload), self.status


# ─── Validation ───────────────────────────────────────────────────────────────

def _validate(payload):
    if not isinstance(payload, dict):
        raise ApiError(400, "invalid_request", "请求格式无效。", "Malformed request body.")

    device_id = payload.get("device_id")
    if not isinstance(device_id, str) or not device_id.strip():
        raise ApiError(400, "invalid_request", "缺少设备标识。", "Missing device_id.")
    device_id = device_id.strip()[:MAX_DEVICE_ID_LEN]

    question = payload.get("question")
    if not isinstance(question, str) or not question.strip():
        raise ApiError(400, "invalid_request", "请输入你的问题。", "Question is required.")
    question = question.strip()
    if len(question) > config.MAX_QUESTION_CHARS:
        raise ApiError(
            400, "question_too_long",
            f"问题请控制在 {config.MAX_QUESTION_CHARS} 字以内。",
            f"Please keep your question under {config.MAX_QUESTION_CHARS} characters.",
            max_chars=config.MAX_QUESTION_CHARS,
        )

    hexagram_id = payload.get("hexagram_id")
    if not isinstance(hexagram_id, int) or isinstance(hexagram_id, bool) \
            or not 1 <= hexagram_id <= 64:
        raise ApiError(400, "invalid_request", "卦象编号无效。",
                       "hexagram_id must be an integer between 1 and 64.")

    transformed_id = payload.get("transformed_hexagram_id")
    if transformed_id is not None:
        if not isinstance(transformed_id, int) or isinstance(transformed_id, bool) \
                or not 1 <= transformed_id <= 64:
            raise ApiError(400, "invalid_request", "变卦编号无效。",
                           "transformed_hexagram_id must be between 1 and 64.")

    raw_lines = payload.get("changing_lines") or []
    if not isinstance(raw_lines, list):
        raise ApiError(400, "invalid_request", "变爻格式无效。",
                       "changing_lines must be a list.")
    changing_lines = []
    for value in raw_lines:
        if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 6:
            raise ApiError(400, "invalid_request", "变爻位置无效。",
                           "Each changing line must be an integer between 1 and 6.")
        changing_lines.append(value)

    lang = payload.get("lang", "zh")
    if lang not in VALID_LANGS:
        lang = "zh"

    return {
        "device_id": device_id,
        "question": question,
        "hexagram_id": hexagram_id,
        "transformed_id": transformed_id,
        "changing_lines": changing_lines,
        "lang": lang,
        "is_premium": bool(payload.get("is_premium", False)),
    }


# ─── App factory ──────────────────────────────────────────────────────────────

def create_app(corpus=None, claude_client=None, embed_fn=None, db_path=None):
    """
    Builds the app. The injectable arguments exist so tests can run the real
    request path without network access or a shared database.
    """
    app = Flask(__name__)

    app.config["CORPUS"] = corpus or retrieval.Corpus(config.EMBEDDINGS_PATH)
    app.config["EMBED_FN"] = embed_fn or embedding.embed_query
    app.config["DB_PATH"] = db_path

    # Stub mode reuses the test injection point rather than branching inside
    # oracle.py, so the production path is identical whether it is on or off.
    if claude_client is None and config.STUB_MODE:
        from stub_client import StubClaudeClient

        claude_client = StubClaudeClient()
        app.logger.warning(
            "ORACLE_STUB_MODE is on — answers are generated locally, not by "
            "Claude. Never enable this on a deployed service."
        )
    app.config["CLAUDE_CLIENT"] = claude_client

    quota.init_db(db_path)

    @app.errorhandler(ApiError)
    def _handle_api_error(error):
        return error.to_response()

    @app.after_request
    def _cors(response):
        # Native React Native ignores CORS; Expo web does not.
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
        return response

    @app.get("/health")
    def health():
        corpus_obj = app.config["CORPUS"]
        return jsonify({
            "status": "ok",
            "chunks": len(corpus_obj.chunks),
            "provider": corpus_obj.provider,
            "model": corpus_obj.model,
            "claude_model": config.CLAUDE_MODEL,
            # Surfaced so a service accidentally left in stub mode is visible
            # from the outside rather than silently returning canned text.
            "stub_mode": config.STUB_MODE,
        })

    @app.post("/api/ask")
    def ask():
        client_ip = request.headers.get("X-Forwarded-For", request.remote_addr or "?")
        client_ip = client_ip.split(",")[0].strip()
        if not quota.limiter.allow(client_ip):
            raise ApiError(429, "rate_limited", "请求过于频繁，请稍候再试。",
                           "Too many requests. Please wait a moment.")

        data = _validate(request.get_json(silent=True))
        db_path = app.config["DB_PATH"]

        allowed, remaining_quota, limit = quota.consume(
            data["device_id"], data["is_premium"], db_path
        )
        if not allowed:
            raise ApiError(
                429, "quota_exceeded",
                f"今日提问次数已用完（{limit} 次／天）。明日 UTC 零点重置。",
                f"You have used all {limit} questions for today. "
                f"Your allowance resets at 00:00 UTC.",
                remaining_quota=0, daily_limit=limit,
            )

        try:
            corpus_obj = app.config["CORPUS"]
            query_vector = app.config["EMBED_FN"](
                data["question"], corpus_obj.provider,
                corpus_obj.model, corpus_obj.dimensions,
            )
            mandatory, supplementary = retrieval.build_context(
                corpus_obj,
                hexagram_id=data["hexagram_id"],
                changing_lines=data["changing_lines"],
                transformed_hexagram_id=data["transformed_id"],
                query_vector=query_vector,
                top_k=config.TOP_K,
            )
            prompt = oracle.build_prompt(
                mandatory, supplementary, data["question"],
                hexagram_id=data["hexagram_id"],
                transformed_id=data["transformed_id"],
                lang=data["lang"],
            )
            answer, _ = oracle.ask_claude(prompt, client=app.config["CLAUDE_CLIENT"])
        except (embedding.EmbeddingError, oracle.OracleError) as exc:
            # The question was never answered — return the credit.
            quota.refund(data["device_id"], db_path)
            app.logger.warning("ask failed: %s", exc)
            raise ApiError(502, "upstream_error", "神谕暂时无法回应，请稍后再试。",
                           "The oracle is unavailable right now. Please try again.") from exc
        except Exception as exc:
            quota.refund(data["device_id"], db_path)
            app.logger.exception("unexpected failure in /api/ask")
            raise ApiError(500, "server_error", "服务出现异常，请稍后再试。",
                           "Something went wrong. Please try again.") from exc

        sources = [
            {
                "hexagram": chunk["hexagram_number"],
                "name": chunk["hexagram_name"]["chinese"],
                "chunk_type": chunk["chunk_type"],
                "line": chunk["line_position"],
                "mandatory": score is None,
            }
            for score, chunk in list(mandatory) + list(supplementary)
        ]

        return jsonify({
            "answer": answer,
            "sources": sources,
            "remaining_quota": remaining_quota,
            "daily_limit": limit,
        })

    return app


if __name__ == "__main__":
    # Local development only. Production is served by gunicorn via wsgi.py,
    # which is where the single module-level app instance lives.
    import os

    create_app().run(
        host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=True
    )
