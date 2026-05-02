# 易鉴 I-Ching Oracle

> A cross-platform bilingual divination app for iOS & Android built with React Native and Expo.

![Platform](https://img.shields.io/badge/Platform-iOS%20%7C%20Android-black?style=flat-square)
![Built With](https://img.shields.io/badge/Built%20With-React%20Native-61DAFB?style=flat-square&logo=react)
![Language](https://img.shields.io/badge/Language-EN%20%7C%20ZH-D4AF37?style=flat-square)
![Expo](https://img.shields.io/badge/Expo-EAS%20Build-000020?style=flat-square&logo=expo)
![Status](https://img.shields.io/badge/Status-Live-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/License-Private-red?style=flat-square)

---

## Overview

**易鉴 (I-Ching Oracle)** is a full-stack mobile application that bridges 3,000 years of classical Chinese philosophy with modern technology. Users shake or tap a coin to cast hexagrams using the traditional Three-Coin Method (三枚铜钱法), receiving bilingual interpretations across 64 hexagrams drawn from the Zhou Yi (周易).

Built entirely independently using AI-assisted development workflows (Claude/LLM), this project demonstrates end-to-end mobile engineering from architecture to App Store deployment.

---

## Features

### Free Tier
- 🪙 **Shake-to-Divine** — accelerometer-based coin casting with haptic feedback
- 📖 **64 Hexagrams** — full King Wen sequence with Judgment (卦辞) and Image (象)
- 🔄 **Changing Lines** — dynamic detection of Old Yin/Yang with transformed hexagram
- 🌐 **Bilingual** — seamless English/Chinese toggle, persisted across sessions
- 📝 **Inquiry Input** — optional question field saved with each divination
- 📜 **History** — last 5 readings stored locally via SQLite

### Premium Tier
- ✦ **6 Life-Category Readings** — Career, Business, Romance, Health, Travel, Decision Making
- 🔮 **Full Changing Line Analysis** — deep interpretation of each changing line
- 📚 **Unlimited History** — all past divinations saved permanently
- 🏛 **Classical Reference** — sequence reasoning and historical notes per hexagram

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native (Expo) |
| Navigation | React Navigation (Native Stack) |
| Local Database | expo-sqlite (SQLite) |
| Persistence | AsyncStorage |
| Animations | React Native Animated API |
| Sensors | expo-sensors (Accelerometer) |
| Build & Deploy | EAS Build (Expo Application Services) |
| Language System | Custom Context API (EN/ZH) |
| AI Development | Claude (Anthropic) — Prompt Engineering |

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
└── constants/
    └── theme.js              # COLORS, FONTS, SPACING tokens
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
Free  → 5 history records, base hexagram reading
Premium → Unlock via:
  • In-App Purchase (IAP ready, mock in dev)
  • Promo code: time-gated, dual AsyncStorage persistence
    - @iching_oracle:premium_unlocked_v1  (IAP key)
    - @premium_status                      (promo key)
```

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

