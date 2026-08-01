"""
build_embeddings.py
─────────────────────────────────────────────────────────────────────────────
Offline embedding pre-computation for the 易鉴 "Ask the Oracle" RAG feature.

Reads  : files/data/hexagrams.json   (64 hexagrams, bilingual)
Writes : files/backend/data/embeddings.json

Chunking (8 chunks per hexagram, 512 total):
  - 1 × judgment  (卦辞: classical text + EN translation + modern summaries)
  - 1 × image     (象辞: classical text + EN translation + interpretations)
  - 6 × line      (爻辞: one per line, classical + EN + interpretations)

Each chunk stores BOTH zh and en text in metadata (the backend uses the
embeddings file as its content store too), and is embedded ONCE on the
combined bilingual text — text-embedding-3-small is multilingual, so a
single vector serves queries in either language.

Model : OpenAI text-embedding-3-small, dimensions=512
        (~512 chunks × ~1K tokens ≈ $0.01 one-time cost)

Usage:
  pip install openai
  # Put the key in backend/.env (gitignored):  OPENAI_API_KEY=sk-...
  # An already-exported OPENAI_API_KEY env var takes precedence over .env.
  python build_embeddings.py         # full run, writes embeddings.json
  python build_embeddings.py --dry-run   # build & validate chunks, no API calls
─────────────────────────────────────────────────────────────────────────────
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

EMBEDDING_DIMENSIONS = 512
ROUND_DECIMALS = 6  # float precision in output file (keeps file ~3 MB)

# Two interchangeable providers. Both are multilingual, so one vector per chunk
# serves zh and en queries alike. The backend must use the SAME provider at
# query time — whichever is recorded in the output file's _meta.provider.
PROVIDERS = {
    "openai": {
        "model": "text-embedding-3-small",
        "env_var": "OPENAI_API_KEY",
        "key_prefix": "sk-",
        "batch_size": 128,
    },
    "voyage": {
        "model": "voyage-3.5-lite",
        "env_var": "VOYAGE_API_KEY",
        "key_prefix": "pa-",
        "batch_size": 64,  # Voyage caps tokens per request lower than OpenAI
    },
}
DEFAULT_PROVIDER = "openai"

SCRIPT_DIR = Path(__file__).resolve().parent
SOURCE_PATH = SCRIPT_DIR.parents[1] / "data" / "hexagrams.json"
OUTPUT_PATH = SCRIPT_DIR.parent / "data" / "embeddings.json"
ENV_PATH = SCRIPT_DIR.parent / ".env"


# ─── Credentials ──────────────────────────────────────────────────────────────

def load_env_file(path=ENV_PATH):
    """Minimal KEY=VALUE .env reader. Real env vars win; no dependency needed."""
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


def require_api_key(provider=DEFAULT_PROVIDER):
    """Returns the provider's key, exiting with guidance if it is unusable."""
    spec = PROVIDERS[provider]
    var, prefix = spec["env_var"], spec["key_prefix"]
    key = (os.environ.get(var) or "").strip()
    if not key:
        sys.exit(
            f"{var} is not set.\n"
            f"Add this line to {ENV_PATH}:\n"
            f"  {var}={prefix}...\n"
            f"(or use --dry-run to validate chunks without calling the API)"
        )
    # A key with non-ASCII bytes cannot be encoded into an HTTP header; the
    # failure would otherwise surface deep inside the SDK's request builder.
    if not key.isascii():
        sys.exit(
            f"{var} contains non-ASCII characters — it looks like a "
            "placeholder rather than a real key. Replace it with the actual "
            f"secret in {ENV_PATH}."
        )
    if not key.startswith(prefix):
        sys.exit(f"{var} does not look like a {provider} key (expected it to "
                 f"start with {prefix!r}). Check {ENV_PATH}.")
    if len(key) < 20 or key.endswith("..."):
        sys.exit(f"{var} is still the placeholder from .env.example. "
                 f"Paste your real key into {ENV_PATH}.")
    return key


# ─── Chunk construction ───────────────────────────────────────────────────────

def _hexagram_title(hexagram):
    """Bilingual header prepended to every chunk's embedding text."""
    name = hexagram["name"]
    return (
        f"第{hexagram['number']}卦 {name['chinese']}（{name['pinyin']}）"
        f" {name['english']}"
    )


def _joined(*parts):
    return "\n".join(p.strip() for p in parts if p and p.strip())


