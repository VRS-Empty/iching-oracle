/**
 * context/LanguageContext.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Global language management for I-Ching Oracle.
 *
 * Supported locales:
 *   'zh' — Classical Chinese (uses .chinese / .pinyin fields)
 *   'en' — English         (uses .english / .translation fields)
 *
 * Architecture:
 *   ┌─────────────────────────────────────────────────┐
 *   │  LanguageProvider  (wraps entire app in App.js) │
 *   │    ├─ language: 'zh' | 'en'                     │
 *   │    ├─ toggleLanguage()  ← tap the toggle        │
 *   │    └─ isZh: boolean     ← convenience flag      │
 *   └─────────────────────────────────────────────────┘
 *
 * Consumers:
 *   const { language, toggleLanguage, isZh } = useLanguage();
 *   const { t, tf, tp }                      = useText();
 *
 * Hooks exported:
 *   useLanguage()  — raw context values
 *   useText()      — field-selector helpers (see JSDoc below)
 *
 * Persistence:
 *   Language preference is saved to AsyncStorage so it survives app restarts.
 *   On first launch, the device locale is detected and used as the default.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';

// ─── Constants ────────────────────────────────────────────────────────────────

export const LANG = {
  ZH: 'zh',
  EN: 'en',
};

const STORAGE_KEY = '@iching_oracle:language_v1';

// ─── Device locale detection ──────────────────────────────────────────────────

/**
 * Reads the device locale from native modules.
 * Returns 'zh' if the device is set to a Chinese locale, otherwise 'en'.
 */
function detectDeviceLocale() {
  try {
    const locale =
      Platform.OS === 'ios'
        ? NativeModules.SettingsManager?.settings?.AppleLocale ||
          NativeModules.SettingsManager?.settings?.AppleLanguages?.[0] ||
          'en'
        : NativeModules.I18nManager?.localeIdentifier || 'en';

    return locale.startsWith('zh') ? LANG.ZH : LANG.EN;
  } catch {
    return LANG.EN;
  }
}

// ─── UI String Tables ─────────────────────────────────────────────────────────
//
// Every hard-coded UI label in the app that needs translation lives here.
// Add new keys as the app grows; never hard-code strings in components.

