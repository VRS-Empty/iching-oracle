/**
 * ResultScreen.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Displays the divination result as a "Fortune Scroll."
 *
 * Language system:
 *   Every piece of data from hexagrams.json is selected through useText()
 *   helpers, never accessed directly. This makes the entire screen reactive
 *   to language toggles with zero conditional render logic in JSX.
 *
 *   Field mapping (hexagrams.json → displayed text):
 *   ┌─────────────────────────┬──────────────────────────┬─────────────────────────┐
 *   │ Section                 │ Chinese ('zh')            │ English ('en')          │
 *   ├─────────────────────────┼──────────────────────────┼─────────────────────────┤
 *   │ Hexagram name           │ name.chinese              │ name.english            │
 *   │ Hexagram subtitle       │ name.pinyin               │ name.romanized          │
 *   │ Judgment primary        │ judgment.chinese          │ judgment.translation    │
 *   │ Judgment body           │ judgment.summary_zh ¹     │ judgment.summary        │
 *   │ Image primary           │ image.chinese             │ image.translation       │
 *   │ Image body              │ image.interpretation_zh ¹ │ image.interpretation    │
 *   │ Line primary            │ line.chinese              │ line.translation        │
 *   │ Line body               │ line.interpretation_zh ¹  │ line.interpretation     │
 *   │ Trigram name            │ trigram.chinese           │ trigram.name            │
 *   │ Transformed body        │ judgment.summary_zh ¹     │ judgment.summary        │
 *   │ Classical notes         │ *_zh fields ¹             │ English fields          │
 *   │ Premium reading         │ reading_zh ¹              │ reading                 │
 *   │ Premium advice          │ actionable_advice_zh ¹    │ actionable_advice       │
 *   │ Premium caution         │ caution_zh ¹              │ caution                 │
 *   └─────────────────────────┴──────────────────────────┴─────────────────────────┘
 *   ¹ Graceful fallback: if the _zh field is absent or empty, the English field
 *     is displayed instead. This lets the JSON be populated incrementally without
 *     ever showing a blank to the user.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, {
  useRef, useEffect, useState, useCallback, useMemo,
} from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  Animated, StyleSheet, Dimensions, Platform, Share,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute } from '@react-navigation/native';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import { describeLineValue, LINE_VALUE } from '../hooks/useIChing';

// ── Language system ────────────────────────────────────────────────────────────
import { useText } from '../context/LanguageContext';
import LanguageToggle from '../components/LanguageToggle';

// ── Premium & history ─────────────────────────────────────────────────────────
import { usePremium } from '../hooks/usePremium';
import { useHistory } from '../hooks/useHistory';

// ── Ask the Oracle (RAG follow-up questions) ─────────────────────────────────
import AskOracleSection from '../components/AskOracleSection';

const { width: SCREEN_W } = Dimensions.get('window');

// ─── Category config — icon & key are language-independent ───────────────────

const CATEGORY_CONFIG = [
  { key: 'career',          icon: '⚔', labelZh: '事业', labelEn: 'Career'   },
  { key: 'business',        icon: '⚖', labelZh: '商业', labelEn: 'Business' },
  { key: 'romance',         icon: '♥', labelZh: '感情', labelEn: 'Romance'  },
  { key: 'travel',          icon: '◉', labelZh: '出行', labelEn: 'Travel'   },
  { key: 'health',          icon: '✦', labelZh: '健康', labelEn: 'Health'   },
  { key: 'decision_making', icon: '◈', labelZh: '决断', labelEn: 'Decision' },
];

// ─── AuspiciousnessStars ──────────────────────────────────────────────────────

function AuspiciousnessStars({ rating = 0, max = 5 }) {
  return (
    <View style={styles.starsRow}>
      {Array.from({ length: max }).map((_, i) => (
        <Text key={i} style={[styles.star, i < rating && styles.starActive]}>✦</Text>
      ))}
    </View>
  );
}

// ─── HexagramVisual ───────────────────────────────────────────────────────────

function HexagramVisual({ polarities = [], changingIndices = [] }) {
  if (!polarities || polarities.length < 6) return null;
  return (
    <View style={styles.hexVisual}>
      {[5, 4, 3, 2, 1, 0].map(i => {
        const isYang     = polarities[i] === 1;
        const isChanging = changingIndices.includes(i);
        return (
          <View key={i} style={styles.hexLineRow}>
            {isYang ? (
              <View style={[styles.hexLineFull, isChanging && styles.hexLineChanging]} />
            ) : (
              <View style={styles.hexBrokenRow}>
                <View style={[styles.hexLineHalf, isChanging && styles.hexLineChanging]} />
                <View style={styles.hexLineGap} />
                <View style={[styles.hexLineHalf, isChanging && styles.hexLineChanging]} />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ─── CategoryCard (language-aware) ───────────────────────────────────────────

function CategoryCard({ categoryKey, premiumData }) {
  const [expanded, setExpanded] = useState(false);
  const { isZh, pickPremium, t } = useText();

  const config  = CATEGORY_CONFIG.find(c => c.key === categoryKey);
  const content = useMemo(() => pickPremium(premiumData), [pickPremium, premiumData]);

  if (!config || !premiumData) return null;

  const label = isZh ? config.labelZh : config.labelEn;

  return (
    <TouchableOpacity
      style={styles.categoryCard}
      onPress={() => setExpanded(e => !e)}
      activeOpacity={0.85}
    >
      {/* ── Card header ─────────────────────────────────────────────────── */}
      <View style={styles.categoryHeader}>
        <View style={styles.categoryLeft}>
          <Text style={styles.categoryIcon}>{config.icon}</Text>
          <View>
            <Text style={styles.categoryLabel}>{label}</Text>
            {/* Always show the Chinese sub-label for cultural authenticity */}
            <Text style={styles.categoryChinese}>{config.labelZh}</Text>
          </View>
        </View>
        <View style={styles.categoryRight}>
          <AuspiciousnessStars rating={premiumData.rating ?? 0} />
          <Text style={styles.expandChevron}>{expanded ? '▲' : '▼'}</Text>
        </View>
      </View>

      {/* ── Expanded body ────────────────────────────────────────────────── */}
      {expanded && (
        <View style={styles.categoryBody}>

          {/* Auspiciousness label — always shows Chinese + conditional English */}
          <View style={styles.categoryAuspRow}>
            <Text style={styles.categoryAuspChinese}>
              {content.auspiciousness_chinese}
            </Text>
            {!isZh && (
              <Text style={styles.categoryAuspEnglish}>
                {premiumData.auspiciousness}
              </Text>
            )}
          </View>

          {/* Reading — with fallback badge when zh mode but no Chinese text */}
          {isZh && !content.hasChinese && (
            <View style={styles.fallbackBadge}>
              <Text style={styles.fallbackText}>
                {t('premiumFallbackNote')}
              </Text>
            </View>
          )}
          <Text style={styles.categoryReading}>{content.reading}</Text>

          {/* Actionable advice */}
          {content.advice.length > 0 && (
            <View style={styles.adviceBlock}>
              <Text style={styles.adviceTitle}>{t('adviceTitle')}</Text>
              {content.advice.map((item, i) => (
                <View key={i} style={styles.adviceRow}>
                  <Text style={styles.adviceDot}>—</Text>
                  <Text style={styles.adviceText}>{item}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Caution */}
          {!!content.caution && (
            <View style={styles.cautionBlock}>
              <Text style={styles.cautionLabel}>{t('cautionTitle')}</Text>
              <Text style={styles.cautionText}>{content.caution}</Text>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── PremiumGateCTA (language-aware, hexagram-aware) ─────────────────────────
//
// Replaces the old generic PremiumPaywall. Key differences:
//   • References the specific hexagram by name so the CTA feels personal
//   • Shows the 6 category icons as locked "preview pills" to create desire
//   • Star ratings shown as dimmed to imply hidden depth
//   • A "What's inside" teaser section shows the category count

function PremiumGateCTA({ hexData, onUpgrade }) {
  const { t, isZh } = useText();

  // Derive hexagram name for the personalised headline
  const hexName = isZh
    ? `${hexData?.name?.chinese ?? ''}（${hexData?.name?.pinyin ?? ''}）`
    : `${hexData?.name?.english ?? ''} (${hexData?.name?.chinese ?? ''})`;

  const headlineZh = `解锁「${hexData?.name?.chinese ?? ''}」的完整深度解析`;
  const headlineEn = `Unlock the full ${hexData?.name?.english ?? ''} analysis`;

  const bodyZh = '易鉴高级版为每一卦提供六大维度的深度解读——涵盖事业、商业、感情、健康、出行与决策。每条解读均配有具体行动指引与注意事项。';
  const bodyEn = 'I-Ching Oracle Premium provides six-category deep analysis for every hexagram — Career, Business, Romance, Health, Travel, and Decision Making — each with specific actionable guidance and cautions.';

  return (
    <View style={styles.premiumGate}>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <View style={styles.premiumGateHeader}>
        <Text style={styles.premiumGateIcon}>✦</Text>
        <Text style={styles.premiumGateTitle}>
          {isZh ? '高级版内容' : 'PREMIUM'}
        </Text>
      </View>

      <Text style={styles.premiumGateHeadline}>
        {isZh ? headlineZh : headlineEn}
      </Text>
      <Text style={styles.premiumGateBody}>
        {isZh ? bodyZh : bodyEn}
      </Text>

      {/* ── Category preview pills (locked) ─────────────────────────────── */}
      <View style={styles.premiumGatePills}>
        {CATEGORY_CONFIG.map((c, i) => (
          <View key={c.key} style={styles.premiumGatePill}>
            <Text style={styles.premiumGatePillIcon}>{c.icon}</Text>
            <Text style={styles.premiumGatePillLabel}>
              {isZh ? c.labelZh : c.labelEn}
            </Text>
            {/* Dimmed star ratings as "hidden depth" teaser */}
            <View style={styles.premiumGatePillStars}>
              {[0,1,2,3,4].map(j => (
                <Text key={j} style={styles.premiumGatePillStar}>✦</Text>
              ))}
            </View>
            <View style={styles.premiumGateLockDot}>
              <Text style={styles.premiumGateLockIcon}>🔒</Text>
            </View>
          </View>
        ))}
      </View>

      {/* ── What you get strip ───────────────────────────────────────────── */}
      <View style={styles.premiumGateValueRow}>
        {[
          { n: '6',  zh: '解读维度', en: 'Life categories' },
          { n: '64', zh: '卦象覆盖', en: 'Hexagrams covered' },
          { n: '∞',  zh: '历史记录', en: 'History records'  },
        ].map(item => (
          <View key={item.n} style={styles.premiumGateValueItem}>
            <Text style={styles.premiumGateValueNum}>{item.n}</Text>
            <Text style={styles.premiumGateValueLabel}>
              {isZh ? item.zh : item.en}
            </Text>
          </View>
        ))}
      </View>

      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <TouchableOpacity style={styles.premiumGateCTA} onPress={onUpgrade} activeOpacity={0.88}>
        <LinearGradient
          colors={['#C9A227', '#D4AF37', '#F0D060', '#D4AF37', '#B8941F']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={styles.premiumGateCTAGradient}
        >
          <Text style={styles.premiumGateCTAText}>
            {isZh ? '解锁高级版 — ¥49.99' : 'Unlock Premium — $6.99'}
          </Text>
          <Text style={styles.premiumGateCTASub}>
            {isZh ? '一次性买断 · 永久有效' : 'One-time · Lifetime access'}
          </Text>
        </LinearGradient>
      </TouchableOpacity>

      <Text style={styles.premiumGateNote}>
        {isZh ? '或前往升级页面了解全部功能' : 'Or visit the upgrade page for full details'}
      </Text>
    </View>
  );
}

// ─── ResultScreen ─────────────────────────────────────────────────────────────

export default function ResultScreen() {
  const navigation = useNavigation();
  const route      = useRoute();

  // ── Premium state (real hook, replaces per-file mock) ─────────────────────
  const { isPremium } = usePremium();

  // ── History — auto-save this cast on first render ─────────────────────────
  // fromHistory=true means we are replaying a saved cast from HistoryScreen;
  // skip saving so we don't update the timestamp or cause a duplicate attempt.
  const { saveCast } = useHistory();
  const fromHistory  = route.params?.fromHistory ?? false;

  // ── Language hooks ─────────────────────────────────────────────────────────
  const { t, tf, pick, pickPremium, isZh } = useText();

  const result      = route.params?.result;
  const question    = route.params?.question ?? result?.question ?? null;
  const original    = result?.originalHexagram;
  const transformed = result?.transformedHexagram;
  const hasChanging = (result?.changingLineIndices?.length ?? 0) > 0;

  // ── Entrance animation ─────────────────────────────────────────────────────
  const scrollFade  = useRef(new Animated.Value(0)).current;
  const headerSlide = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(scrollFade,  { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(headerSlide, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
    ]).start();
  }, []);

  // Re-run entrance when language changes (subtle refresh feel)
  useEffect(() => {
    scrollFade.setValue(0.6);
    Animated.timing(scrollFade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [isZh]);

  // ── Auto-save to history ───────────────────────────────────────────────────
  // Runs once on mount. INSERT OR IGNORE in useHistory prevents duplicates if
  // the user somehow navigates here twice for the same sessionId.
  useEffect(() => {
    if (!fromHistory && result?.sessionId) {
      saveCast(result, question);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable for the lifetime of this screen — intentional empty deps

  // ── Share ──────────────────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    if (!original?.data) return;
    const nameDisplay = isZh
      ? original.data.name.chinese
      : `${original.data.name.english} (${original.data.name.chinese})`;
    const judgmentText = isZh
      ? original.data.judgment.chinese
      : original.data.judgment.translation;
    try {
      await Share.share({
        message: `易鉴 I-Ching Oracle — 第${original.number}卦: ${nameDisplay}\n\n"${judgmentText}"\n\nDivined with 易鉴 I-Ching Oracle`,
      });
    } catch { /* user cancelled */ }
  }, [original, isZh]);

  const handleUpgrade = useCallback(() => navigation.navigate('Upgrade'), [navigation]);

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!original?.data) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: COLORS.textSecondary }}>
          {isZh ? '未找到卦象数据。' : 'No divination data found.'}
        </Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 20 }}>
          <Text style={{ color: COLORS.gold }}>{t('navNewCast')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { data: hexData } = original;
  const auspRating = hexData.auspiciousness?.rating ?? 0;

  // ── Field helpers (memoised; re-evaluate when isZh changes) ───────────────

  /** Hexagram name — large display character */
  const displayName = pick(hexData.name, 'chinese', 'english');

  /** Subtitle beneath name — pinyin in both modes (universal) */
  const displaySubtitle = hexData.name.pinyin;

  /** Third line of name block */
  const displayNameSub = isZh
    ? hexData.name.english          // show English transliteration under Chinese
    : hexData.name.romanized;       // show romanized under English

  /** Judgment section
   *  - Primary (hero):  judgment.chinese  (zh) | judgment.translation (en)
   *  - Body (interp):   judgment.summary_zh    | judgment.summary
   *    Fallback: if summary_zh is absent/empty, English summary is used.
   *    This lets JSON be populated incrementally with no blank gaps.
   */
  const judgmentPrimary = pick(hexData.judgment, 'chinese', 'translation');
  const judgmentBody    = isZh
    ? (hexData.judgment.summary_zh || hexData.judgment.summary || '')
    : (hexData.judgment.summary || '');

  /** Image section
   *  - Primary (hero):  image.chinese         (zh) | image.translation (en)
   *  - Body (interp):   image.interpretation_zh    | image.interpretation
   */
  const imagePrimary = pick(hexData.image, 'chinese', 'translation');
  const imageBody    = isZh
    ? (hexData.image.interpretation_zh || hexData.image.interpretation || '')
    : (hexData.image.interpretation || '');

  /** Trigram display */
  const trigramUpperName = pick(hexData.trigrams?.upper, 'chinese', 'name');
  const trigramLowerName = pick(hexData.trigrams?.lower, 'chinese', 'name');

  /** Auspiciousness label */
  const auspLabel = isZh
    ? hexData.auspiciousness?.chinese
    : `${hexData.auspiciousness?.chinese} · ${hexData.auspiciousness?.label}`;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <View style={styles.navbar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.navBack}>
          <Text style={styles.navBackText}>{t('navNewCast')}</Text>
        </TouchableOpacity>

        {/* ── Language toggle lives in the result nav bar ─────────────────── */}
        <LanguageToggle size="sm" />

        <TouchableOpacity onPress={handleShare}>
          <Text style={styles.navShare}>{t('navShare')}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Scroll content ─────────────────────────────────────────────────── */}
      <Animated.ScrollView
        style={{ opacity: scrollFade }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Question banner — shown when a question was set ───────────────── */}
        {!!question && (
          <View style={styles.questionBanner}>
            <Text style={styles.questionBannerLabel}>
              {isZh ? '所问之事' : 'YOUR QUESTION'}
            </Text>
            <Text style={styles.questionBannerText} numberOfLines={2}>
              {question}
            </Text>
          </View>
        )}
        {/* ── Hero header ──────────────────────────────────────────────────── */}
        <Animated.View
          style={[styles.scrollHeader, { transform: [{ translateY: headerSlide }] }]}
        >
          <Text style={styles.hexNumber}>卦 {original.number}</Text>

          {/* Primary name — large Chinese character or English title */}
          <Text style={styles.hexNamePrimary}>{displayName}</Text>

          {/* Pinyin — always shown, universally legible */}
          <Text style={styles.hexNamePinyin}>{displaySubtitle}</Text>

          {/* Sub-label: English under Chinese, romanised under English */}
          <Text style={styles.hexNameSub}>{displayNameSub}</Text>

          <Text style={styles.hexSymbol}>{hexData.symbol}</Text>

          <View style={styles.headerDivider} />

          <AuspiciousnessStars rating={auspRating} />
          <Text style={styles.auspLabel}>{auspLabel}</Text>
        </Animated.View>

        {/* ── Hexagram visual ──────────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.hexVisualRow}>

            {/* Original */}
            <View style={styles.hexBlock}>
              <Text style={styles.hexBlockLabel}>{t('hexOriginalLabel')}</Text>
              <HexagramVisual
                polarities={original.polarities}
                changingIndices={result.changingLineIndices}
              />
              <Text style={styles.hexBlockName}>
                {hexData.name.chinese}
              </Text>
            </View>

            {/* Transformed (if changing lines exist) */}
            {hasChanging && transformed?.data && (
              <>
                <View style={styles.hexArrow}>
                  <Text style={styles.hexArrowText}>→</Text>
                </View>
                <View style={styles.hexBlock}>
                  <Text style={styles.hexBlockLabel}>{t('hexTransLabel')}</Text>
                  <HexagramVisual polarities={transformed.polarities} changingIndices={[]} />
                  <Text style={styles.hexBlockName}>
                    {transformed.data.name.chinese}
                  </Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* ── Trigrams ─────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.trigramRow}>
            <View style={styles.trigramBlock}>
              <Text style={styles.trigramSymbol}>{hexData.trigrams?.upper?.symbol}</Text>
              <Text style={styles.trigramName}>{trigramUpperName}</Text>
              <Text style={styles.trigramPos}>{t('hexUpperTrigram')}</Text>
            </View>
            <Text style={styles.trigramSep}>⊕</Text>
            <View style={styles.trigramBlock}>
              <Text style={styles.trigramSymbol}>{hexData.trigrams?.lower?.symbol}</Text>
              <Text style={styles.trigramName}>{trigramLowerName}</Text>
              <Text style={styles.trigramPos}>{t('hexLowerTrigram')}</Text>
            </View>
          </View>
        </View>

        {/* ── Judgment 卦辞 ─────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('sectionJudgment')}</Text>
          <View style={styles.card}>
            {isZh ? (
              /**
               * CHINESE MODE — three-tier hierarchy:
               *   Tier 1 (hero):    judgment.chinese   — Classical text, BIG & GOLD
               *   Tier 2 (ref):     judgment.translation — English translation, italic
               *   Tier 3 (interp):  judgment.summary   — Modern interpretation, body
               *
               * The Classical Chinese text is the primary content; everything else
               * is supporting context. This mirrors how a Chinese scholar would
               * read the hexagram — classical text first, then commentary.
               */
              <>
                {/* ── Tier 1: Classical Chinese — the hero ─────────────────── */}
                <Text style={styles.judgmentChineseHero}>
                  {hexData.judgment.chinese}
                </Text>

                <View style={styles.judgmentDivider} />

                {/* ── Tier 2: English translation — reference line ──────────── */}
                {!!hexData.judgment.translation && (
                  <Text style={styles.judgmentEnglishRef}>
                    {hexData.judgment.translation}
                  </Text>
                )}

                {/* ── Tier 3: Modern interpretation paragraph ───────────────── */}
                {/* judgmentBody = isZh ? (summary_zh || summary) : summary     */}
                {!!judgmentBody && (
                  <>
                    <View style={styles.judgmentDivider} />
                    <Text style={styles.judgmentInterpLabel}>现代解析</Text>
                    <Text style={styles.judgmentSummary}>
                      {judgmentBody}
                    </Text>
                  </>
                )}
              </>
            ) : (
              /**
               * ENGLISH MODE — two-tier hierarchy:
               *   Tier 1 (hero):  judgment.translation — English translation, GOLD
               *   Tier 2 (body):  judgment.summary     — Modern interpretation
               */
              <>
                {/* ── Tier 1: English translation — the hero ───────────────── */}
                <Text style={styles.judgmentPrimary}>
                  {hexData.judgment.translation}
                </Text>

                <View style={styles.judgmentDivider} />

                {/* ── Tier 2: Interpretation paragraph ─────────────────────── */}
                <Text style={styles.judgmentSummary}>
                  {hexData.judgment.summary}
                </Text>
              </>
            )}
          </View>
        </View>

        {/* ── Image 象 ─────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('sectionImage')}</Text>
          <View style={styles.card}>
            {isZh ? (
              /**
               * CHINESE MODE — three-tier hierarchy:
               *   Tier 1 (hero):   image.chinese         — Classical text, BIG & GOLD
               *   Tier 2 (ref):    image.translation     — English translation, italic
               *   Tier 3 (interp): image.interpretation  — Modern interpretation, body
               */
              <>
                {/* ── Tier 1: Classical Chinese — the hero ─────────────────── */}
                <Text style={styles.imageChineseHero}>
                  {hexData.image.chinese}
                </Text>

                <View style={styles.judgmentDivider} />

                {/* ── Tier 2: English translation — reference line ──────────── */}
                {!!hexData.image.translation && (
                  <Text style={styles.judgmentEnglishRef}>
                    {hexData.image.translation}
                  </Text>
                )}

                {/* ── Tier 3: Modern interpretation paragraph ───────────────── */}
                {/* imageBody = isZh ? (interpretation_zh || interpretation) : interpretation */}
                {!!imageBody && (
                  <>
                    <View style={styles.judgmentDivider} />
                    <Text style={styles.judgmentInterpLabel}>现代解析</Text>
                    <Text style={styles.imageInterp}>
                      {imageBody}
                    </Text>
                  </>
                )}
              </>
            ) : (
              /**
               * ENGLISH MODE — two-tier hierarchy:
               *   Tier 1 (hero):  image.translation    — English text, GOLD
               *   Tier 2 (body):  image.interpretation — Modern interpretation
               */
              <>
                {/* ── Tier 1: English image text — the hero ────────────────── */}
                <Text style={styles.imagePrimary}>
                  {hexData.image.translation}
                </Text>

                <View style={styles.judgmentDivider} />

                {/* ── Tier 2: Interpretation paragraph ─────────────────────── */}
                <Text style={styles.imageInterp}>
                  {hexData.image.interpretation}
                </Text>
              </>
            )}
          </View>
        </View>

        {/* ── Changing Lines 变爻 ───────────────────────────────────────────── */}
        {hasChanging && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('sectionChanging')}</Text>

            {isPremium ? (
              result.changingLineIndices.map(idx => {
                const lineData = hexData.lines?.[idx];
                const lineDesc = describeLineValue(result.lineValues[idx]);

                // Language-aware line label
                const lineLabel = tf('changingLineLabel', {
                  n:       idx + 1,
                  label:   lineDesc?.label ?? '',
                  chinese: lineDesc?.chinese ?? '',
                });

                // Language-aware line text fields
                // pick() handles primary (chinese vs translation).
                // lineBody uses interpretation_zh with English fallback.
                const linePrimary = pick(lineData, 'chinese', 'translation');
                const lineBody    = isZh
                  ? (lineData?.interpretation_zh || lineData?.interpretation || '')
                  : (lineData?.interpretation || '');

                return (
                  <View key={idx} style={[styles.card, styles.changingCard]}>
                    <View style={styles.changingCardHeader}>
                      <Text style={styles.changingLineLabel}>{lineLabel}</Text>
                      <Text style={styles.changingSymbol}>{lineDesc?.symbol}</Text>
                    </View>

                    {/* Primary: Chinese text (zh) or English translation (en) */}
                    <Text style={styles.changingPrimary}>{linePrimary}</Text>

                    {/* In Chinese mode show English translation underneath */}
                    {isZh && lineData?.translation && (
                      <Text style={styles.changingSecondary}>{lineData.translation}</Text>
                    )}

                    {/* Interpretation — analytical paragraph */}
                    <Text style={styles.changingInterp}>{lineBody}</Text>
                  </View>
                );
              })
            ) : (
              /* ── Locked changing lines — teaser card ─────────────────────
               * Shows the LINE POSITIONS so the user knows something specific
               * is there, but gates the actual interpretation behind premium.
               * The visual weight ("X changing lines detected") creates urgency.
               */
              <View style={styles.changingLockedCard}>
                {/* Position indicators — one pill per changing line */}
                <View style={styles.changingLockedPills}>
                  {result.changingLineIndices.map(idx => {
                    const lineDesc = describeLineValue(result.lineValues[idx]);
                    return (
                      <View key={idx} style={styles.changingLockedPill}>
                        <Text style={styles.changingLockedPillNum}>
                          {isZh ? `第${idx + 1}爻` : `Line ${idx + 1}`}
                        </Text>
                        <Text style={styles.changingLockedPillSym}>
                          {lineDesc?.symbol}
                        </Text>
                        <Text style={styles.changingLockedPillType}>
                          {isZh ? lineDesc?.chinese : lineDesc?.label}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                {/* Count headline */}
                <Text style={styles.changingLockedTitle}>
                  {isZh
                    ? `${result.changingLineIndices.length} 条变爻影响此卦走势`
                    : `${result.changingLineIndices.length} changing line${result.changingLineIndices.length !== 1 ? 's' : ''} shape this reading`}
                </Text>

                {/* What premium unlocks */}
                <Text style={styles.changingLockedBody}>
                  {isZh
                    ? '变爻是此卦的灵魂——它揭示了当下局势的演变方向，以及最终形成的变卦（变卦）。高级版将逐一解读每条变爻的含义与行动指引。'
                    : 'Changing lines are the soul of this cast — they reveal how the situation is transforming and which hexagram it becomes. Premium unlocks the full interpretation of each changing line and the transformed hexagram.'}
                </Text>

                {/* Upgrade CTA — inline, lightweight */}
                <TouchableOpacity
                  style={styles.changingLockedCTA}
                  onPress={handleUpgrade}
                  activeOpacity={0.88}
                >
                  <Text style={styles.changingLockedCTAText}>
                    {isZh ? '解锁变爻解析 →' : 'Unlock Changing Lines →'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* ── Transformed Hexagram 变卦 (Premium) ─────────────────────────── */}
        {hasChanging && transformed?.data && isPremium && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('sectionTransformed')}</Text>
            <View style={[styles.card, styles.transformedCard]}>
              <Text style={styles.transformedNumber}>
                {isZh ? `第 ${transformed.number} 卦` : `Hexagram ${transformed.number}`}
              </Text>
              <Text style={styles.transformedNamePrimary}>
                {pick(transformed.data.name, 'chinese', 'english')}
              </Text>
              <Text style={styles.transformedNameSub}>
                {transformed.data.name.pinyin}
              </Text>
              <View style={styles.judgmentDivider} />
              {/* Body: summary_zh when zh mode, with English fallback */}
              <Text style={styles.judgmentSummary}>
                {isZh
                  ? (transformed.data.judgment?.summary_zh || transformed.data.judgment?.summary || '')
                  : (transformed.data.judgment?.summary || '')}
              </Text>
            </View>
          </View>
        )}

        {/* ── Ask the Oracle ───────────────────────────────────────────────── */}
        {/* Sits above the premium gate deliberately: the free tier includes a
            few questions a day, so burying it under the paywall would hide the
            one part of this screen a non-paying user can act on. */}
        <AskOracleSection result={result} onUpgrade={handleUpgrade} />

        {/* ── Life Categories (Premium) ─────────────────────────────────────── */}
        {isPremium ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('sectionCategories')}</Text>
            {CATEGORY_CONFIG.map(c => (
              <CategoryCard
                key={c.key}
                categoryKey={c.key}
                premiumData={hexData.premium?.[c.key]}
              />
            ))}
          </View>
        ) : (
          <View style={styles.section}>
            <PremiumGateCTA hexData={hexData} onUpgrade={handleUpgrade} />
          </View>
        )}

        {/* ── Classical Reference ───────────────────────────────────────────── */}
        {hexData.classical_reference && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('sectionClassical')}</Text>
            <View style={styles.card}>
              {/* sequence_reasoning: _zh variant preferred in zh mode */}
              <Text style={styles.classicalText}>
                {isZh
                  ? (hexData.classical_reference.sequence_reasoning_zh
                      || hexData.classical_reference.sequence_reasoning)
                  : hexData.classical_reference.sequence_reasoning}
              </Text>
              {hexData.classical_reference.historical_note && (
                <>
                  <View style={styles.judgmentDivider} />
                  {/* historical_note: _zh variant preferred in zh mode */}
                  <Text style={styles.classicalNote}>
                    {isZh
                      ? (hexData.classical_reference.historical_note_zh
                          || hexData.classical_reference.historical_note)
                      : hexData.classical_reference.historical_note}
                  </Text>
                </>
              )}
            </View>
          </View>
        )}

        {/* ── Disclaimer footer ─────────────────────────────────────────────── */}
        <View style={styles.disclaimerBar}>
          <Text style={styles.disclaimerText}>{t('disclaimerFooter')}</Text>
        </View>

      </Animated.ScrollView>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  // ── Navbar
  navbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingBottom: 12,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.goldDim,
    backgroundColor: COLORS.background,
  },
  navBack:     { padding: 4 },
  navBackText: { fontFamily: FONTS.caption, fontSize: 13, color: COLORS.gold, letterSpacing: 0.5 },
  navShare:    { fontFamily: FONTS.caption, fontSize: 13, color: COLORS.goldMuted, letterSpacing: 0.5 },

  // ── Scroll
  scrollContent: { paddingHorizontal: SPACING.lg, paddingBottom: 60 },

  // ── Question banner — appears at top of scroll when a question was set.
  // Left gold bar gives visual weight; centered text feels like a scroll
  // epigraph. Single definition — the previous file had three copies.
  questionBanner: {
    marginTop: SPACING.lg,
    marginBottom: SPACING.xs,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    backgroundColor: 'rgba(212,175,55,0.07)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.goldDim,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.gold,
    alignItems: 'center',
  },
  questionBannerLabel: {
    fontFamily: FONTS.caption,
    fontSize: 9,
    color: COLORS.goldMuted,
    letterSpacing: 3,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  questionBannerText: {
    fontFamily: FONTS.bodyItalic,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0.4,
    textAlign: 'center',
    lineHeight: 22,
  },

  scrollHeader: {
    alignItems: 'center',
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.lg,
  },
  hexNumber:       { fontFamily: FONTS.caption, fontSize: 11, color: COLORS.goldDim, letterSpacing: 3, marginBottom: 4 },

  // Primary name — big, always gold, no language-specific sizing
  hexNamePrimary:  { fontFamily: FONTS.display, fontSize: 64, color: COLORS.gold, lineHeight: 76, letterSpacing: 8, textAlign: 'center' },

  // Pinyin — universal
  hexNamePinyin:   { fontFamily: FONTS.bodyItalic, fontSize: 18, color: COLORS.goldMuted, letterSpacing: 2, marginTop: -4 },

  // Sub name (English below Chinese, or romanised below English)
  hexNameSub:      { fontFamily: FONTS.caption, fontSize: 11, color: COLORS.textSecondary, letterSpacing: 3, marginTop: 2 },

  hexSymbol:       { fontSize: 36, marginTop: SPACING.sm, color: COLORS.goldMuted },
  headerDivider:   { width: 60, height: 1, backgroundColor: COLORS.goldDim, marginVertical: SPACING.md, opacity: 0.4 },
  starsRow:        { flexDirection: 'row', marginBottom: 4 },
  star:            { fontSize: 12, color: COLORS.surfaceDim, marginHorizontal: 2 },
  starActive:      { color: COLORS.gold },
  auspLabel:       { fontFamily: FONTS.caption, fontSize: 10, color: COLORS.goldMuted, letterSpacing: 2, marginTop: 4, textAlign: 'center' },

  // ── Sections
  section:      { marginBottom: SPACING.lg },
  sectionTitle: {
    fontFamily: FONTS.caption, fontSize: 10, color: COLORS.goldMuted,
    letterSpacing: 4, marginBottom: SPACING.sm, textTransform: 'uppercase',
  },

  // ── Cards
  card: {
    backgroundColor: COLORS.surface, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.goldDim,
    padding: SPACING.lg, marginBottom: SPACING.sm,
  },

  // ── Hex visual
  hexVisualRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  hexBlock:     { alignItems: 'center' },
  hexBlockLabel:{ fontFamily: FONTS.caption, fontSize: 9, color: COLORS.goldDim, letterSpacing: 2, marginBottom: 8 },
  hexBlockName: { fontFamily: FONTS.caption, fontSize: 10, color: COLORS.goldMuted, marginTop: 8, letterSpacing: 1 },
  hexArrow:     { marginHorizontal: SPACING.lg },
  hexArrowText: { color: COLORS.goldDim, fontSize: 18 },
  hexVisual:    { paddingHorizontal: SPACING.md },
  hexLineRow:   { marginVertical: 3, width: 80 },
  hexLineFull:  { height: 6, borderRadius: 3, backgroundColor: COLORS.gold, width: '100%' },
  hexBrokenRow: { flexDirection: 'row', alignItems: 'center' },
  hexLineHalf:  { height: 6, borderRadius: 3, backgroundColor: COLORS.gold, flex: 1 },
  hexLineGap:   { width: 12 },
  hexLineChanging: { backgroundColor: COLORS.changing },

  // ── Trigrams
  trigramRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    backgroundColor: COLORS.surface, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.goldDim, padding: SPACING.lg,
  },
  trigramBlock:  { alignItems: 'center', flex: 1 },
  trigramSymbol: { fontSize: 28, color: COLORS.gold, marginBottom: 4 },
  trigramName:   { fontFamily: FONTS.display, fontSize: 15, color: COLORS.text, marginBottom: 2 },
  trigramPos:    { fontFamily: FONTS.caption, fontSize: 9, color: COLORS.textSecondary, marginTop: 2, letterSpacing: 1 },
  trigramSep:    { fontSize: 20, color: COLORS.goldDim, marginHorizontal: SPACING.md },

  // ── Judgment
  //
  // zh mode hero: Classical Chinese text — larger, display font, more letter-
  // spacing. Chinese glyphs are square; more spacing reads better than tighter.
  judgmentChineseHero: {
    fontFamily: FONTS.display,
    fontSize: 22,
    color: COLORS.gold,
    letterSpacing: 4,
    lineHeight: 38,
    marginBottom: SPACING.sm,
  },
  // en mode hero: English translation — same role, different language weight
  judgmentPrimary:  { fontFamily: FONTS.display, fontSize: 15, color: COLORS.gold, letterSpacing: 1.5, marginBottom: SPACING.sm, lineHeight: 26 },
  // Reference line: English translation shown below Classical Chinese in zh mode
  judgmentEnglishRef: {
    fontFamily: FONTS.bodyItalic,
    fontSize: 13,
    color: COLORS.goldMuted,
    lineHeight: 22,
    marginBottom: SPACING.xs,
    opacity: 0.85,
  },
  // Legacy — kept for changing-lines cards (line.translation shown as secondary)
  judgmentSecondary:{ fontFamily: FONTS.bodyItalic, fontSize: 13, color: COLORS.goldMuted, lineHeight: 22, marginBottom: SPACING.sm },
  judgmentDivider:  { height: 1, backgroundColor: COLORS.goldDim, opacity: 0.3, marginVertical: SPACING.sm },
  judgmentSummary:  { fontFamily: FONTS.body, fontSize: 14, color: COLORS.textSecondary, lineHeight: 22 },
  // Micro-label above the interpretation paragraph (zh mode only: "现代解析")
  judgmentInterpLabel: {
    fontFamily: FONTS.caption,
    fontSize: 9,
    color: COLORS.goldDim,
    letterSpacing: 3,
    marginBottom: SPACING.xs,
    textTransform: 'uppercase',
  },

  // ── Image
  //
  // zh mode hero: Classical image verse — same prominence treatment as judgment
  imageChineseHero: {
    fontFamily: FONTS.display,
    fontSize: 17,
    color: COLORS.gold,
    letterSpacing: 3,
    lineHeight: 32,
    marginBottom: SPACING.sm,
  },
  // en mode hero: English image text
  imagePrimary:  { fontFamily: FONTS.display, fontSize: 13, color: COLORS.gold, letterSpacing: 1.5, marginBottom: SPACING.sm, lineHeight: 24 },
  imageSecondary:{ fontFamily: FONTS.bodyItalic, fontSize: 13, color: COLORS.goldMuted, lineHeight: 21, marginBottom: SPACING.sm },
  imageInterp:   { fontFamily: FONTS.body, fontSize: 14, color: COLORS.textSecondary, lineHeight: 22 },

  // ── Changing lines
  changingCard: {
    borderColor: COLORS.changing + '44',
    borderLeftWidth: 3, borderLeftColor: COLORS.changing,
  },
  changingCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  changingLineLabel:  { fontFamily: FONTS.caption, fontSize: 10, color: COLORS.changing, letterSpacing: 1.5, flex: 1 },
  changingSymbol:     { fontFamily: FONTS.display, fontSize: 20, color: COLORS.changing },
  changingPrimary:    { fontFamily: FONTS.display, fontSize: 13, color: COLORS.gold, letterSpacing: 1, marginBottom: SPACING.xs, lineHeight: 22 },
  changingSecondary:  { fontFamily: FONTS.bodyItalic, fontSize: 12, color: COLORS.goldMuted, lineHeight: 20, marginBottom: SPACING.xs },
  changingInterp:     { fontFamily: FONTS.body, fontSize: 13, color: COLORS.textSecondary, lineHeight: 21 },
  lockedText:         { fontFamily: FONTS.body, fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22, opacity: 0.7 },

  // ── Transformed
  transformedCard:      { borderColor: COLORS.accent + '44' },
  transformedNumber:    { fontFamily: FONTS.caption, fontSize: 10, color: COLORS.goldDim, letterSpacing: 3, marginBottom: 4 },
  transformedNamePrimary:{ fontFamily: FONTS.display, fontSize: 36, color: COLORS.gold, letterSpacing: 6 },
  transformedNameSub:   { fontFamily: FONTS.caption, fontSize: 11, color: COLORS.textSecondary, letterSpacing: 3, marginBottom: 4 },

  // ── Category cards
  categoryCard: {
    backgroundColor: COLORS.surface, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.goldDim,
    padding: SPACING.md, marginBottom: SPACING.sm,
  },
  categoryHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  categoryLeft:         { flexDirection: 'row', alignItems: 'center' },
  categoryIcon:         { fontSize: 18, color: COLORS.goldMuted, marginRight: SPACING.sm, width: 24, textAlign: 'center' },
  categoryLabel:        { fontFamily: FONTS.body, fontSize: 14, color: COLORS.text },
  categoryChinese:      { fontFamily: FONTS.display, fontSize: 11, color: COLORS.goldDim, letterSpacing: 2 },
  categoryRight:        { alignItems: 'flex-end' },
  expandChevron:        { fontFamily: FONTS.caption, fontSize: 9, color: COLORS.goldDim, marginTop: 4 },
  categoryBody:         { marginTop: SPACING.md, paddingTop: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.goldDim + '44' },
  categoryAuspRow:      { flexDirection: 'row', alignItems: 'baseline', marginBottom: SPACING.sm, flexWrap: 'wrap' },
  categoryAuspChinese:  { fontFamily: FONTS.display, fontSize: 16, color: COLORS.gold, marginRight: SPACING.sm },
  categoryAuspEnglish:  { fontFamily: FONTS.caption, fontSize: 10, color: COLORS.goldMuted, letterSpacing: 1 },
  categoryReading:      { fontFamily: FONTS.body, fontSize: 13, color: COLORS.textSecondary, lineHeight: 21, marginBottom: SPACING.md },
  adviceBlock:          { marginBottom: SPACING.sm },
  adviceTitle:          { fontFamily: FONTS.caption, fontSize: 9, color: COLORS.goldDim, letterSpacing: 2, marginBottom: SPACING.xs },
  adviceRow:            { flexDirection: 'row', marginBottom: 4 },
  adviceDot:            { color: COLORS.goldMuted, marginRight: 8, fontFamily: FONTS.body },
  adviceText:           { fontFamily: FONTS.body, fontSize: 12, color: COLORS.textSecondary, flex: 1, lineHeight: 19 },
  cautionBlock:         { backgroundColor: 'rgba(255,180,50,0.06)', borderRadius: 8, padding: SPACING.sm, marginTop: SPACING.xs },
  cautionLabel:         { fontFamily: FONTS.caption, fontSize: 9, color: COLORS.changing, letterSpacing: 2, marginBottom: 4 },
  cautionText:          { fontFamily: FONTS.body, fontSize: 12, color: COLORS.textSecondary, lineHeight: 19, fontStyle: 'italic' },

  // ── Premium fallback badge
  fallbackBadge: {
    backgroundColor: 'rgba(212,175,55,0.08)',
    borderRadius: 6, borderWidth: 1, borderColor: COLORS.goldDim,
    paddingHorizontal: SPACING.sm, paddingVertical: 4,
    alignSelf: 'flex-start', marginBottom: SPACING.sm,
  },
  fallbackText: { fontFamily: FONTS.caption, fontSize: 9, color: COLORS.goldDim, letterSpacing: 0.5 },

  // ── PremiumGateCTA ────────────────────────────────────────────────────────
  //
  // Replaces the old generic "paywall" block. Context-aware: shows the
  // hexagram's name in the headline, category icons as locked pills, a
  // value-strip stat row, and a gold gradient CTA.

  premiumGate: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.gold + '55',
    padding: SPACING.xl,
    alignItems: 'center',
    overflow: 'hidden',
  },
  premiumGateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  premiumGateIcon:  { fontSize: 18, color: COLORS.gold, marginRight: SPACING.sm },
  premiumGateTitle: {
    fontFamily: FONTS.caption, fontSize: 10,
    color: COLORS.goldMuted, letterSpacing: 4,
  },
  premiumGateHeadline: {
    fontFamily: FONTS.display,
    fontSize: 17,
    color: COLORS.gold,
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: SPACING.sm,
    lineHeight: 26,
  },
  premiumGateBody: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: SPACING.lg,
  },

  // Category preview pills — 6 locked icons arranged in a wrapping row
  premiumGatePills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
    width: '100%',
  },
  premiumGatePill: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.goldDim,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    minWidth: 88,
    position: 'relative',
  },
  premiumGatePillIcon:  { fontSize: 16, color: COLORS.goldDim, marginBottom: 3 },
  premiumGatePillLabel: {
    fontFamily: FONTS.caption, fontSize: 10,
    color: COLORS.textSecondary, letterSpacing: 0.5,
    marginBottom: 4,
  },
  premiumGatePillStars: { flexDirection: 'row' },
  premiumGatePillStar:  { fontSize: 7, color: COLORS.surfaceDim, marginHorizontal: 0.5 },
  premiumGateLockDot: {
    position: 'absolute', top: 4, right: 4,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: COLORS.background,
    alignItems: 'center', justifyContent: 'center',
  },
  premiumGateLockIcon: { fontSize: 8 },

  // Three-stat value strip (6 categories / 64 hexagrams / ∞ history)
  premiumGateValueRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: COLORS.goldDim + '44',
    paddingTop: SPACING.md,
    marginBottom: SPACING.lg,
    width: '100%',
  },
  premiumGateValueItem:  { flex: 1, alignItems: 'center' },
  premiumGateValueNum:   {
    fontFamily: FONTS.display, fontSize: 22,
    color: COLORS.gold, letterSpacing: 1,
  },
  premiumGateValueLabel: {
    fontFamily: FONTS.caption, fontSize: 9,
    color: COLORS.textSecondary, letterSpacing: 0.5,
    marginTop: 2, textAlign: 'center',
  },

  // Gold gradient CTA button
  premiumGateCTA:         { width: '100%', borderRadius: 12, overflow: 'hidden', marginBottom: SPACING.sm },
  premiumGateCTAGradient: { paddingVertical: 16, alignItems: 'center' },
  premiumGateCTAText: {
    fontFamily: FONTS.caption, fontSize: 15,
    color: '#000', letterSpacing: 1.5, fontWeight: '700',
  },
  premiumGateCTASub: {
    fontFamily: FONTS.caption, fontSize: 9,
    color: '#000', letterSpacing: 1, opacity: 0.65, marginTop: 2,
  },
  premiumGateNote: {
    fontFamily: FONTS.caption, fontSize: 9,
    color: COLORS.textSecondary, letterSpacing: 0.5, opacity: 0.6,
  },

  // ── Locked changing lines teaser card ─────────────────────────────────────
  //
  // Replaces the old bare-text "lockedText" approach.
  // Shows line position pills (Line 2 ×, Line 5 o) as a teaser — enough
  // to make the cast feel specific without revealing any interpretation.

  changingLockedCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.changing + '44',
    borderLeftWidth: 3,
    borderLeftColor: COLORS.changing,
    padding: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  changingLockedPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  changingLockedPill: {
    alignItems: 'center',
    backgroundColor: COLORS.changing + '12',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.changing + '44',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    minWidth: 64,
  },
  changingLockedPillNum:  {
    fontFamily: FONTS.caption, fontSize: 9,
    color: COLORS.changing, letterSpacing: 1,
  },
  changingLockedPillSym:  {
    fontFamily: FONTS.display, fontSize: 18,
    color: COLORS.changing, lineHeight: 24,
  },
  changingLockedPillType: {
    fontFamily: FONTS.caption, fontSize: 8,
    color: COLORS.textSecondary, letterSpacing: 0.5, marginTop: 1,
  },
  changingLockedTitle: {
    fontFamily: FONTS.display, fontSize: 15,
    color: COLORS.changing, letterSpacing: 1,
    marginBottom: SPACING.sm,
  },
  changingLockedBody: {
    fontFamily: FONTS.body, fontSize: 13,
    color: COLORS.textSecondary, lineHeight: 20,
    marginBottom: SPACING.md,
  },
  changingLockedCTA: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: COLORS.changing,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.changing + '10',
  },
  changingLockedCTAText: {
    fontFamily: FONTS.caption, fontSize: 12,
    color: COLORS.changing, letterSpacing: 0.5,
  },

  // ── Classical
  classicalText: { fontFamily: FONTS.bodyItalic, fontSize: 13, color: COLORS.textSecondary, lineHeight: 21 },
  classicalNote: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.textSecondary, lineHeight: 20, opacity: 0.75 },

  // ── Disclaimer
  disclaimerBar:  { paddingVertical: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.goldDim + '22', marginTop: SPACING.md },
  disclaimerText: { fontFamily: FONTS.caption, fontSize: 9, color: COLORS.textSecondary, textAlign: 'center', letterSpacing: 1, opacity: 0.5, lineHeight: 14 },
});