def build_chunks(hexagrams):
    """Returns the flat list of 512 chunk dicts (without vectors)."""
    chunks = []
    for hexagram in hexagrams:
        num = hexagram["number"]
        name = hexagram["name"]
        title = _hexagram_title(hexagram)
        base_meta = {
            "hexagram_number": num,
            "hexagram_name": {
                "chinese": name["chinese"],
                "pinyin": name["pinyin"],
                "english": name["english"],
            },
        }

        # ── judgment 卦辞 ──
        j = hexagram["judgment"]
        chunks.append({
            **base_meta,
            "id": f"hex{num:02d}-judgment",
            "chunk_type": "judgment",
            "line_position": None,
            "text_zh": _joined(j.get("chinese"), j.get("summary_zh") or j.get("summary")),
            "text_en": _joined(j.get("translation"), j.get("summary")),
            "embed_text": _joined(
                f"{title} · 卦辞 Judgment",
                j.get("chinese"), j.get("translation"),
                j.get("summary_zh"), j.get("summary"),
            ),
        })

        # ── image 象辞 ──
        im = hexagram["image"]
        chunks.append({
            **base_meta,
            "id": f"hex{num:02d}-image",
            "chunk_type": "image",
            "line_position": None,
            "text_zh": _joined(im.get("chinese"), im.get("interpretation_zh") or im.get("interpretation")),
            "text_en": _joined(im.get("translation"), im.get("interpretation")),
            "embed_text": _joined(
                f"{title} · 象辞 Image",
                im.get("chinese"), im.get("translation"),
                im.get("interpretation_zh"), im.get("interpretation"),
            ),
        })

        # ── lines 爻辞 (6 per hexagram → 384 total) ──
        for line in hexagram["lines"]:
            pos = line["position"]
            chunks.append({
                **base_meta,
                "id": f"hex{num:02d}-line{pos}",
                "chunk_type": "line",
                "line_position": pos,
                "text_zh": _joined(line.get("chinese"), line.get("interpretation_zh") or line.get("interpretation")),
                "text_en": _joined(line.get("translation"), line.get("interpretation")),
                "embed_text": _joined(
                    f"{title} · 第{pos}爻 Line {pos}",
                    line.get("chinese"), line.get("translation"),
                    line.get("interpretation_zh"), line.get("interpretation"),
                ),
            })
    return chunks


def validate_chunks(chunks):
    assert len(chunks) == 512, f"expected 512 chunks, got {len(chunks)}"
    by_type = {}
    for c in chunks:
        by_type[c["chunk_type"]] = by_type.get(c["chunk_type"], 0) + 1
        assert c["text_zh"], f"empty text_zh in {c['id']}"
        assert c["text_en"], f"empty text_en in {c['id']}"
        assert c["embed_text"], f"empty embed_text in {c['id']}"
    assert by_type == {"judgment": 64, "image": 64, "line": 384}, by_type
    ids = [c["id"] for c in chunks]
    assert len(set(ids)) == len(ids), "duplicate chunk ids"
    return by_type


# ─── Embedding ────────────────────────────────────────────────────────────────

class PermanentAPIError(RuntimeError):
    """A failure that retrying cannot fix (bad key, no credit, bad request)."""


class RetryableAPIError(RuntimeError):
    """A transient failure — rate limit or server error. Carries Retry-After."""

    def __init__(self, message, retry_after=None):
        super().__init__(message)
        self.retry_after = retry_after


def _parse_retry_after(headers):
    """Returns the Retry-After value in seconds, or None if absent/unparsable."""
    raw = headers.get("retry-after") or headers.get("Retry-After")
    if not raw:
        return None
    try:
        return max(1.0, float(raw))
    except (TypeError, ValueError):
        return None  # HTTP-date form — fall back to exponential backoff


def _embed_batch_openai(texts, key, model):
    from openai import OpenAI  # imported lazily so --dry-run needs no package
    import openai as openai_mod

    client = OpenAI(api_key=key)
    try:
        resp = client.embeddings.create(
            model=model, input=texts, dimensions=EMBEDDING_DIMENSIONS,
        )
    except openai_mod.AuthenticationError as e:
        raise PermanentAPIError(f"OpenAI rejected the API key: {e}") from None
    except openai_mod.PermissionDeniedError as e:
        raise PermanentAPIError(f"OpenAI denied access: {e}") from None
    except openai_mod.BadRequestError as e:
        raise PermanentAPIError(f"OpenAI rejected the request: {e}") from None
    except openai_mod.RateLimitError as e:
        # 429 covers both "slow down" (retryable) and "out of credit" (not).
        if getattr(getattr(e, "body", None), "get", lambda _k: None)("code") \
                == "insufficient_quota" or "insufficient_quota" in str(e):
            raise PermanentAPIError(
                "OpenAI account has no remaining quota. Add credit at "
                "https://platform.openai.com/settings/organization/billing "
                "(this build needs about $0.01), or re-run with "
                "--provider voyage."
            ) from None
        headers = getattr(getattr(e, "response", None), "headers", {}) or {}
        raise RetryableAPIError(f"OpenAI rate limit: {e}",
                                _parse_retry_after(headers)) from None
    # The API preserves input order, but sort by index to be certain.
    return [d.embedding for d in sorted(resp.data, key=lambda d: d.index)]


