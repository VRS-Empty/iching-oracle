/**
 * screens/UpgradeScreen.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Premium upgrade / paywall screen.
 *
 * Responsibilities:
 *   • Present the premium feature list in an aspirational but honest way
 *   • Trigger the IAP purchase flow via usePremium().unlock()
 *   • Trigger restore-purchase flow via usePremium().restore()
 *   • Reflect the current premium state (if already unlocked, show confirmation)
 *   • Fully bilingual via useText()
 *
 * When real IAP is connected (see hooks/usePremium.js TODO blocks), this
 * screen requires no changes — the hook handles the purchase logic.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, {
  useRef, useEffect, useCallback, useState,
} from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Animated,
  StyleSheet, Platform, ActivityIndicator, Alert,
  TextInput, KeyboardAvoidingView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';

import { usePremium } from '../hooks/usePremium';
import { useText } from '../context/LanguageContext';
import LanguageToggle from '../components/LanguageToggle';
import { COLORS, FONTS, SPACING } from '../constants/theme';

// ─── Feature list ─────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: '变',
    labelZh: '变卦解析',
    labelEn: 'Transformed Hexagram (变卦)',
    descZh: '查看变卦及其完整解读',
    descEn: 'Full interpretation of changing lines & transformed hexagram',
  },
  {
    icon: '⚔',
    labelZh: '事业指引',
    labelEn: 'Career & Business',
    descZh: '专属事业与商业运势分析',
    descEn: 'Dedicated readings for career and business decisions',
  },
  {
    icon: '♥',
    labelZh: '感情洞见',
    labelEn: 'Romance & Health',
    descZh: '感情与健康的深度洞察',
    descEn: 'Deep insights for relationships and wellbeing',
  },
  {
    icon: '◈',
    labelZh: '决策神谕',
    labelEn: 'Decision Oracle',
    descZh: '为重大决策提供精准指引',
    descEn: 'Precise oracle guidance for important decisions',
  },
  {
    icon: '◉',
    labelZh: '出行吉凶',
    labelEn: 'Travel Auspiciousness',
    descZh: '旅行与出行的吉凶预测',
    descEn: 'Auspiciousness forecast for travel and journeys',
  },
  {
    icon: '📜',
    labelZh: '无限历史记录',
    labelEn: 'Unlimited History',
    descZh: '查看全部占卦历史，永久保存',
    descEn: 'Access all past divinations, saved permanently',
  },
];

// ─── FeatureRow ───────────────────────────────────────────────────────────────

function FeatureRow({ feature, isZh, index }) {
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 350, delay: 200 + index * 70, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 90, friction: 12, delay: 200 + index * 70, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.featureRow, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.featureIconBox}>
        <Text style={styles.featureIcon}>{feature.icon}</Text>
      </View>
      <View style={styles.featureText}>
        <Text style={styles.featureLabel}>
          {isZh ? feature.labelZh : feature.labelEn}
        </Text>
        <Text style={styles.featureDesc}>
          {isZh ? feature.descZh : feature.descEn}
        </Text>
      </View>
      <Text style={styles.featureCheck}>✓</Text>
    </Animated.View>
  );
}

// ─── AlreadyUnlocked state ────────────────────────────────────────────────────

function AlreadyUnlocked({ isZh, onBack }) {
  const scaleAnim = useRef(new Animated.Value(0.7)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, tension: 80, friction: 8, useNativeDriver: true }),
      Animated.timing(fadeAnim,  { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={styles.unlockedContainer}>
      <Animated.View style={{ opacity: fadeAnim, transform: [{ scale: scaleAnim }] }}>
        <View style={styles.unlockedBadge}>
          <Text style={styles.unlockedBadgeIcon}>✦</Text>
        </View>
        <Text style={styles.unlockedTitle}>
          {isZh ? '高级版已解锁' : 'Premium Unlocked'}
        </Text>
        <Text style={styles.unlockedBody}>
          {isZh
            ? '您已解锁全部高级功能。\n享受完整的易鉴占卜体验。'
            : 'You have access to all premium features.\nEnjoy the full I-Ching Oracle experience.'}
        </Text>
        <TouchableOpacity style={styles.unlockedBackButton} onPress={onBack}>
          <Text style={styles.unlockedBackText}>
            {isZh ? '返回占卜' : 'Return to Oracle'}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ─── PromoCodeSection ────────────────────────────────────────────────────────
//
// Self-contained sub-component that owns the promo-code TextInput state.
// Keeping local state here means the parent UpgradeScreen never re-renders
// as the user types, and the input field is automatically cleared when the
// section unmounts (i.e. after a successful unlock).
//
// Placement: below the Restore Purchase button, always visible to free users,
// automatically hidden by the parent when isPremium is true.

function PromoCodeSection({ isZh, onRedeem, isRedeeming }) {
  const [code,        setCode]        = useState('');
  const [isFocused,   setIsFocused]   = useState(false);

  const canRedeem = code.trim().length > 0 && !isRedeeming;

  return (
    <View style={styles.promoSection}>

      {/* ── Divider with centred label ──────────────────────────────────── */}
      <View style={styles.promoDividerRow}>
        <View style={styles.promoDividerLine} />
        <Text style={styles.promoDividerLabel}>
          {isZh ? '兑换码' : 'PROMO CODE'}
        </Text>
        <View style={styles.promoDividerLine} />
      </View>

      {/* ── Input + Redeem button ────────────────────────────────────────── */}
      <View style={styles.promoInputRow}>
        <TextInput
          style={[
            styles.promoInput,
            isFocused && styles.promoInputFocused,
          ]}
          value={code}
          onChangeText={setCode}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={isZh ? '输入兑换码' : 'Enter Promo Code'}
          placeholderTextColor={COLORS.textDim}
          // Uppercase hint — codes are all-caps; saves the user a tap on iOS
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="done"
          editable={!isRedeeming}
          onSubmitEditing={() => canRedeem && onRedeem(code)}
          accessibilityLabel={isZh ? '兑换码输入框' : 'Promo code input'}
        />

        <TouchableOpacity
          style={[
            styles.promoButton,
            !canRedeem && styles.promoButtonDisabled,
          ]}
          onPress={() => canRedeem && onRedeem(code)}
          disabled={!canRedeem}
          activeOpacity={0.82}
          accessibilityRole="button"
          accessibilityLabel={isZh ? '兑换' : 'Redeem promo code'}
        >
          {isRedeeming ? (
            <ActivityIndicator color="#000" size="small" />
          ) : (
            <Text style={styles.promoButtonText}>
              {isZh ? '兑换' : 'Redeem'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Subtle hint line ────────────────────────────────────────────── */}
      <Text style={styles.promoHint}>
        {isZh
          ? '输入有效的限时兑换码即可免费解锁高级功能'
          : 'Enter a valid time-limited code to unlock premium for free'}
      </Text>

    </View>
  );
}