export const UI_STRINGS = {
  // ── Navigation / Navbar
  navNewCast:         { zh: '← 重新起卦', en: '← New Cast' },
  navShare:           { zh: '分享 ↗',    en: 'Share ↗' },

  // ── Home Screen
  homeSubtitle:       { zh: '三枚铜钱法', en: 'Three Coin Method' },
  homeShakeHint:      { zh: '摇动或点击铜钱起卦', en: 'Shake or tap the coin to divine' },
  homeCastingLine:    { zh: '正在铸造第 {n} 爻，共 6 爻…', en: 'Casting line {n} of 6…' },
  homeHexTitle:       { zh: '卦象',       en: 'Hexagram' },
  homePremiumBadge:   { zh: '✦ 高级版 — 解锁变爻与深度分析', en: '✦ PREMIUM — Unlock Changing Lines & Deep Analysis' },
  homeHistory:        { zh: '历史',       en: 'History' },
  homeAbout:          { zh: '关于',       en: 'About' },
  homeDisclaimer:     { zh: '免责声明',   en: 'Disclaimer' },

  // ── Result Screen — Section titles
  sectionOriginal:    { zh: '本卦',                   en: 'ORIGINAL HEXAGRAM' },
  sectionTransformed: { zh: '变卦',                   en: 'TRANSFORMED HEXAGRAM' },
  sectionJudgment:    { zh: '卦辞 · 判断',            en: 'JUDGMENT' },
  sectionImage:       { zh: '象 · 卦象',              en: 'IMAGE' },
  sectionChanging:    { zh: '变爻 · 动爻解析',         en: 'CHANGING LINES' },
  sectionCategories:  { zh: '六类 · 生活指引',         en: 'LIFE CATEGORIES' },
  sectionClassical:   { zh: '典 · 经典参考',           en: 'CLASSICAL NOTES' },

  // ── Result Screen — Hexagram header labels
  hexOriginalLabel:   { zh: '本卦', en: 'Original' },
  hexTransLabel:      { zh: '变卦', en: 'Transformed' },
  hexUpperTrigram:    { zh: '上卦', en: 'Upper' },
  hexLowerTrigram:    { zh: '下卦', en: 'Lower' },

  // ── Result Screen — Changing lines
  changingLineLabel:  { zh: '第 {n} 爻 · {label}（{chinese}）',
                        en: 'Line {n} · {label} ({chinese})' },
  changingLocked:     { zh: '{n} 条变爻已检测到。\n解锁高级版可查看完整解释。',
                        en: '{n} changing line(s) detected.\nUnlock premium to see their full interpretation.' },

  // ── Result Screen — Guidance labels
  adviceTitle:        { zh: '指引', en: 'Guidance' },
  cautionTitle:       { zh: '⚠ 注意', en: '⚠ Caution' },

  // ── Result Screen — Disclaimer footer
  disclaimerFooter:   { zh: '仅供娱乐与反思之用，不构成专业建议。',
                        en: 'For entertainment and reflection only. Does not constitute professional advice.' },

  // ── Premium paywall
  paywallTitle:       { zh: '高级分析',   en: 'Premium Analysis' },
  paywallSubtitle:    { zh: '解锁变爻解析、六类生活指引，以及变卦（变卦）的完整解读——获得完整的占卜图景。',
                        en: 'Unlock Changing Lines interpretation, six life-category readings, and your Transformed Hexagram (变卦) — the full picture of your oracle.' },
  paywallCTA:         { zh: '解锁高级版 — ¥49.99', en: 'Unlock Premium — $6.99' },
  paywallNote:        { zh: '一次性终身解锁 · 无订阅',  en: 'One-time lifetime unlock · No subscription' },
  paywallFeatures:    {
    zh: ['变卦解析', '事业与商业指引', '感情与健康洞见', '决策神谕', '出行吉凶', '完整卦象历史'],
    en: ['变卦 Transformed Hexagram analysis', 'Career & Business guidance', 'Romance & Health insights', 'Decision-making oracle', 'Travel auspiciousness', 'Full divination history'],
  },

  // ── Premium — fallback notice (when Chinese reading is unavailable)
  premiumFallbackNote:{ zh: '（此条目仅提供英文解读）', en: '' },

  // ── Auspiciousness label
  auspiciousnessLabel:{ zh: '{chinese}', en: '{chinese} · {english}' },
};

// ─── Context ──────────────────────────────────────────────────────────────────

const LanguageContext = createContext({
  language:       LANG.EN,
  toggleLanguage: () => {},
  setLanguage:    () => {},
  isZh:           false,
  isReady:        false,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(LANG.EN);
  const [isReady,  setIsReady]       = useState(false);

  // ── Hydrate from storage on mount ────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored === LANG.ZH || stored === LANG.EN) {
          setLanguageState(stored);
        } else {
          // First launch: default to device locale
          setLanguageState(detectDeviceLocale());
        }
      } catch {
        setLanguageState(LANG.EN);
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  // ── Setters ───────────────────────────────────────────────────────────────
  const setLanguage = useCallback(async (lang) => {
    if (lang !== LANG.ZH && lang !== LANG.EN) return;
    setLanguageState(lang);
    try { await AsyncStorage.setItem(STORAGE_KEY, lang); } catch { /* silent */ }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === LANG.ZH ? LANG.EN : LANG.ZH);
  }, [language, setLanguage]);

  // ── Memoised context value ────────────────────────────────────────────────
  const value = useMemo(() => ({
    language,
    toggleLanguage,
    setLanguage,
    isZh:    language === LANG.ZH,
    isReady,
  }), [language, toggleLanguage, setLanguage, isReady]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

// ─── useLanguage ──────────────────────────────────────────────────────────────

/**
 * Primary hook. Returns the raw language context.
 *
 * @example
 * const { language, isZh, toggleLanguage } = useLanguage();
 */
export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return ctx;
}

// ─── useText ──────────────────────────────────────────────────────────────────

