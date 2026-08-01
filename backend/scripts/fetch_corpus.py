"""
fetch_corpus.py
─────────────────────────────────────────────────────────────────────────────
Downloads the embedded corpus during deploy, for hosts where it cannot be
committed.

data/embeddings.json is gitignored: its text_zh / text_en fields hold the full
text of all 512 hexagram passages, and this repository is public with that
content deliberately removed. So the corpus has to arrive some other way, and
a build-time download from a private URL is the option that has no size limit
and leaves no copy in git history.

Usage — in Render's build command, before pip install or after, either works:

    python scripts/fetch_corpus.py && pip install -r requirements.txt

Environment:
    CORPUS_URL          required. A signed / private URL serving embeddings.json
                        (S3 or R2 presigned link, private GitHub release asset,
                        anything that returns the raw JSON).
    CORPUS_AUTH_HEADER  optional. Sent verbatim as the Authorization header,
                        e.g. "Bearer ghp_..." for a private release asset.
    EMBEDDINGS_PATH     optional. Where to write it. Defaults to the path the
                        backend reads, so no further configuration is needed.

The download is validated before it is accepted — a 404 HTML page saved as
embeddings.json would otherwise fail much later, during worker startup, with a
far less obvious error.
─────────────────────────────────────────────────────────────────────────────
"""

import json
import os
import sys
from pathlib import Path

import httpx

EXPECTED_CHUNKS = 512
DOWNLOAD_TIMEOUT = 120.0

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_PATH = SCRIPT_DIR.parent / "data" / "embeddings.json"


def validate(path):
    """Returns (ok, message). Confirms the file is a usable corpus."""
    try:
        with open(path, encoding="utf-8") as f:
            payload = json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        return False, f"not valid JSON ({exc.__class__.__name__}) — is the URL "\
                      f"serving the raw file, or an HTML error page?"
    except OSError as exc:
        return False, f"unreadable: {exc}"

    chunks = payload.get("chunks")
    meta = payload.get("_meta") or {}
    if not isinstance(chunks, list) or not chunks:
        return False, "no 'chunks' array"
    if len(chunks) != EXPECTED_CHUNKS:
        return False, f"expected {EXPECTED_CHUNKS} chunks, found {len(chunks)}"
    if not meta.get("provider") or not meta.get("model"):
        return False, "'_meta' is missing provider/model — the backend needs " \
                      "these to embed queries with the same model"
    dimensions = meta.get("dimensions")
    first = chunks[0].get("embedding")
    if not isinstance(first, list) or len(first) != dimensions:
        return False, f"chunk vectors do not match _meta.dimensions ({dimensions})"

    return True, (f"{len(chunks)} chunks, {meta['provider']}/{meta['model']}, "
                  f"{dimensions} dims")


def main():
    target = Path(os.environ.get("EMBEDDINGS_PATH", DEFAULT_PATH))

    # Idempotent: a corpus that is already present and valid is left alone, so
    # re-running the build step costs nothing.
    if target.exists():
        ok, message = validate(target)
        if ok:
            print(f"corpus already present at {target} ({message}) — skipping download")
            return 0
        print(f"existing file at {target} is unusable ({message}); re-downloading",
              file=sys.stderr)

    url = os.environ.get("CORPUS_URL", "").strip()
    if not url:
        print(
            "CORPUS_URL is not set — cannot fetch the embedded corpus.\n"
            "Set it to a private URL serving embeddings.json, or supply the "
            "file another way and point EMBEDDINGS_PATH at it.\n"
            "See README.md → 'Supplying the corpus without committing it'.",
            file=sys.stderr,
        )
        return 1

    headers = {}
    auth = os.environ.get("CORPUS_AUTH_HEADER", "").strip()
    if auth:
        headers["Authorization"] = auth
    # A private GitHub release asset needs this to return bytes, not JSON metadata.
    if "api.github.com" in url:
        headers.setdefault("Accept", "application/octet-stream")

    target.parent.mkdir(parents=True, exist_ok=True)
    # Write to a sibling temp file first, so an interrupted download cannot
    # leave a truncated corpus in place of a good one.
    staging = target.with_suffix(".partial")

    print(f"downloading corpus to {target} ...")
    try:
        with httpx.stream("GET", url, headers=headers, follow_redirects=True,
                          timeout=DOWNLOAD_TIMEOUT) as response:
            if response.status_code != 200:
                response.read()
                print(f"download failed: HTTP {response.status_code} "
                      f"{response.text[:200]}", file=sys.stderr)
                return 1
            written = 0
            with open(staging, "wb") as f:
                for block in response.iter_bytes():
                    f.write(block)
                    written += len(block)
    except httpx.HTTPError as exc:
        print(f"download failed: {exc}", file=sys.stderr)
        staging.unlink(missing_ok=True)
        return 1

    ok, message = validate(staging)
    if not ok:
        print(f"downloaded file is not a usable corpus: {message}", file=sys.stderr)
        staging.unlink(missing_ok=True)
        return 1

    staging.replace(target)
    print(f"corpus ready: {target} ({written / 1e6:.1f} MB, {message})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