// ─── UpgradeScreen ────────────────────────────────────────────────────────────

export default function UpgradeScreen() {
  const navigation    = useNavigation();
  const { isZh }     = useText();
  const {
    isPremium, isLoading: premiumLoading,
    isRestoring, unlock, restore, validateAndUnlock,
  } = usePremium();

  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRedeeming,  setIsRedeeming]  = useState(false);

  // Entrance animations
  const headerFade  = useRef(new Animated.Value(0)).current;
  const headerSlide = useRef(new Animated.Value(-24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerFade,  { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(headerSlide, { toValue: 0, tension: 70, friction: 10, useNativeDriver: true }),
    ]).start();
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleUnlock = useCallback(async () => {
    if (isPurchasing || isPremium) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsPurchasing(true);
    try {
      await unlock();
      // unlock() updates premiumStore → isPremium will flip to true
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert(
        isZh ? '购买失败' : 'Purchase Failed',
        isZh ? '请稍后重试。' : 'Please try again later.',
        [{ text: isZh ? '好的' : 'OK' }]
      );
    } finally {
      setIsPurchasing(false);
    }
  }, [isPurchasing, isPremium, unlock, isZh]);

  const handleRestore = useCallback(async () => {
    if (isRestoring) return;
    await Haptics.selectionAsync();
    try {
      // premiumStore.restore() (called inside the hook) handles the Alert
      // and updates isPremium via the singleton subscription — no local
      // state manipulation needed here.
      await restore({ isZh });
    } catch { /* errors are caught and logged inside the hook */ }
  }, [isRestoring, restore, isZh]);

  /**
   * handleRedeem(code)
   * Passed down to PromoCodeSection. Validates the code via the hook which
   * delegates to premiumStore.validateAndUnlock() — all side-effects
   * (Alert, AsyncStorage, subscriber notifications) happen inside the hook.
   */
  const handleRedeem = useCallback(async (code) => {
    if (isRedeeming) return;
    await Haptics.selectionAsync();
    setIsRedeeming(true);
    try {
      await validateAndUnlock(code, { isZh });
    } catch (e) {
      console.error('[UpgradeScreen] handleRedeem error:', e);
    } finally {
      setIsRedeeming(false);
    }
  }, [isRedeeming, validateAndUnlock, isZh]);

  // ── Already premium ───────────────────────────────────────────────────────

  if (!premiumLoading && isPremium) {
    return (
      <View style={styles.container}>
        <View style={styles.navbar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.navBack}>
            <Text style={styles.navBackText}>← {isZh ? '返回' : 'Back'}</Text>
          </TouchableOpacity>
          <LanguageToggle size="sm" />
          <View style={{ minWidth: 60 }} />
        </View>
        <AlreadyUnlocked isZh={isZh} onBack={() => navigation.goBack()} />
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* ── Navbar ─────────────────────────────────────────────────────── */}
      <View style={styles.navbar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.navBack}>
          <Text style={styles.navBackText}>← {isZh ? '返回' : 'Back'}</Text>
        </TouchableOpacity>
        <LanguageToggle size="sm" />
        <View style={{ minWidth: 60 }} />
      </View>

      {/*
        KeyboardAvoidingView sits between the fixed navbar and the scroll area.
        This ensures the promo TextInput scrolls into view when the soft
        keyboard appears without displacing the navbar.
        behavior="padding" (iOS) adds bottom padding equal to keyboard height.
        behavior="height"  (Android) shrinks the available height instead.
      */}
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces
      >
        {/* ── Hero header ──────────────────────────────────────────────── */}
        <Animated.View
          style={[styles.hero, { opacity: headerFade, transform: [{ translateY: headerSlide }] }]}
        >
          {/* Decorative glow ring */}
          <View style={styles.glowRing} />

          <Text style={styles.heroIcon}>✦</Text>
          <Text style={styles.heroTitle}>
            {isZh ? '高级版' : 'PREMIUM'}
          </Text>
          <Text style={styles.heroSubtitle}>
            {isZh ? '解锁完整占卜体验' : 'Unlock the Full Oracle Experience'}
          </Text>

          {/* Price badge */}
          <View style={styles.priceBadge}>
            <Text style={styles.priceAmount}>$6.99</Text>
            <Text style={styles.priceNote}>
              {isZh ? '一次性买断 · 永久有效' : 'One-time · Lifetime access'}
            </Text>
          </View>
        </Animated.View>

        {/* ── Feature list ─────────────────────────────────────────────── */}
        <View style={styles.featuresContainer}>
          <Text style={styles.featuresTitle}>
            {isZh ? '高级版功能' : 'PREMIUM FEATURES'}
          </Text>
          {FEATURES.map((f, i) => (
            <FeatureRow key={f.labelEn} feature={f} isZh={isZh} index={i} />
          ))}
        </View>

        {/* ── Comparison table ─────────────────────────────────────────── */}
        <View style={styles.comparisonCard}>
          {[
            {
              labelZh: '摇卦起卦',     labelEn: 'Shake to Divine',
              freeYes: true, premiumYes: true,
            },
            {
              labelZh: '卦象与卦辞',   labelEn: 'Hexagram & Judgment',
              freeYes: true, premiumYes: true,
            },
            {
              labelZh: '变爻与变卦',   labelEn: 'Changing Lines & Transformed',
              freeYes: false, premiumYes: true,
            },
            {
              labelZh: '六类生活指引', labelEn: 'Six Category Readings',
              freeYes: false, premiumYes: true,
            },
            {
              labelZh: '占卦历史记录', labelEn: 'Divination History',
              freeYes: false, premiumYes: true,
            },
          ].map((row, i) => (
            <View key={i} style={[styles.compRow, i > 0 && styles.compRowBorder]}>
              <Text style={styles.compLabel} numberOfLines={1}>
                {isZh ? row.labelZh : row.labelEn}
              </Text>
              <Text style={[styles.compCell, row.freeYes    ? styles.compCellYes : styles.compCellNo]}>
                {row.freeYes    ? '✓' : '—'}
              </Text>
              <Text style={[styles.compCell, row.premiumYes ? styles.compCellYes : styles.compCellNo]}>
                {row.premiumYes ? '✓' : '—'}
              </Text>
            </View>
          ))}
          <View style={styles.compHeader}>
            <View style={styles.compHeaderLabel} />
            <Text style={styles.compHeaderCell}>{isZh ? '基础' : 'Free'}</Text>
            <Text style={[styles.compHeaderCell, { color: COLORS.gold }]}>
              {isZh ? '高级版' : 'Premium'}
            </Text>
          </View>
        </View>

        {/* ── CTA button ───────────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.ctaButton, (isPurchasing || premiumLoading) && styles.ctaButtonDisabled]}
          onPress={handleUnlock}
          disabled={isPurchasing || premiumLoading}
          activeOpacity={0.88}
        >
          <LinearGradient
            colors={['#C9A227', '#D4AF37', '#F0D060', '#D4AF37', '#B8941F']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.ctaGradient}
          >
            {isPurchasing ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <>
                <Text style={styles.ctaText}>
                  {isZh ? '立即解锁高级版 — ¥49.99' : 'Unlock Premium — $6.99'}
                </Text>
                <Text style={styles.ctaSubText}>
                  {isZh ? '一次性买断，永久有效' : 'One-time payment · No subscription'}
                </Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>

        {/* ── Restore & Legal ──────────────────────────────────────────── */}
        <View style={styles.footer}>
          <TouchableOpacity
            onPress={handleRestore}
            disabled={isRestoring}
            style={[styles.restoreButton, isRestoring && styles.restoreButtonDisabled]}
            activeOpacity={0.75}
          >
            {isRestoring ? (
              <ActivityIndicator color={COLORS.gold} size="small" />
            ) : (
              <>
                <Text style={styles.restoreIcon}>↩</Text>
                <Text style={styles.restoreText}>
                  {isZh ? '恢复购买' : 'Restore Purchase'}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.legalRow}>
            <Text style={styles.legalText}>
              {isZh
                ? '购买后即表示您同意Apple/Google的服务条款及隐私政策。仅供娱乐之用。'
                : 'By purchasing you agree to Apple/Google Terms of Service and Privacy Policy. For entertainment purposes only.'}
            </Text>
          </View>
        </View>

        {/* ── Promo Code section ──────────────────────────────────────────── */}
        {/* Hidden automatically when isPremium is true (AlreadyUnlocked is
            shown instead of this render branch entirely), so the guard here
            is redundant but makes the intent explicit. */}
        {!isPremium && (
          <PromoCodeSection
            isZh={isZh}
            onRedeem={handleRedeem}
            isRedeeming={isRedeeming}
          />
        )}

      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  // ── Navbar
  navbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 36, paddingBottom: 12,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1, borderBottomColor: COLORS.goldDim,
    backgroundColor: COLORS.background,
  },
  navBack:     { padding: 4, minWidth: 60 },
  navBackText: { fontFamily: FONTS.caption, fontSize: 13, color: COLORS.gold, letterSpacing: 0.5 },

  // ── Scroll
  scrollContent: { paddingHorizontal: SPACING.lg, paddingBottom: 60 },

  // ── Hero
  hero: { alignItems: 'center', paddingTop: SPACING.xl, paddingBottom: SPACING.xl },

  glowRing: {
    position: 'absolute', top: SPACING.xl - 16,
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 1, borderColor: COLORS.gold + '33',
    shadowColor: COLORS.gold, shadowOpacity: 0.4, shadowRadius: 30, shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },

  heroIcon:     { fontSize: 40, color: COLORS.gold, marginBottom: SPACING.sm },
  heroTitle:    { fontFamily: FONTS.display, fontSize: 36, color: COLORS.gold, letterSpacing: 8, marginBottom: SPACING.xs },
  heroSubtitle: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.textSecondary, letterSpacing: 0.5, textAlign: 'center', marginBottom: SPACING.lg },

  priceBadge: {
    backgroundColor: COLORS.surface, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.gold + '66',
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.xl,
    alignItems: 'center',
  },
  priceAmount: { fontFamily: FONTS.display, fontSize: 28, color: COLORS.gold, letterSpacing: 2 },
  priceNote:   { fontFamily: FONTS.caption, fontSize: 10, color: COLORS.textSecondary, letterSpacing: 1, marginTop: 2 },

  // ── Features
  featuresContainer: { marginBottom: SPACING.lg },
  featuresTitle: {
    fontFamily: FONTS.caption, fontSize: 10, color: COLORS.goldMuted,
    letterSpacing: 4, marginBottom: SPACING.md, textTransform: 'uppercase',
  },

  featureRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surface, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.goldDim,
    padding: SPACING.md, marginBottom: SPACING.sm,
  },
  featureIconBox: {
    width: 36, height: 36, borderRadius: 8,
    backgroundColor: COLORS.gold + '15',
    borderWidth: 1, borderColor: COLORS.goldDim,
    alignItems: 'center', justifyContent: 'center',
    marginRight: SPACING.md,
  },
  featureIcon:  { fontSize: 16, color: COLORS.gold },
  featureText:  { flex: 1 },
  featureLabel: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.text, marginBottom: 2 },
  featureDesc:  { fontFamily: FONTS.body, fontSize: 11, color: COLORS.textSecondary, lineHeight: 16 },
  featureCheck: { color: COLORS.gold, fontSize: 16, marginLeft: SPACING.sm },

  // ── Comparison table
  comparisonCard: {
    backgroundColor: COLORS.surface, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.goldDim,
    overflow: 'hidden', marginBottom: SPACING.xl,
  },
  compHeader: {
    flexDirection: 'row', backgroundColor: COLORS.surfaceHigh,
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
    borderTopWidth: 1, borderTopColor: COLORS.goldDim,
  },
  compHeaderLabel: { flex: 1 },
  compHeaderCell:  {
    width: 56, textAlign: 'center',
    fontFamily: FONTS.caption, fontSize: 9, color: COLORS.textSecondary, letterSpacing: 1,
  },
  compRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md },
  compRowBorder: { borderTopWidth: 1, borderTopColor: COLORS.goldDim + '44' },
  compLabel: { flex: 1, fontFamily: FONTS.body, fontSize: 13, color: COLORS.text },
  compCell:  { width: 56, textAlign: 'center', fontFamily: FONTS.body, fontSize: 14 },
  compCellYes: { color: COLORS.gold },
  compCellNo:  { color: COLORS.textDim, opacity: 0.4 },

  // ── CTA
  ctaButton:         { borderRadius: 16, overflow: 'hidden', marginBottom: SPACING.md },
  ctaButtonDisabled: { opacity: 0.65 },
  ctaGradient:       { paddingVertical: 20, alignItems: 'center' },
  ctaText:           { fontFamily: FONTS.caption, fontSize: 16, color: '#000', letterSpacing: 1.5, fontWeight: '700' },
  ctaSubText:        { fontFamily: FONTS.caption, fontSize: 10, color: '#000', letterSpacing: 1, opacity: 0.7, marginTop: 3 },

  // ── Footer
  footer: { alignItems: 'center' },

  // Ghost / secondary button — sits beneath the gold CTA
  restoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.goldDim,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: SPACING.xl,
    marginBottom: SPACING.md,
    minWidth: 220,
    minHeight: 48,       // easy tap target
    backgroundColor: 'transparent',
  },
  restoreButtonDisabled: { opacity: 0.45 },
  restoreIcon: {
    fontFamily: FONTS.body,
    fontSize: 15,
    color: COLORS.goldMuted,
    marginRight: 6,
  },
  restoreText: {
    fontFamily: FONTS.caption,
    fontSize: 13,
    color: COLORS.goldMuted,
    letterSpacing: 1,
  },
  legalRow:  { paddingHorizontal: SPACING.md },
  legalText: { fontFamily: FONTS.caption, fontSize: 9, color: COLORS.textSecondary, textAlign: 'center', letterSpacing: 0.3, lineHeight: 14, opacity: 0.5 },

  // ── Keyboard avoid wrapper (sits between navbar and ScrollView)
  keyboardAvoid: { flex: 1 },

  // ── Promo code section ────────────────────────────────────────────────────
  //
  // Lives below the Restore Purchase button.  Always visible for free users;
  // the parent's isPremium guard removes it entirely once premium is active.

  promoSection: {
    marginTop: 30,              // task-specified gap below restore button
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.lg,
    width: '100%',
    alignItems: 'stretch',
  },

  // Centred divider  ── label ──
  promoDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  promoDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.goldDim,
    opacity: 0.45,
  },
  promoDividerLabel: {
    fontFamily:    FONTS.caption,
    fontSize:      9,
    color:         COLORS.goldDim,
    letterSpacing: 3,
    marginHorizontal: SPACING.md,
    opacity:       0.75,
  },

  // Input + button in a horizontal row
  promoInputRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           SPACING.sm,
    marginBottom:  SPACING.xs,
  },

  promoInput: {
    flex:              1,
    height:            48,
    borderWidth:       1,
    borderColor:       '#FFD700',          // gold per spec — more vivid than goldDim
    borderRadius:      10,
    backgroundColor:   COLORS.surface,
    paddingHorizontal: SPACING.md,
    fontFamily:        FONTS.body,
    fontSize:          14,
    color:             COLORS.text,
    letterSpacing:     1,                  // helps readability of all-caps codes
  },
  // Subtle glow on focus — communicates the field is active without extra chrome
  promoInputFocused: {
    borderColor:   COLORS.gold,
    shadowColor:   COLORS.gold,
    shadowOpacity: 0.3,
    shadowRadius:  6,
    shadowOffset:  { width: 0, height: 0 },
    elevation:     3,
  },

  // Solid gold Redeem button — visually paired with the CTA above
  promoButton: {
    height:            48,
    paddingHorizontal: SPACING.lg,
    borderRadius:      10,
    backgroundColor:   COLORS.gold,
    alignItems:        'center',
    justifyContent:    'center',
    minWidth:          80,
  },
  promoButtonDisabled: {
    opacity: 0.38,
  },
  promoButtonText: {
    fontFamily:  FONTS.caption,
    fontSize:    13,
    color:       '#000',
    letterSpacing: 1,
    fontWeight:  '700',
  },

  // De-emphasised helper copy below the input row
  promoHint: {
    fontFamily:  FONTS.caption,
    fontSize:    9,
    color:       COLORS.textSecondary,
    textAlign:   'center',
    letterSpacing: 0.5,
    opacity:     0.45,
    marginTop:   SPACING.xs,
  },

  // ── Already unlocked
  unlockedContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xl },
  unlockedBadge: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: COLORS.gold + '20', borderWidth: 1.5, borderColor: COLORS.gold,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: SPACING.lg,
  },
  unlockedBadgeIcon:    { fontSize: 36, color: COLORS.gold },
  unlockedTitle:        { fontFamily: FONTS.display, fontSize: 24, color: COLORS.gold, letterSpacing: 4, textAlign: 'center', marginBottom: SPACING.md },
  unlockedBody:         { fontFamily: FONTS.body, fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: SPACING.xl },
  unlockedBackButton:   { backgroundColor: COLORS.gold, borderRadius: 12, paddingVertical: 14, paddingHorizontal: SPACING.xl, alignSelf: 'center' },
  unlockedBackText:     { fontFamily: FONTS.caption, fontSize: 14, color: '#000', letterSpacing: 1.5, fontWeight: '700' },
});