def _embed_batch_voyage(texts, key, model):
    import httpx  # installed as an openai dependency; no extra package needed

    resp = httpx.post(
        "https://api.voyageai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {key}"},
        json={
            "input": texts,
            "model": model,
            "input_type": "document",
            "output_dimension": EMBEDDING_DIMENSIONS,
        },
        timeout=120.0,
    )
    if resp.status_code in (401, 403):
        raise PermanentAPIError(f"Voyage rejected the API key: {resp.text}")
    if resp.status_code == 400:
        raise PermanentAPIError(f"Voyage rejected the request: {resp.text}")
    if resp.status_code == 429:
        body = resp.text.lower()
        # Order matters: Voyage's throttling message also mentions "billing"
        # and "payment" (it nudges you to add a card to lift the free-tier
        # 3 RPM / 10K TPM cap), so throttling must be matched FIRST or a
        # slow-down gets misread as a dead account.
        throttled = any(s in body for s in
                        ("rate limit", "rpm", "tpm", "too many requests"))
        exhausted = any(s in body for s in
                        ("exceeded your quota", "insufficient", "exhausted",
                         "run out", "no remaining"))
        if throttled and not exhausted:
            raise RetryableAPIError(f"Voyage rate limit: {resp.text[:160]}",
                                    _parse_retry_after(resp.headers))
        if exhausted:
            raise PermanentAPIError(f"Voyage quota exhausted: {resp.text}")
        raise RetryableAPIError(f"Voyage 429: {resp.text[:160]}",
                                _parse_retry_after(resp.headers))
    if resp.status_code >= 500:
        raise RetryableAPIError(f"Voyage server error {resp.status_code}",
                                _parse_retry_after(resp.headers))
    resp.raise_for_status()
    data = sorted(resp.json()["data"], key=lambda d: d["index"])
    return [d["embedding"] for d in data]


_BATCH_FN = {"openai": _embed_batch_openai, "voyage": _embed_batch_voyage}


MAX_ATTEMPTS = 6
MAX_BACKOFF = 120.0


def load_cache(path):
    """Reads the resume cache: {chunk_id: vector}. Tolerates a truncated tail."""
    if not path.exists():
        return {}
    cache = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                cache[rec["id"]] = rec["embedding"]
            except (json.JSONDecodeError, KeyError):
                continue  # partial final line from an interrupted run
    return cache


