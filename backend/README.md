# Ask the Oracle — Backend

RAG service behind the 易鉴 app's follow-up questions. A user who has cast a
hexagram can ask about it in natural language ("what does this say about
changing jobs?"), and this service answers from that hexagram's own passages
plus the most relevant passages retrieved from the rest of the corpus.

**API keys live only here.** The mobile client holds a base URL and nothing else.

---

## How it works

```
client ──POST /api/ask──▶  validate  ──▶  daily quota (SQLite, per device)
                                            │
                          embed question (Voyage)
                                            │
                          retrieve ──▶ mandatory: this cast's judgment, image,
                                            │      changing lines, transformed
                                            │      hexagram
                                            └──▶ supplementary: top-3 by cosine
                                            │
                          assemble prompt ──▶ Claude Haiku (max 500 tokens)
                                            │
                          ◀── answer + sources + remaining quota
```

512 chunks × 512 dimensions is small enough that one numpy matrix multiply
beats a vector database on both latency and operational cost. That is a
deliberate choice, not a placeholder.

| Module | Responsibility |
| --- | --- |
| `app.py` | Flask factory, `POST /api/ask`, `GET /health`, validation, bilingual errors |
| `retrieval.py` | Corpus loading, cosine search, context assembly, **content guardrails** |
| `oracle.py` | System prompt, passage rendering, Claude call |
| `embedding.py` | Question embedding at request time |
| `quota.py` | Per-device daily allowance, refunds, rate limiting |
| `wsgi.py` | Production entry point (`gunicorn wsgi:app`) |

---

## Local development

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate      # Windows
pip install -r requirements-dev.txt
cp .env.example .env                                 # then paste real keys
python app.py                                        # http://localhost:5000
```

Run the tests — they stub both paid APIs, so they cost nothing and need no keys:

```bash
python -m pytest
```

Point the app at your machine by editing `DEV_HOST` in `../constants/api.js`;
`localhost` on a phone means the phone, not your computer.

---

## Environment variables

Set the two secrets in Render's dashboard (never in `render.yaml`, never in git).
Everything else has a working default in `config.py`.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | **yes** | — | Answer generation |
| `VOYAGE_API_KEY` | **yes** | — | Embedding the user's question |
| `CLAUDE_MODEL` | no | `claude-haiku-4-5` | Haiku keeps a free tier viable |
| `MAX_TOKENS` | no | `500` | Hard ceiling per answer |
| `TOP_K` | no | `3` | Supplementary passages retrieved |
| `FREE_DAILY_LIMIT` | no | `3` | Questions per device per day, free |
| `PREMIUM_DAILY_LIMIT` | no | `20` | Questions per device per day, premium |
| `RATE_LIMIT_REQUESTS` | no | `10` | Requests per IP per window |
| `RATE_LIMIT_WINDOW_SECONDS` | no | `60` | Window length |
| `QUOTA_DB_PATH` | no | `./quota.db` | Set to `/tmp/quota.db` on Render |
| `EMBEDDINGS_PATH` | no | `./data/embeddings.json` | Where the corpus lives; see below |
| `CORPUS_URL` | deploy | — | Private URL the build downloads the corpus from |
| `CORPUS_AUTH_HEADER` | no | — | `Authorization` header for that URL, if needed |
| `ORACLE_STUB_MODE` | no | off | **Development only** — answer without calling Claude |
| `OPENAI_API_KEY` | no | — | Only if the corpus is rebuilt with `--provider openai` |

The embedding provider is **not** configured here. It is read from
`data/embeddings.json`'s metadata, because a query vector must come from the
same model as the corpus — configuring them separately invites a silent
mismatch that degrades retrieval without erroring.

---

## Deploying to Render

1. **Put the corpus somewhere the build can reach** — it is gitignored and must
   not be committed. See *Supplying the corpus without committing it* below.
2. Push this directory to the repository.
3. Render Dashboard → **New** → **Blueprint** → select the repo. It reads
   `render.yaml` and provisions the service.
4. Render prompts for the `sync: false` variables — `ANTHROPIC_API_KEY`,
   `VOYAGE_API_KEY`, `CORPUS_URL`, and `CORPUS_AUTH_HEADER` (blank unless your
   URL needs a header).
5. Wait for the first build, then check `https://<service>.onrender.com/health`.
   A healthy response confirms the corpus downloaded and loaded:

   ```json
   {"status":"ok","chunks":512,"provider":"voyage","model":"voyage-3.5-lite",
    "claude_model":"claude-haiku-4-5","stub_mode":false}
   ```

   `chunks: 512` is the signal to look for. `stub_mode` must be `false`.

6. Copy the service URL into `PRODUCTION_URL` in `../constants/api.js` and
   rebuild the app. Until you do, release builds point at a placeholder domain.

Prefer configuring by hand? The equivalent settings are: runtime Python, root
directory `backend`, build `pip install -r requirements.txt`, start
`gunicorn wsgi:app --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 120`,
health check path `/health`.

### Why one worker

The rate limiter holds its sliding window in memory. With several workers each
would keep its own, multiplying the effective limit. Threads supply concurrency
instead, which suits this workload — requests spend nearly all their time
waiting on Claude and Voyage, not on CPU. The daily quota is unaffected either
way; it lives in SQLite, shared through the filesystem.

---

## Known limitations

These are accepted trade-offs, not oversights.

**Cold starts.** Render's free tier suspends idle instances; the first request
after a lull takes roughly a minute. The client's timeout is set to 60s to
clear this. Upgrading to a paid instance removes it.

**Quota storage is ephemeral.** The free tier has no persistent disk, so
`quota.db` resets on every deploy and a few users may get extra questions that
day. The client keeps its own mirror, so the ceiling still holds within a
session. Moving to Render Postgres would close the gap.

**Premium is capped, not verified.** `is_premium` is asserted by the client.
The app's IAP layer is still a mock — `usePremium` writes a flag to
AsyncStorage — so there is no receipt to check. A forged flag raises the
ceiling from 3 to 20 questions a day, not to unlimited. Real verification needs
App Store receipt validation.

**Content guardrails are doing real work.** `hexagrams.json` is only partly
authored, and `retrieval.py` withholds what is unusable rather than passing it
through:

| Layer | Authentic source text | Withheld |
| --- | --- | --- |
| Judgment 卦辞 | hexagrams 1–15 | 49 of 64 are placeholders (`第16卦`) |
| Image 象辞 | hexagrams 1–15 | 49 of 64 are placeholders (`雷地象`) |
| Lines 爻辞 | hexagrams 1–14 | 300 of 384 are placeholders |
| Chinese interpretation | **all 64** | none — this is what grounds answers |
| English prose | hexagrams 1–15 | templated beyond that, withheld entirely |

Every passage reaches the model tagged `quotable="yes"` or `"no"`, and the
system prompt forbids reconstructing source text that was not supplied. Claude
reads the Chinese interpretation regardless of the language it answers in, so
English answers stay grounded — they simply cannot quote 原文 for hexagrams past
the cut-off. Repair `hexagrams.json`, rebuild the corpus, and the guardrails
re-enable that content automatically; the detection is data-driven, with tests
asserting exactly that.

---

## Rebuilding the corpus

Needed after editing `hexagrams.json`, or to switch embedding provider.

```bash
python scripts/build_embeddings.py --provider voyage --check-key   # verify first
python scripts/build_embeddings.py --provider voyage --batch-size 25 --pace 30
```

Voyage's free tier without a payment method is limited to 3 requests and 10K
tokens per minute; the corpus is ~94K tokens, so a paced run takes about ten
minutes. Progress is cached after every batch, so an interrupted run resumes
rather than re-spending tokens. Adding a payment method lifts the limits — the
200M free tokens still apply, and the whole corpus costs a fraction of that.

`--provider openai` produces an equivalent corpus with
`text-embedding-3-small`. The provider is recorded in the output metadata and
the backend follows it, so no code changes are needed either way.

---

## Supplying the corpus without committing it

`data/embeddings.json` is **gitignored and must stay that way.** Commit
`886e3be` removed `hexagrams.json` from this public repository to keep the
hexagram content out of it; `embeddings.json` holds the full text of all 512
passages in its `text_zh` / `text_en` fields, so committing it would put
essentially the same content back — and git history would keep it even after a
later deletion.

`EMBEDDINGS_PATH` exists so the corpus can live anywhere. Two routes:

### Build-time download (recommended)

`scripts/fetch_corpus.py` runs in the build command and pulls the file from a
private URL. No size limit, nothing in git.

Host `embeddings.json` wherever you can produce a private link:

| Host | `CORPUS_URL` | `CORPUS_AUTH_HEADER` |
| --- | --- | --- |
| Cloudflare R2 / AWS S3 | presigned URL | — |
| Private GitHub release | `https://api.github.com/repos/<owner>/<repo>/releases/assets/<id>` | `Bearer <token>` |
| Private repo raw file | `https://api.github.com/repos/<owner>/<repo>/contents/embeddings.json?ref=main` | `Bearer <token>` |

Set both as Render environment variables and the default build command handles
the rest. The download is validated before it is accepted — chunk count,
provider metadata, and vector dimensions all have to line up — so an expired
link returning an HTML error page fails the build with a clear message instead
of surfacing as a confusing crash at worker startup. Re-running the build is
free: an already-valid corpus is left alone.

Presigned URLs expire. If a redeploy suddenly fails at the fetch step, that is
the first thing to check.

### Render Secret File

Render Dashboard → the service → **Environment** → **Secret Files**. Add
`embeddings.json`, then set `EMBEDDINGS_PATH=/etc/secrets/embeddings.json` and
remove `python scripts/fetch_corpus.py` from the build command.

Simpler, with one caveat: Render documents Secret Files as intended for small
configuration, and this file is 3 MB. If the upload is rejected or truncated,
use the download route instead.

---

## Running without an Anthropic API key

Answer generation needs a paid key. To build and exercise the client UI before
buying one, set `ORACLE_STUB_MODE=1` locally:

```bash
ORACLE_STUB_MODE=1 python app.py
```

The service then answers with locally generated placeholder text. The rest of
the request path is untouched — validation, quota accounting, retrieval, prompt
assembly, and response shape are the real code, so every state in
`AskOracleSection` can be driven: loading, answer, source pills, quota
exhausted, and the error paths.

It is deliberately impossible to mistake for the real thing. Every answer opens
with `[STUB MODE — no Claude API key configured...]`, `GET /health` reports
`stub_mode: true`, and the worker logs a warning at startup. `render.yaml` pins
it to `"0"` so an accidental dashboard override shows up as a diff.

What it cannot tell you: how Claude actually writes, or whether the content
guardrails hold against a real model. Both need a key. Embedding still uses the
real Voyage API, which has a free tier.

---

## Verifying a dependency bump

Versions in `requirements.txt` are pinned to what the suite was actually run
against. After changing one, confirm the deployed environment still builds and
boots with production dependencies alone:

```bash
python -m venv /tmp/check && /tmp/check/bin/pip install -r requirements.txt
cd backend && /tmp/check/bin/python -c "from wsgi import app; \
    print(app.test_client().get('/health').get_json())"
python -m pytest
```

The middle step matters: it catches a package that only works locally because
it is installed globally.
