# 易鉴 I-Ching Oracle

> A cross-platform mobile divination app for iOS and Android built with React Native (Expo).

```
 ██████╗  ██████╗██╗  ██╗██╗███╗   ██╗ ██████╗     ██████╗ ██████╗  █████╗  ██████╗██╗     ███████╗
 ██╔══██╗██╔════╝██║  ██║██║████╗  ██║██╔════╝     ██╔═══██╗██╔══██╗██╔══██╗██╔════╝██║     ██╔════╝
 ██║  ██║███████╗███████║██║██╔██╗ ██║██║  ███╗    ██║   ██║██████╔╝███████║██║     ██║     █████╗  
 ██║  ██║╚════██║██╔══██║██║██║╚██╗██║██║   ██║    ██║   ██║██╔══██╗██╔══██║██║     ██║     ██╔══╝  
 ██████╔╝███████║██║  ██║██║██║ ╚████║╚██████╔╝    ╚██████╔╝██║  ██║██║  ██║╚██████╗███████╗███████╗
 ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝ ╚═════╝      ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚══════╝
```

---

## Architecture Overview

```
iching-oracle/
│
├── App.js                      # Root: Navigation + Disclaimer modal
│
├── hooks/
│   └── useIChing.js            # ★ Core divination logic
│                               #   Three Coin Method (三枚铜钱法)
│                               #   Hexagram lookup (King Wen sequence)
│                               #   Changing line detection
│
├── components/
│   └── ShakeSensor.js          # ★ Accelerometer → shake detection
│                               #   Haptic feedback sequencing
│                               #   Imperative ref handle
│
├── screens/
│   ├── HomeScreen.js           # Oracle interface, tilt-reactive coin
│   └── ResultScreen.js         # Fortune scroll, base + premium tiers
│
├── data/
│   └── hexagrams.json          # 64 hexagrams (3 seeded, schema for all)
│
└── constants/
    └── theme.js                # Design tokens: colors, fonts, spacing
```

---

## Divination Logic

The **Three Coin Method** (三枚铜钱法) simulates 6 throws of 3 coins:

| Result       | Value | Type           | Line Symbol |
|-------------|-------|----------------|-------------|
| 3 Tails     | 6     | Old Yin        | `-- ×`      |
| 2T + 1H     | 7     | Young Yang     | `———`       |
| 2H + 1T     | 8     | Young Yin      | `- -`       |
| 3 Heads     | 9     | Old Yang       | `——o`       |

Changing lines (6, 9) produce a **Transformed Hexagram** (变卦):
- Old Yin (6) → becomes Yang in the transformed hexagram  
- Old Yang (9) → becomes Yin in the transformed hexagram

---

## Feature Tiers

| Feature                          | Base ($1.99) | Premium ($6.99) |
|----------------------------------|:------------:|:---------------:|
| Shake to Divine                  | ✓            | ✓               |
| Hexagram symbol & name           | ✓            | ✓               |
| Judgment (卦辞) & Auspiciousness  | ✓            | ✓               |
| Changing Lines interpretation    | —            | ✓               |
| Transformed Hexagram (变卦)       | —            | ✓               |
| Career, Business readings        | —            | ✓               |
| Romance, Health readings          | —            | ✓               |
| Travel & Decision readings       | —            | ✓               |
| Divination history log           | —            | ✓               |

---

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Start Expo dev server
npx expo start

# 3. Open on device or simulator
#    Press 'i' for iOS Simulator, 'a' for Android Emulator
#    Or scan QR code with Expo Go app
```

### Prerequisites
- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- Xcode (for iOS) or Android Studio (for Android)
- Physical device recommended for shake detection testing

---

## Key Implementation Notes

### `useIChing` Hook
- Pure probabilistic logic — no network calls, no predetermined results
- `castHexagram(onLineFormed)` is async — yields between lines for animation
- King Wen sequence lookup via binary polarity key (`"111111"` = Hexagram 1)
- Exposes `getChangingLineDetails()` for premium rendering

### `ShakeSensor` Component
- Uses **jerk detection** (Δacceleration) rather than raw magnitude for reliability
- `CONSECUTIVE_THRESHOLD_COUNT: 2` prevents noise spikes from triggering casts
- Haptic pattern: Heavy for changing lines, Light for static lines
- `useImperativeHandle` exposes `triggerCast()` for button-based casting

### Hexagram Data Schema
```json
{
  "number": 1,
  "name": { "chinese": "乾", "pinyin": "Qián", "english": "The Creative" },
  "polarities": [1,1,1,1,1,1],
  "auspiciousness": { "rating": 5, "label": "Supreme Fortune" },
  "judgment": { "chinese": "...", "translation": "...", "summary": "..." },
  "lines": [ /* 6 line objects with position, text, interpretation */ ],
  "premium": {
    "career": { "rating": 5, "reading": "...", "actionable_advice": [], "caution": "..." },
    "business": { ... },
    "romance": { ... },
    "travel": { ... },
    "health": { ... },
    "decision_making": { ... }
  }
}
```

---

## Completing the Hexagram Database

The JSON template seeds hexagrams 1–3. To complete all 64:

1. Follow the identical schema in `data/hexagrams.json`
2. Use the `KING_WEN_LOOKUP` table in `useIChing.js` as your polarity reference
3. Each hexagram requires: name, symbol, trigrams, polarities, judgment, image, 6 lines, premium categories

The `lookupHexagramNumber()` function is already wired to handle all 64 entries the moment they are added to the JSON.

---

## Monetization Implementation

Replace the `useIsPremium()` mock in `ResultScreen.js` with:

```js
import * as InAppPurchases from 'expo-in-app-purchases';

const PREMIUM_PRODUCT_ID = 'com.yourcompany.ichingOracle.premium_lifetime';

async function checkPremiumStatus() {
  await InAppPurchases.connectAsync();
  const history = await InAppPurchases.getPurchaseHistoryAsync();
  return history.results.some(p => p.productId === PREMIUM_PRODUCT_ID);
}
```

---

## Design System

| Token       | Value       | Usage               |
|-------------|-------------|---------------------|
| `background`| `#000000`   | Screen backgrounds   |
| `surface`   | `#0D0D0D`   | Cards, panels        |
| `gold`      | `#D4AF37`   | Primary accent       |
| `goldMuted` | `#A88B20`   | Secondary labels     |
| `changing`  | `#E8A020`   | Changing line markers|
| `text`      | `#F0E6C8`   | Body copy            |

**Recommended fonts** (load via `expo-font`):
- Display / Chinese: **Noto Serif SC** (Google Fonts)
- Body reading: **EB Garamond** or **Crimson Pro**
- Labels / UI: **Cinzel** or **Cormorant SC**

---

## Legal

- For entertainment purposes only
- Does not constitute professional medical, legal, or financial advice
- Disclaimer shown on first launch (AsyncStorage `@iching_oracle:disclaimer_accepted_v1`)
- I Ching text interpretations are original compositions inspired by classical sources
