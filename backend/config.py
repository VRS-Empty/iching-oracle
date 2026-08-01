"""
config.py
─────────────────────────────────────────────────────────────────────────────
Centralised configuration. Every secret is read from the environment — nothing
sensitive is ever hard-coded, and nothing here is shipped to the client.

Local development reads backend/.env; on Render the same names are supplied as
dashboard environment variables and no .env file exists.
─────────────────────────────────────────────────────────────────────────────
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"
QUOTA_DB_PATH = Path(os.environ.get("QUOTA_DB_PATH", BASE_DIR / "quota.db"))

# The corpus is gitignored — its text fields carry the full hexagram content,
# which this repository deliberately does not publish. It is therefore supplied
# out of band at deploy time, and its location has to be configurable:
# a Render Secret File lands under /etc/secrets/, a build-time download lands
# wherever the build script put it. Defaults to the local development path.
EMBEDDINGS_PATH = Path(
    os.environ.get("EMBEDDINGS_PATH", BASE_DIR / "data" / "embeddings.json")
)


def load_env_file(path=ENV_PATH):
    """Minimal KEY=VALUE reader. Real environment variables always win."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_env_file()

# ─── Secrets ──────────────────────────────────────────────────────────────────

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
VOYAGE_API_KEY = os.environ.get("VOYAGE_API_KEY", "")

# ─── Model / generation ───────────────────────────────────────────────────────

# Haiku keeps per-question cost low, which is what makes a free tier viable.
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-haiku-4-5")
MAX_TOKENS = int(os.environ.get("MAX_TOKENS", "500"))

# Development escape hatch: answer with locally generated text instead of
# calling Claude, so the client UI can be built without an API key. Off unless
# explicitly enabled, reported by /health, and every answer is prefixed
# [STUB MODE]. Never set this on a deployed service.
STUB_MODE = os.environ.get("ORACLE_STUB_MODE", "").strip().lower() in {"1", "true", "yes"}

# ─── Retrieval ────────────────────────────────────────────────────────────────

TOP_K = int(os.environ.get("TOP_K", "3"))

# ─── Limits ───────────────────────────────────────────────────────────────────

MAX_QUESTION_CHARS = 200
FREE_DAILY_LIMIT = int(os.environ.get("FREE_DAILY_LIMIT", "3"))
PREMIUM_DAILY_LIMIT = int(os.environ.get("PREMIUM_DAILY_LIMIT", "20"))

# Coarse abuse brake, independent of the per-device daily quota.
RATE_LIMIT_REQUESTS = int(os.environ.get("RATE_LIMIT_REQUESTS", "10"))
RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get("RATE_LIMIT_WINDOW_SECONDS", "60"))