/**
 * Derived hook providing three field-selector utilities. All selectors are
 * pure functions — safe to call in render, no side effects.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │  t(key)              — look up a UI_STRINGS key for the active locale  │
 * │  tf(key, vars)       — same, with {placeholder} interpolation          │
 * │  pick(obj, zhKey, enKey, fallback?)                                    │
 * │    — pull the right field off a hexagram sub-object by locale          │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * @example
 * const { t, tf, pick } = useText();
 *
 * // UI string:
 * t('navNewCast')                          // '← 重新起卦' | '← New Cast'
 *
 * // UI string with interpolation:
 * tf('homeCastingLine', { n: 3 })          // '正在铸造第 3 爻…' | 'Casting line 3 of 6…'
 *
 * // Hexagram field:
 * pick(hexData.name, 'chinese', 'english') // '乾' | 'The Creative'
 * pick(hexData.judgment, 'chinese', 'translation')
 * pick(hexData.image,    'chinese', 'interpretation')
 *
 * // Premium field with fallback (no Chinese equivalent in JSON):
 * pick(premiumCategory, 'reading_zh', 'reading', premiumCategory.reading)
 */
export function useText() {
  const { language, isZh } = useLanguage();

  /**
   * Look up a UI string key.
   * @param {keyof typeof UI_STRINGS} key
   * @returns {string}
   */
  const t = useCallback((key) => {
    const entry = UI_STRINGS[key];
    if (!entry) {
      if (__DEV__) console.warn(`[useText] Missing UI string key: "${key}"`);
      return key;
    }
    return isZh ? entry.zh : entry.en;
  }, [isZh]);

  /**
   * Look up a UI string key and interpolate {placeholder} variables.
   * @param {keyof typeof UI_STRINGS} key
   * @param {Record<string, string|number>} vars
   * @returns {string}
   */
  const tf = useCallback((key, vars = {}) => {
    let str = t(key);
    Object.entries(vars).forEach(([k, v]) => {
      str = str.replaceAll(`{${k}}`, String(v));
    });
    return str;
  }, [t]);

  /**
   * Pick a field off any hexagram sub-object based on the active language.
   *
   * @param {object|null|undefined} obj       — the sub-object (e.g. hexData.judgment)
   * @param {string}                zhKey     — key to use when language is 'zh'
   * @param {string}                enKey     — key to use when language is 'en'
   * @param {string}                [fallback] — returned if both keys are missing/falsy
   * @returns {string}
   */
  const pick = useCallback((obj, zhKey, enKey, fallback = '') => {
    if (!obj) return fallback;
    const primary   = isZh ? obj[zhKey] : obj[enKey];
    const secondary = isZh ? obj[enKey] : obj[zhKey]; // cross-language fallback
    return primary || secondary || fallback;
  }, [isZh]);

  /**
   * Pick a field from a premium category object.
   *
   * Premium categories in hexagrams.json currently only have English `reading`,
   * `actionable_advice`, and `caution`. This selector applies a three-tier
   * fallback strategy:
   *
   *   Tier 1 (best):   obj.reading_zh         — future Chinese reading field
   *   Tier 2 (good):   obj.reading            — English reading (always present)
   *   Tier 3 (last):   fallback string         — empty string
   *
   * For advice arrays:
   *   Tier 1:          obj.actionable_advice_zh
   *   Tier 2:          obj.actionable_advice
   *
   * This means the app works beautifully today (English-only premium data) and
   * automatically upgrades when Chinese fields are added to hexagrams.json —
   * zero code changes required.
   *
   * @param {object} premiumCategory  — e.g. hexData.premium.career
   * @returns {{ reading, advice, caution, auspiciousness, hasChinese }}
   */
  const pickPremium = useCallback((premiumCategory) => {
    if (!premiumCategory) return {
      reading: '',
      advice: [],
      caution: '',
      auspiciousness: '',
      auspiciousness_chinese: '',
      hasChinese: false,
    };

    const hasChinese = isZh && !!premiumCategory.reading_zh;

    return {
      reading: isZh
        ? (premiumCategory.reading_zh || premiumCategory.reading || '')
        : (premiumCategory.reading || ''),

      advice: isZh
        ? (premiumCategory.actionable_advice_zh || premiumCategory.actionable_advice || [])
        : (premiumCategory.actionable_advice || []),

      caution: isZh
        ? (premiumCategory.caution_zh || premiumCategory.caution || '')
        : (premiumCategory.caution || ''),

      auspiciousness: isZh
        ? premiumCategory.auspiciousness_chinese
        : premiumCategory.auspiciousness,

      auspiciousness_chinese: premiumCategory.auspiciousness_chinese,

      // True only when native Chinese content exists; consumers can show
      // the FALLBACK_NOTE badge when this is false in zh mode.
      hasChinese,
    };
  }, [isZh]);

  return { t, tf, pick, pickPremium, isZh, language };
}

export default LanguageContext;
