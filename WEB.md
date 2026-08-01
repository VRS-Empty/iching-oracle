# Web Build & Deployment

The Expo app also builds for the browser, which makes it showable without an
App Store listing. This document covers building it, deploying it, and what
differs from the native app.

---

## Build

```bash
npx expo export --platform web --output-dir dist-web
```

Output is `dist-web/` — around 2.3 MB of static files, no server runtime. It is
gitignored; rebuild it as part of deploying rather than committing it.

To preview locally:

```bash
npx serve dist-web
```

or, without installing anything:

```bash
python -m http.server 4173 --directory dist-web
```

---

## Deploy

Any static host works. The build deliberately has **no cross-origin isolation
requirement** (see *History storage* below), so there are no custom response
headers to configure — including on hosts that cannot set them, such as GitHub
Pages.

| Host | How |
| --- | --- |
| Cloudflare Pages | Connect the repo. Build `npx expo export --platform web --output-dir dist-web`, output directory `dist-web`. |
| Netlify | Same build command; publish directory `dist-web`. |
| Vercel | Same, framework preset "Other". |
| GitHub Pages | Build locally, push `dist-web/` to a `gh-pages` branch. Two extras: set `expo.experiments.baseUrl` to `"/iching-oracle"` in app.json before building (project pages are served under a subpath, and the bundle URLs in index.html are absolute), and add an empty `.nojekyll` file to the branch root (Pages runs Jekyll by default, which silently drops the `_expo/` directory because of the leading underscore). |
| Render | New → Static Site, same build command and publish directory. |

### Pointing at the backend

The Ask-the-Oracle feature calls the Flask backend. After deploying it (see
`backend/README.md`), set `PRODUCTION_URL` in `constants/api.js` to the
service's URL and rebuild the web bundle. Until then, release builds point at a
placeholder domain and the question box reports a connection error.

CORS is already handled — the backend sends `Access-Control-Allow-Origin: *`,
which is what a browser client needs and a native client does not.

### Showing the feature without an Anthropic key

Answer generation is the one part that costs money. A backend deployed with
`ORACLE_STUB_MODE=1` will answer, but every reply opens with
`[STUB MODE — no Claude API key configured...]`. That is honest for a portfolio
piece — the pipeline, retrieval, quota, and UI are all genuinely running — but
the marker is visible to anyone who tries it. Decide whether you would rather
show that or leave the feature erroring until a key is available.

---

## What differs from the native app

| | Native | Web |
| --- | --- | --- |
| Cast gesture | Shake or tap | **Tap only** — browsers have no accelerometer |
| Coin tilt animation | Follows device tilt | Static |
| Haptics | Vibration patterns | Silent (`navigator.vibrate` where supported) |
| History storage | SQLite (`expo-sqlite`) | **localStorage** (`AsyncStorage`) |
| Language default | Device locale | `navigator.language` |
| In-app purchase | Mock, ready for StoreKit | Mock only — no web purchase path |

None of these degrade silently. The home screen reads "点击铜钱起卦" / "Tap the
coin to divine" rather than promising a shake, and each platform difference is
handled at a single shared point rather than scattered across call sites.

### Why history uses localStorage on web

`expo-sqlite` does ship a web implementation, but its **synchronous** API —
which `useHistory` uses — reaches its Worker through `Atomics.wait` on a
`SharedArrayBuffer`. `SharedArrayBuffer` exists only in a cross-origin isolated
context, which requires the host to send

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without them `new SharedArrayBuffer()` throws. Because the call happens inside a
React effect, the throw is uncaught during commit and React 19 unmounts the
entire tree — the symptom is a blank page with nothing in the console, not a
broken history list. And `useHistory` is used by ResultScreen too, so it would
have hit immediately after the first cast, not just on the History tab.

Rather than tie the web build to hosts that can set those headers,
`hooks/historyStorage.web.js` stores the same rows in `AsyncStorage`. Metro
resolves it automatically for web; `historyStorage.js` keeps the SQLite path
for native, unchanged. A side effect is a smaller bundle — the 618 kB wasm
binary and its 139 kB worker are no longer part of the web build at all.

### Why `.wasm` is registered in metro.config.js

`metro.config.js` adds `wasm` to `resolver.assetExts`. With the storage split
above, the web build no longer pulls in expo-sqlite's wasm, so this is not
strictly required today — it is kept so that reintroducing any wasm-backed
dependency does not fail the build with an opaque resolution error.

---

## Troubleshooting

**Blank page, nothing in the console.** Almost always a native module throwing
inside a React effect: React unmounts the tree and the error never reaches
`console.error`. To see it, add an early capture to `dist-web/index.html`
before the bundle script:

```html
<script>
  window.__errs = [];
  addEventListener('error', e => window.__errs.push((e.error && e.error.stack) || e.message));
  addEventListener('unhandledrejection', e => window.__errs.push(e.reason));
</script>
```

Then read `window.__errs` in the console. This is how both the accelerometer
and SharedArrayBuffer failures above were found.

**"Unable to resolve module ./wa-sqlite/wa-sqlite.wasm".** `metro.config.js` is
missing or does not push `wasm` onto `resolver.assetExts`.

**Question box says it cannot reach the oracle.** The backend is not deployed,
`PRODUCTION_URL` still points at the placeholder, or the backend is down —
check `<backend-url>/health` directly.

---

## Verified in-browser

The full flow — disclaimer accept → tap-to-cast → result screen → ask the
oracle (against a stub-mode backend) → history list → reopen from history —
has been exercised in a browser against the exported bundle, with no console
errors. All three platform fixes above are confirmed working.

A note for automated testing: react-native-web ignores a bare synthetic
`click`, which is why earlier automation could not tap the coin. Its
Pressability responds once the full pointer sequence is dispatched on the
element — `pointerdown`, `mousedown`, `pointerup`, `mouseup`, `click`, each
with `bubbles: true` and coordinates. Text input needs the native value
setter plus an `input` event, as usual for controlled React inputs.
