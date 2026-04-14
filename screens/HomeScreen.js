/**
 * HomeScreen.js
 * ─────────────────────────────────────────────────────────────────────────────
 * The primary oracle interface. Language-aware via useText().
 *
 * Language toggle lives in the top-right of the header.
 * All UI labels sourced from UI_STRINGS via t() / tf().
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, {
  useRef, useState, useEffect, useCallback, useMemo,
} from 'react';
import {
  View, Text, TouchableOpacity, Animated,
  StyleSheet, Dimensions, StatusBar, Platform, ScrollView,
  TextInput, Keyboard,
} from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

import ShakeSensor from '../components/ShakeSensor';
import LanguageToggle from '../components/LanguageToggle';
import { useIChing, DIVINATION_STATES, LINE_VALUE } from '../hooks/useIChing';
import { useText } from '../context/LanguageContext';
import { COLORS, FONTS, SPACING } from '../constants/theme';

const { width: SCREEN_W } = Dimensions.get('window');
const COIN_SIZE = SCREEN_W * 0.42;

// ─── LineIndicator ────────────────────────────────────────────────────────────

function LineIndicator({ lineValue, lineIndex }) {
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (lineValue !== undefined) {
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 120, friction: 8 }),
        Animated.timing(fadeAnim,  { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [lineValue]);

  const isChanging = lineValue === LINE_VALUE.OLD_YIN || lineValue === LINE_VALUE.OLD_YANG;
  const isYang     = lineValue === LINE_VALUE.YOUNG_YANG || lineValue === LINE_VALUE.OLD_YANG;

  const lineColor = lineValue === undefined
    ? COLORS.surfaceDim
    : isChanging ? COLORS.changing : COLORS.gold;

  return (
    <Animated.View style={[
      styles.lineRow,
      { opacity: lineValue !== undefined ? fadeAnim : 0.25, transform: [{ scale: scaleAnim }] },
    ]}>
      <Text style={styles.lineLabel}>{lineIndex + 1}</Text>

      <View style={styles.lineSymbolContainer}>
        {lineValue === undefined ? (
          <View style={[styles.lineSegmentFull, { backgroundColor: COLORS.surfaceDim }]} />
        ) : isYang ? (
          <View style={[styles.lineSegmentFull, { backgroundColor: lineColor }]} />
        ) : (
          <View style={styles.lineYinRow}>
            <View style={[styles.lineSegmentHalf, { backgroundColor: lineColor }]} />
            <View style={styles.lineGap} />
            <View style={[styles.lineSegmentHalf, { backgroundColor: lineColor }]} />
          </View>
        )}
      </View>

      {isChanging && lineValue !== undefined && (
        <Text style={styles.changingMarker}>
          {lineValue === LINE_VALUE.OLD_YANG ? 'o' : '×'}
        </Text>
      )}
    </Animated.View>
  );
}

// ─── TiltCoin ─────────────────────────────────────────────────────────────────

const TiltCoin = React.memo(function TiltCoin({ onPress, isCasting }) {
  const tiltX      = useRef(new Animated.Value(0)).current;
  const tiltY      = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0.4)).current;
  const pulseScale  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Accelerometer.setUpdateInterval(32);
    const sub = Accelerometer.addListener(({ x, y }) => {
      Animated.spring(tiltX, { toValue: -y * 12, useNativeDriver: true, tension: 40, friction: 7 }).start();
      Animated.spring(tiltY, { toValue:  x * 12, useNativeDriver: true, tension: 40, friction: 7 }).start();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!isCasting) {
      const pulse = Animated.loop(Animated.sequence([
        Animated.timing(glowOpacity, { toValue: 0.8, duration: 1800, useNativeDriver: true }),
        Animated.timing(glowOpacity, { toValue: 0.3, duration: 1800, useNativeDriver: true }),
      ]));
      pulse.start();
      return () => pulse.stop();
    }
  }, [isCasting]);

  useEffect(() => {
    if (isCasting) {
      const shaking = Animated.loop(Animated.sequence([
        Animated.spring(pulseScale, { toValue: 1.08, useNativeDriver: true }),
        Animated.spring(pulseScale, { toValue: 0.96, useNativeDriver: true }),
      ]));
      shaking.start();
      return () => {
        shaking.stop();
        Animated.spring(pulseScale, { toValue: 1, useNativeDriver: true }).start();
      };
    }
  }, [isCasting]);

  const coinStyle = {
    transform: [
      { rotateX: tiltX.interpolate({ inputRange: [-15, 15], outputRange: ['-15deg', '15deg'] }) },
      { rotateY: tiltY.interpolate({ inputRange: [-15, 15], outputRange: ['-15deg', '15deg'] }) },
      { scale: pulseScale },
    ],
  };

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88} disabled={isCasting}>
      <Animated.View style={[styles.glowRing, { opacity: glowOpacity }]} />
      <Animated.View style={[styles.coin, coinStyle]}>
        <LinearGradient
          colors={['#C9A227', '#D4AF37', '#F0D060', '#D4AF37', '#A67C00']}
          start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }}
          style={styles.coinGradient}
        >
          <View style={styles.coinHole}>
            <Text style={styles.coinCharTop}>乾</Text>
            <View style={styles.coinHoleSquare} />
            <Text style={styles.coinCharBottom}>坤</Text>
          </View>
          {['☰','☱','☲','☳','☴','☵','☶','☷'].map((gua, i) => {
            const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
            const r = COIN_SIZE * 0.36;
            return (
              <Text key={i} style={[styles.baguaChar, {
                position: 'absolute',
                left: COIN_SIZE / 2 + r * Math.cos(angle) - 10,
                top:  COIN_SIZE / 2 + r * Math.sin(angle) - 10,
              }]}>{gua}</Text>
            );
          })}
        </LinearGradient>
      </Animated.View>
    </TouchableOpacity>
  );
});

// ─── HomeScreen ───────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const navigation     = useNavigation();
  const shakeSensorRef = useRef(null);

  // ── Language ───────────────────────────────────────────────────────────────
  const { t, tf, isZh } = useText();

  const {
    status, lineValues, currentLineIndex,
    isCasting, isReady, castHexagram, reset,
  } = useIChing();

  const [formedLines, setFormedLines] = useState([]);
  const [question,    setQuestion]    = useState('');

  // ── Focus animation — replaces isInputFocused state ────────────────────
  // WHY Animated.Value instead of useState(false):
  //   setIsInputFocused(true) → HomeScreen re-render → TiltCoin re-renders
  //   (not memoized before this fix) → new coinStyle with brand-new
  //   Animated.interpolate node objects → React Native re-connects those
  //   nodes to the native driver → brief native-thread disruption → blur.
  //
  //   Animated.timing drives the border colour directly on the UI thread
  //   without scheduling a React state update. No re-render fires, TiltCoin
  //   stays stable, and the TextInput keeps focus.
  //
  //   useNativeDriver: false is required for borderColor (a paint prop) —
  //   it still runs without a React re-render, just via the JS animation loop.
  const focusAnim = useRef(new Animated.Value(0)).current;

  const handleInputFocus = useCallback(() => {
    Animated.timing(focusAnim, {
      toValue: 1, duration: 180, useNativeDriver: false,
    }).start();
  }, [focusAnim]);

  const handleInputBlur = useCallback(() => {
    Animated.timing(focusAnim, {
      toValue: 0, duration: 140, useNativeDriver: false,
    }).start();
  }, [focusAnim]);

  // Animated style for the questionBox border.
  // elevation is intentionally excluded: on Android, changing elevation
  // triggers a z-order recalculation that emits a spurious blur event.
  const questionBoxAnimStyle = {
    borderColor: focusAnim.interpolate({
      inputRange:  [0, 1],
      outputRange: [COLORS.goldDim, COLORS.gold],
    }),
  };

  const QUESTION_LIMIT = 50;

  // ── Reset oracle state every time HomeScreen comes into focus ─────────────
  //
  // WHY useFocusEffect and NOT useEffect(fn, []):
  //   React Navigation stack navigators do NOT unmount screens when you push
  //   a new screen on top. HomeScreen stays alive in memory the entire time
  //   the user is reading ResultScreen. useEffect(fn, []) only fires once on
  //   initial mount — it will never fire again when the user presses "New Cast"
  //   and pops back. useFocusEffect fires on EVERY focus event (mount + every
  //   back-navigation), making it the correct tool for per-session resets.
  //
  // Reset sequence:
  //   1. reset()               → sets useIChing status back to IDLE
  //                               (isReady = true, isCasting = false,
  //                                castingRef.current = false)
  //   2. setFormedLines([])    → clears the 6-line progress strip
  //   3. resume()              → re-enables the accelerometer listener
  //                               (it was paused in the cleanup below)
  //
  // Cleanup (fires when navigating AWAY to ResultScreen):
  //   pause()                  → unregisters the Accelerometer subscription
  //                               so no stray shake events fire while the
  //                               user is reading their result.
  useFocusEffect(
    useCallback(() => {
      reset();
      setFormedLines([]);
      setQuestion('');
      shakeSensorRef.current?.resume?.();

      return () => {
        shakeSensorRef.current?.pause?.();
      };
    }, [reset])
  );

  const handleCastStart = useCallback(() => setFormedLines([]), []);

  const handleLineFormed = useCallback((lineIndex, lineValue) => {
    setFormedLines(prev => {
      const next = [...prev];
      next[lineIndex] = lineValue;
      return next;
    });
  }, []);

  const handleCastComplete = useCallback((result) => {
    if (result) setTimeout(() => navigation.navigate('Result', { result, question: question.trim() }), 400);
  }, [navigation, question]);

  const handleManualTrigger = useCallback(() => {
    shakeSensorRef.current?.triggerCast();
  }, []);

  // ── Status text (language-aware) ──────────────────────────────────────────
  const statusText = useMemo(() => {
    if (isCasting) {
      const count = formedLines.filter(v => v !== undefined).length;
      return tf('homeCastingLine', { n: count });
    }
    return t('homeShakeHint');
  }, [isCasting, formedLines, t, tf, isZh]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      <ShakeSensor
        ref={shakeSensorRef}
        castHexagram={castHexagram}
        onCastStart={handleCastStart}
        onLineFormed={handleLineFormed}
        onCastComplete={handleCastComplete}
        disabled={!isReady && !isCasting}
      />

      {/*
        keyboardShouldPersistTaps="handled"
        ─────────────────────────────────────────────────────────────────────
        FIX: without this prop, the ScrollView dismisses the keyboard on
        every touch, including taps on the TextInput itself. "handled" tells
        the ScrollView to let interactive children (TextInput, TouchableOpacity
        buttons) process their own touches without keyboard interference.
        The keyboard still dismisses naturally when the user scrolls or taps
        on non-interactive background areas, which is the correct UX.
      */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          {/* App title */}
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerChinese}>易鉴</Text>
          </View>
          <Text style={styles.headerEnglish}>I-CHING ORACLE</Text>
          <View style={styles.headerDivider} />

          {/* ── Language toggle — top-right of header area ─────────────────── */}
          <View style={styles.toggleRow}>
            <LanguageToggle size="md" />
          </View>
        </View>

        {/* ── Coin ──────────────────────────────────────────────────────────── */}
        <View style={styles.coinContainer}>
          <TiltCoin onPress={handleManualTrigger} isCasting={isCasting} />
        </View>

        {/* ── Status ────────────────────────────────────────────────────────── */}
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>{statusText}</Text>
          {isReady && (
            <Text style={styles.shakeHint}>{t('homeSubtitle')}</Text>
          )}
        </View>

        {/* ── Question input ─────────────────────────────────────────────── */}
        {/*
          Keyboard dismissal is handled by keyboardShouldPersistTaps="handled"
          on the ScrollView.
        */}
        <View style={styles.questionWrapper}>

          {/* Section label */}
          <Text style={styles.questionLabel}>
            {isZh ? '所问之事（选填）' : 'YOUR QUESTION  ·  OPTIONAL'}
          </Text>

          {/*
            questionBox — the rounded card that contains the multiline input.
            Border colour shifts from goldDim → gold on focus so the user
            gets clear visual feedback that the field is active.
          */}
          {/*
            Animated.View drives borderColor via focusAnim without causing
            a React re-render. elevation is intentionally omitted — it would
            trigger an Android z-order recalculation that fires a blur event.
          */}
          <Animated.View style={[styles.questionBox, questionBoxAnimStyle]}>
            <TextInput
              style={styles.questionInput}
              value={question}
              onChangeText={text => setQuestion(text.slice(0, QUESTION_LIMIT))}
              placeholder={isZh
                ? '请在心中默念三次所问之事，待心定神凝后，输入您的困惑…'
                : 'Focus your mind on a question. Silently repeat it three times, then write it here…'}
              placeholderTextColor={COLORS.textDim}
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
              blurOnSubmit={true}
              maxLength={QUESTION_LIMIT}
              editable={!isCasting}
              multiline={true}
              numberOfLines={3}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
            />

            {/* ── Box footer: clear button (left) + char count (right) ── */}
            <View style={styles.questionBoxFooter}>
              {question.length > 0 ? (
                <TouchableOpacity
                  style={styles.questionClear}
                  onPress={() => setQuestion('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.questionClearText}>✕ {isZh ? '清除' : 'clear'}</Text>
                </TouchableOpacity>
              ) : (
                <View />
              )}
              <Text style={[
                styles.questionCount,
                question.length >= QUESTION_LIMIT && styles.questionCountMax,
              ]}>
                {question.length}/{QUESTION_LIMIT}
              </Text>
            </View>
          </Animated.View>

        </View>

        {/* ── 6-Line Progress ───────────────────────────────────────────────── */}
        <View style={styles.linesContainer}>
          <View style={styles.linesCard}>
            <Text style={styles.linesTitle}>{t('homeHexTitle')}</Text>
            {[5, 4, 3, 2, 1, 0].map(i => (
              <LineIndicator
                key={i}
                lineIndex={i}
                lineValue={formedLines[i]}
              />
            ))}
          </View>
        </View>

        {/* ── Premium badge ─────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.premiumBadge}
          onPress={() => navigation.navigate('Upgrade')}
        >
          <Text style={styles.premiumBadgeText}>{t('homePremiumBadge')}</Text>
        </TouchableOpacity>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <View style={styles.footer}>
          <TouchableOpacity onPress={() => navigation.navigate('History')}>
            <Text style={styles.footerLink}>{t('homeHistory')}</Text>
          </TouchableOpacity>
          <Text style={styles.footerSep}>·</Text>
          <TouchableOpacity onPress={() => navigation.navigate('About')}>
            <Text style={styles.footerLink}>{t('homeAbout')}</Text>
          </TouchableOpacity>
          <Text style={styles.footerSep}>·</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Disclaimer')}>
            <Text style={styles.footerLink}>{t('homeDisclaimer')}</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: COLORS.background },

  scrollContent: {
    flexGrow: 1, alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 40, paddingHorizontal: SPACING.lg,
  },

  // ── Header
  header: { alignItems: 'center', marginBottom: SPACING.xl, width: '100%' },

  headerTitleRow: { alignItems: 'center' },

  headerChinese: {
    fontFamily: FONTS.display, fontSize: 52, color: COLORS.gold,
    letterSpacing: 12, lineHeight: 64,
  },
  headerEnglish: {
    fontFamily: FONTS.caption, fontSize: 11, color: COLORS.goldMuted,
    letterSpacing: 6, marginTop: -4,
  },
  headerDivider: {
    width: 80, height: 1, backgroundColor: COLORS.goldDim,
    marginTop: SPACING.sm, opacity: 0.5,
  },

  // Language toggle row — sits below the divider, centred
  toggleRow: {
    marginTop: SPACING.md,
    alignItems: 'center',
  },

  // ── Coin
  coinContainer: {
    alignItems: 'center', justifyContent: 'center',
    marginVertical: SPACING.xl, height: COIN_SIZE + 40,
  },
  glowRing: {
    position: 'absolute',
    width: COIN_SIZE + 48, height: COIN_SIZE + 48,
    borderRadius: (COIN_SIZE + 48) / 2,
    borderWidth: 1.5, borderColor: COLORS.gold,
    shadowColor: COLORS.gold, shadowOpacity: 0.8,
    shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 10,
  },
  coin: {
    width: COIN_SIZE, height: COIN_SIZE, borderRadius: COIN_SIZE / 2,
    shadowColor: COLORS.gold, shadowOpacity: 0.6, shadowRadius: 20,
    shadowOffset: { width: 0, height: 4 }, elevation: 12,
  },
  coinGradient: {
    width: COIN_SIZE, height: COIN_SIZE, borderRadius: COIN_SIZE / 2,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  coinHole:        { alignItems: 'center', justifyContent: 'center' },
  coinHoleSquare:  { width: COIN_SIZE * 0.18, height: COIN_SIZE * 0.18, backgroundColor: '#000', borderRadius: 3 },
  coinCharTop:     { fontFamily: FONTS.display, fontSize: 13, color: '#000', opacity: 0.7, marginBottom: 4, letterSpacing: 1 },
  coinCharBottom:  { fontFamily: FONTS.display, fontSize: 13, color: '#000', opacity: 0.7, marginTop: 4, letterSpacing: 1 },
  baguaChar:       { fontSize: 13, color: '#000', opacity: 0.55, fontFamily: FONTS.display },

  // ── Status
  statusContainer: { alignItems: 'center', marginBottom: SPACING.xl },
  statusText:      { fontFamily: FONTS.body, fontSize: 14, color: COLORS.textSecondary, letterSpacing: 1, textAlign: 'center' },
  shakeHint:       { fontFamily: FONTS.display, fontSize: 16, color: COLORS.goldMuted, letterSpacing: 4, marginTop: SPACING.xs },

  // ── Lines
  linesContainer: { width: '100%', marginBottom: SPACING.xl },
  linesCard: {
    backgroundColor: COLORS.surface, borderRadius: 16,
    borderWidth: 1, borderColor: COLORS.goldDim,
    padding: SPACING.lg, alignItems: 'center',
  },
  linesTitle: { fontFamily: FONTS.display, fontSize: 18, color: COLORS.goldMuted, letterSpacing: 6, marginBottom: SPACING.md },
  lineRow:    { flexDirection: 'row', alignItems: 'center', marginVertical: 5, width: '100%' },
  lineLabel:  { fontFamily: FONTS.caption, fontSize: 10, color: COLORS.goldDim, width: 16, textAlign: 'center', marginRight: SPACING.sm, letterSpacing: 0.5 },
  lineSymbolContainer: { flex: 1, height: 8, justifyContent: 'center' },
  lineSegmentFull: { height: 5, borderRadius: 3, width: '100%' },
  lineYinRow:      { flexDirection: 'row', alignItems: 'center', width: '100%' },
  lineSegmentHalf: { height: 5, borderRadius: 3, flex: 1 },
  lineGap:         { width: 16 },
  changingMarker:  { fontFamily: FONTS.caption, fontSize: 12, color: COLORS.changing, width: 16, textAlign: 'center', marginLeft: SPACING.sm },

  // ── Question input
  //
  // Design goals:
  //   • Full placeholder text visible without scrolling (minHeight 108 ≈ 3 lines
  //     of 14pt text at lineHeight 22, plus vertical padding)
  //   • Gold border glows on focus — handled by questionBoxFocused override
  //   • Character counter lives inside the box at the bottom-right so it reads
  //     as part of the field, not a disconnected label
  //   • Clear button in the bottom-left keeps the top-right of the text area
  //     unobstructed so long placeholder text isn't clipped

  questionWrapper: {
    width: '100%',
    marginBottom: SPACING.xl,
  },

  questionLabel: {
    fontFamily:   FONTS.caption,
    fontSize:     9,
    color:        COLORS.goldDim,
    letterSpacing: 3,
    marginBottom: SPACING.xs,
    textAlign:    'center',
    textTransform: 'uppercase',
  },

  questionBox: {
    backgroundColor: COLORS.surface,
    borderRadius:    14,
    borderWidth:     1,
    borderColor:     COLORS.goldDim,
    // Top padding gives the text breathing room from the border.
    // Bottom padding is smaller because the footer row (count + clear) adds
    // its own visual weight at the bottom.
    paddingTop:         SPACING.md,
    paddingBottom:      SPACING.sm,
    paddingHorizontal:  SPACING.md,
    // minHeight ensures the placeholder is fully visible on every screen size.
    // 108 ≈ 3 × lineHeight(22) + paddingTop(12) + paddingBottom(8) + footer(~18)
    minHeight: 108,
  },

  // NOTE: questionBoxFocused was removed.
  // Border colour is now driven by focusAnim (Animated.Value) on the
  // Animated.View wrapper — no React state update, no re-render, no blur.

  questionInput: {
    // Fill the box horizontally
    width: '100%',
    fontFamily:        FONTS.body,
    fontSize:          14,
    color:             COLORS.text,
    letterSpacing:     0.3,
    lineHeight:        22,
    // CRITICAL for Android: aligns the cursor and placeholder to the top of a
    // multiline TextInput. Without this, both sit vertically centred, which
    // looks wrong for a tall box.
    textAlignVertical: 'top',
    // Do NOT zero-out padding/margin here — zeroing breaks the Android cursor
    // position in multiline mode. Let RN's defaults handle it; they are
    // correct for multiline.
  },

  // Footer row: clear button on the left, char count on the right
  questionBoxFooter: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginTop:      SPACING.xs,
  },

  questionClear: {
    // Generous hit area without extra visual padding on the left
    paddingVertical:  2,
    paddingHorizontal: 0,
  },
  questionClearText: {
    fontFamily:    FONTS.caption,
    fontSize:      10,
    color:         COLORS.goldDim,
    letterSpacing: 0.5,
    opacity:       0.75,
  },

  questionCount: {
    fontFamily:    FONTS.caption,
    fontSize:      9,
    color:         COLORS.textDim,
    letterSpacing: 0.5,
    opacity:       0.55,
  },
  // Turns red (or amber) when the user hits the cap — a last-chance signal
  questionCountMax: {
    color:   COLORS.changing,   // amber/changing colour from theme
    opacity: 0.9,
  },

  // ── Premium badge
  premiumBadge: {
    borderWidth: 1, borderColor: COLORS.goldDim, borderRadius: 8,
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
    marginBottom: SPACING.xl, backgroundColor: 'rgba(212, 175, 55, 0.06)',
  },
  premiumBadgeText: { fontFamily: FONTS.caption, fontSize: 10, color: COLORS.goldMuted, letterSpacing: 1, textAlign: 'center' },

  // ── Footer
  footer:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: SPACING.sm },
  footerLink:{ fontFamily: FONTS.caption, fontSize: 11, color: COLORS.goldDim, letterSpacing: 1 },
  footerSep: { color: COLORS.goldDim, marginHorizontal: SPACING.sm, fontSize: 10, opacity: 0.4 },
});