def embed_all(chunks, provider, key, spec=None, cache_path=None, pace=0.0):
    """Embeds every chunk, resuming from cache_path and appending as it goes."""
    spec = spec or PROVIDERS[provider]
    model, batch_size = spec["model"], spec["batch_size"]
    embed_batch = _BATCH_FN[provider]

    cache = load_cache(cache_path) if cache_path else {}
    if cache:
        print(f"  resuming: {len(cache)}/{len(chunks)} chunks already embedded")

    todo = [c for c in chunks if c["id"] not in cache]
    if not todo:
        print("  all chunks already cached — nothing to embed")

    cache_file = None
    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_file = open(cache_path, "a", encoding="utf-8")

    try:
        done = len(cache)
        for start in range(0, len(todo), batch_size):
            batch = todo[start:start + batch_size]
            texts = [c["embed_text"] for c in batch]

            raw = None
            for attempt in range(MAX_ATTEMPTS):
                try:
                    raw = embed_batch(texts, key, model)
                    break
                except PermanentAPIError as e:
                    # Retrying cannot help — fail with the real cause. Work
                    # already cached is preserved for the next run.
                    if cache_file:
                        cache_file.flush()
                    sys.exit(f"\n{e}")
                except RetryableAPIError as e:
                    if attempt == MAX_ATTEMPTS - 1:
                        if cache_file:
                            cache_file.flush()
                        sys.exit(
                            f"\n{e}\n\nGave up after {MAX_ATTEMPTS} attempts. "
                            f"{done}/{len(chunks)} chunks are cached — re-run "
                            f"the same command to resume, optionally with "
                            f"--batch-size 32 --pace 20 to go gentler on the "
                            f"rate limit."
                        )
                    wait = e.retry_after or min(2 ** (attempt + 1), MAX_BACKOFF)
                    print(f"  rate limited — waiting {wait:.0f}s "
                          f"(attempt {attempt + 1}/{MAX_ATTEMPTS})",
                          file=sys.stderr)
                    time.sleep(wait)
                except Exception as e:
                    if attempt == MAX_ATTEMPTS - 1:
                        if cache_file:
                            cache_file.flush()
                        raise
                    wait = min(2 ** (attempt + 1), MAX_BACKOFF)
                    print(f"  {type(e).__name__}: {e} — retrying in {wait:.0f}s",
                          file=sys.stderr)
                    time.sleep(wait)

            for chunk, vec in zip(batch, raw):
                rounded = [round(v, ROUND_DECIMALS) for v in vec]
                cache[chunk["id"]] = rounded
                if cache_file:
                    cache_file.write(json.dumps(
                        {"id": chunk["id"], "embedding": rounded}) + "\n")
            if cache_file:
                cache_file.flush()  # survive a Ctrl-C or crash

            done += len(batch)
            print(f"  embedded {done}/{len(chunks)}")

            if pace and start + batch_size < len(todo):
                time.sleep(pace)
    finally:
        if cache_file:
            cache_file.close()

    # Return vectors in the original chunk order, not the order embedded.
    return [cache[c["id"]] for c in chunks]


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", choices=sorted(PROVIDERS),
                        default=DEFAULT_PROVIDER,
                        help=f"embedding provider (default: {DEFAULT_PROVIDER})")
    parser.add_argument("--model", default=None,
                        help="override the provider's default model name")
    parser.add_argument("--batch-size", type=int, default=None,
                        help="chunks per API call (lower it if rate limited)")
    parser.add_argument("--pace", type=float, default=0.0,
                        help="seconds to sleep between batches (default: 0)")
    parser.add_argument("--dry-run", action="store_true",
                        help="build and validate chunks without calling the API")
    parser.add_argument("--check-key", action="store_true",
                        help="verify the provider's API key is usable, then "
                             "exit (never prints the secret)")
    args = parser.parse_args()
    spec = dict(PROVIDERS[args.provider])
    if args.model:
        spec["model"] = args.model
    if args.batch_size:
        spec["batch_size"] = args.batch_size

    if args.check_key:
        load_env_file()
        key = require_api_key(args.provider)  # exits with guidance if unusable
        print(f"{spec['env_var']} looks usable: {key[:6]}...{key[-4:]} "
              f"({len(key)} chars). Ready to run the full build "
              f"with --provider {args.provider}.")
        return

    with open(SOURCE_PATH, encoding="utf-8") as f:
        data = json.load(f)
    hexagrams = data["hexagrams"]
    print(f"loaded {len(hexagrams)} hexagrams from {SOURCE_PATH}")

    chunks = build_chunks(hexagrams)
    by_type = validate_chunks(chunks)
    print(f"built {len(chunks)} chunks: {by_type}")

    if args.dry_run:
        sample = chunks[0]
        print("\n--- sample chunk (hex01-judgment) ---")
        print(json.dumps({k: v for k, v in sample.items() if k != "embed_text"},
                         ensure_ascii=False, indent=2)[:800])
        print("\ndry run complete — no API calls made.")
        return

    load_env_file()
    key = require_api_key(args.provider)

    print(f"embedding with {spec['model']} via {args.provider} "
          f"(dim={EMBEDDING_DIMENSIONS})...")
    # Cache is provider+model specific — vectors from different models are not
    # interchangeable, so switching provider must not resume the wrong corpus.
    cache_path = OUTPUT_PATH.parent / f".embed_cache_{args.provider}_{spec['model']}.jsonl"
    vectors = embed_all(chunks, args.provider, key, spec,
                        cache_path=cache_path, pace=args.pace)
    assert len(vectors) == len(chunks)

    # embed_text is only needed at build time — drop it from the output
    out_chunks = []
    for chunk, vec in zip(chunks, vectors):
        c = {k: v for k, v in chunk.items() if k != "embed_text"}
        c["embedding"] = vec
        out_chunks.append(c)

    output = {
        "_meta": {
            # The backend reads provider/model to embed queries the same way —
            # vectors from different providers are not comparable.
            "provider": args.provider,
            "model": spec["model"],
            "dimensions": EMBEDDING_DIMENSIONS,
            "total_chunks": len(out_chunks),
            "source": "hexagrams.json v" + data.get("_meta", {}).get("version", "?"),
        },
        "chunks": out_chunks,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False)
    size_mb = OUTPUT_PATH.stat().st_size / 1e6
    print(f"wrote {OUTPUT_PATH} ({size_mb:.1f} MB)")
    if cache_path.exists():
        cache_path.unlink()  # build succeeded — the resume cache is now dead weight
        print(f"removed resume cache {cache_path.name}")


if __name__ == "__main__":
    main()
