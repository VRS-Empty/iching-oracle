# 易鉴 I-Ching Oracle

> A bilingual divination app for iOS, Android, and the browser — with a
> retrieval-augmented backend that answers questions about the hexagram you cast.

### ▶ [Try it live](https://vrs-empty.github.io/iching-oracle/) · [API health](https://iching-oracle-api.onrender.com/health)

![Platform](https://img.shields.io/badge/Platform-iOS%20%7C%20Android%20%7C%20Web-black?style=flat-square)
![Built With](https://img.shields.io/badge/Built%20With-React%20Native-61DAFB?style=flat-square&logo=react)
![Backend](https://img.shields.io/badge/Backend-Flask%20%2B%20RAG-000000?style=flat-square&logo=flask)
![Language](https://img.shields.io/badge/Language-EN%20%7C%20ZH-D4AF37?style=flat-square)
![Tests](https://img.shields.io/badge/Tests-125%20passing-brightgreen?style=flat-square&logo=pytest)
![Status](https://img.shields.io/badge/Status-Deployed-brightgreen?style=flat-square)

---

## Overview

**易鉴 (I-Ching Oracle)** casts hexagrams by the traditional Three-Coin Method
(三枚铜钱法) and reads them back in English or Chinese across all 64 hexagrams of
the Zhou Yi (周易).

Beyond the stored interpretations, **Ask the Oracle** answers a free-form question
about the specific reading you cast. That path is retrieval-augmented: the question
is embedded, matched against a 512-passage corpus, and the retrieved passages plus
your own hexagram are what the model is allowed to reason from.

The interesting engineering problem here was not the retrieval — it was **being
honest about incomplete data**. The source dataset carries genuine classical text
for only some hexagrams; the rest have interpretation but no original. Rather than
let the model paper over the gap by inventing plausible-sounding classical Chinese,
the corpus is classified at build time and each passage is handed to the model with
an explicit `quotable` flag. See [Grounding guardrail](#grounding-guardrail).

Built independently, with AI-assisted development (Claude).

---

## At a glance

| | |
|---|---|
| **Clients** | iOS, Android, and web from one React Native/Expo codebase |
| **Backend** | Flask (`POST /api/ask`), deployed on Render |
| **Retrieval** | Voyage AI embeddings, 512 passages, in-memory cosine similarity |
| **Generation** | Claude Haiku, grounded strictly in retrieved context |
| **Abuse control** | Per-device daily quota in SQLite, UTC reset, refund on failure |
| **Tests** | 125 Pytest tests, every external API mocked |

---

## Ask the Oracle — how a question is answered

```
question ─→ embed (Voyage) ─→ cosine similarity over 512 passages
                                        │
   ┌────────────────────────────────────┴─────────────────────┐
   │  mandatory context            │  top-3 retrieved         │
   │  · judgment of cast hexagram  │  thematically related    │
   │  · image (象辞)                │  passages from anywhere  │
   │  · each changing line          │  in the corpus          │
   │  · judgment of transformed hex │                         │
   └────────────────────────────────┴──────────────────────────┘
                                        │
                        each passage tagged quotable="yes|no"
                                        │
                              Claude Haiku ─→ answer
```

The cast reading is always included regardless of similarity score — a reading the
user actually threw should never be edged out of its own interpretation by a
better-matching passage from elsewhere.

Retrieval is plain NumPy over an in-memory matrix rather than a vector database.
At 512 vectors the full scan takes under a millisecond; a vector store would have
added an operational dependency for no measurable gain.

### Grounding guardrail

The corpus is uneven: classical source text is genuine for only part of the set,
and the English interpretations are templated past a certain point. Two independent
detectors classify all 512 passages at build time, and `oracle.py` renders each one
with a `quotable` flag the system prompt is bound by:

```xml
<passage id="hex60-line6" role="变爻 changing line 6" quotable="no">
[No classical source text was supplied for this passage. Everything below is
interpretation — do not reconstruct the original, do not render any of it back
into classical Chinese, and do not present any sentence as the source text.]
苦节，贞凶，悔亡——以极端苦涩的方式实践节制…
</passage>
```

The check is data-driven, not a hardcoded cutoff: repair the dataset, rebuild the
corpus, and the affected passages are released automatically. Tests cover that
transition in both directions.

---

## Features

### Free Tier
- 🪙 **Shake-to-Divine** — accelerometer-based coin casting with haptic feedback
- 📖 **64 Hexagrams** — full King Wen sequence with Judgment (卦辞) and Image (象)
- 🔄 **Changing Lines** — dynamic detection of Old Yin/Yang with transformed hexagram
- 🌐 **Bilingual** — seamless English/Chinese toggle, persisted across sessions
- 📝 **Inquiry Input** — optional question field saved with each divination
- 🔮 **Ask the Oracle** — free-form question about the reading, answered by a
  retrieval-augmented backend; 3 questions per day
- 📜 **History** — last 5 readings stored locally (SQLite on native, localStorage on web)

### Premium Tier
- ✦ **6 Life-Category Readings** — Career, Business, Romance, Health, Travel, Decision Making
- 🔮 **Full Changing Line Analysis** — deep interpretation of each changing line
- 📚 **Unlimited History** — all past divinations saved permanently
- 🏛 **Classical Reference** — sequence reasoning and historical notes per hexagram
- 🔮 **Ask the Oracle** — raised to 20 questions per day

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native (Expo), one codebase for iOS / Android / web |
| Navigation | React Navigation (Native Stack) |
| Backend | Python, Flask, gunicorn |
| Embeddings | Voyage AI (`voyage-3.5-lite`, 512-dim) |
| Retrieval | NumPy in-memory cosine similarity |
| Generation | Claude Haiku (Anthropic API) |
| Quota / storage | SQLite (server), expo-sqlite on native, localStorage on web |
| Testing | Pytest — 125 tests, all external APIs mocked |
| Deployment | Render (API), GitHub Pages (web), EAS Build (native) |
| Language System | Custom Context API (EN/ZH) |

Platform differences are isolated at single points rather than scattered across
call sites: `utils/motion.js` wraps the accelerometer (`expo-sensors` throws on
web), and `hooks/historyStorage.web.js` swaps SQLite for `AsyncStorage` (the
synchronous web SQLite API needs `SharedArrayBuffer`, which ordinary static
hosting cannot provide). Details in [WEB.md](WEB.md).

---

## Architecture Overview

```
iching-oracle/
│
├── App.js                    # Root: Navigation + Disclaimer modal
│
├── hooks/
│   ├── useIChing.js          # ★ Core divination logic
│   │                         #   Three Coin Method (三枚铜钱法)
│   │                         #   Hexagram lookup (King Wen sequence)
│   │                         #   Changing line detection
│   ├── useHistory.js         # SQLite read/write, FREE_HISTORY_LIMIT
│   └── usePremium.js         # Freemium gate, promo code, AsyncStorage
│
├── components/
│   └── ShakeSensor.js        # ★ Accelerometer → shake detection
│                             #   Haptic feedback sequencing
│
├── screens/
│   ├── HomeScreen.js         # Oracle interface, tilt-reactive coin
│   ├── ResultScreen.js       # Fortune scroll, base + premium tiers
│   ├── HistoryScreen.js      # Past readings, free/premium gate
│   ├── UpgradeScreen.js      # Paywall, promo code redemption
│   ├── AboutScreen.js        # Developer info, mission
│   └── DisclaimerScreen.js   # Legal (App Store compliant)
│
├── context/
│   └── LanguageContext.js    # Global EN/ZH state + UI_STRINGS
│
├── data/
│   └── hexagrams.json        # 64 hexagrams: judgment, image, lines,
│                             # premium categories (EN + ZH)
│
├── constants/
│   └── theme.js              # COLORS, FONTS, SPACING tokens
│
└── backend/                  # ★ Ask-the-Oracle API (Flask)
    ├── app.py                #   POST /api/ask — validation, quota, orchestration
    ├── retrieval.py          # ★ Corpus loading, cosine search, guardrail detectors
    ├── oracle.py             # ★ Prompt assembly, quotable flags, Claude call
    ├── embedding.py          #   Voyage query embedding
    ├── quota.py              #   Per-device daily limit, UTC rollover, refunds
    ├── stub_client.py        #   Offline answer generator (no API key needed)
    ├── scripts/
    │   ├── build_embeddings.py   # Corpus builder (resumable, rate-limit aware)
    │   ├── dump_prompt.py        # Print the exact prompt without paying for a call
    │   └── fetch_corpus.py       # Deploy-time corpus download
    └── tests/                #   125 tests, external APIs mocked throughout
```

---

## Divination Algorithm

The app implements the classical **Three-Coin Method**:

```
For each of 6 lines:
  Toss 3 coins → each coin = Heads (3pts) or Tails (2pts)
  Sum = 6, 7, 8, or 9

  6 = Old Yin  (changing) ══  →  ─
  7 = Young Yang           ─
  8 = Young Yin            ══
  9 = Old Yang (changing)  ─  →  ══

Changing lines (6 or 9) generate a Transformed Hexagram (变卦)
```

---

## Bilingual System

All content is fully localized using a custom `LanguageContext`:

```javascript
// Every UI string sourced from UI_STRINGS
t('sectionJudgment')     // '卦辞 · 判断' | 'JUDGMENT'

// Every hexagram field selected via pick()
pick(hexData.judgment, 'chinese', 'translation')

// Premium fields with graceful fallback
isZh ? (reading_zh || reading) : reading
```

---

## Freemium & Monetization

```
Free  → 5 history records, base hexagram reading, 3 oracle questions/day
Premium → Unlock via:
  • In-App Purchase (structured for StoreKit; currently a local mock)
  • Promo code: time-gated, dual AsyncStorage persistence
    - @iching_oracle:premium_unlocked_v1  (IAP key)
    - @premium_status                      (promo key)
```

The premium flag is **not** verified server-side. The client asserts it and the
API accepts it, because with a mocked purchase there is no receipt to validate
against — so premium only raises the daily cap, never unlocks anything that costs
real money to serve. Wiring in real StoreKit receipt validation is the change
that would make server-side trust meaningful.

---

## Running it

The web client is static and the API is a normal Flask app; neither needs the
other to start.

```bash
npx expo start                 # native, via Expo Go
```

```bash
cd backend && ORACLE_STUB_MODE=1 python app.py
```

`ORACLE_STUB_MODE=1` answers with locally generated placeholder text instead of
calling Claude, so the whole pipeline — validation, quota, retrieval, response
shape — can be exercised without an Anthropic key. It reuses the same injection
point the tests use, so the production path carries no branch for it, and
`/health` reports whether it is on.

```bash
cd backend && python -m pytest
```

See [backend/README.md](backend/README.md) for the API contract and deployment,
and [WEB.md](WEB.md) for the browser build.

---

## Cross-Platform

Rendering differences between iOS and Android are handled with `Platform.OS` conditional styles throughout, ensuring consistent UI across both platforms.

---

## Developer

**Daniel Liu**
Computer Science, Queens College CUNY

- 📧 danielliux7@gmail.com
- 💼 [LinkedIn](https://www.linkedin.com/in/daniel-liu-1a421a223/)
- 🐙 [GitHub](https://github.com/VRS-Empty)

---

## Disclaimer

This application is for **entertainment and self-reflection purposes only**. It does not provide medical, legal, financial, or any other professional advice. The developer is not responsible for any decisions made based on app readings.

---

