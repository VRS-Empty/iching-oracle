/**
 * components/AskOracleSection.js
 * ─────────────────────────────────────────────────────────────────────────────
 * The "Ask the Oracle" block on ResultScreen: a question box, the generated
 * answer, and the passages it drew on.
 *
 * Extracted as a component rather than inlined because ResultScreen is already
 * long, and this block owns real state (draft text, request lifecycle) that
 * would otherwise tangle with the screen's render logic.
 *
 * Visual language follows the rest of the result scroll — surface cards with a
 * gold hairline border, caption-case section labels, serif body copy — with one
 * departure: the answer card carries a left gold bar, the same device the
 * question banner at the top of the screen uses to mark "this came from you /
 * this is about you" rather than from the classical text.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, Keyboard, Platform,
} from 'react-native';

import { COLORS, FONTS, SPACING } from '../constants/theme';
import { MAX_QUESTION_CHARS } from '../constants/api';
import { useText } from '../context/LanguageContext';
import { useAskOracle, PREMIUM_DAILY_ASKS } from '../hooks/useAskOracle';
import { usePremium } from '../hooks/usePremium';

// ─── Source pill ──────────────────────────────────────────────────────────────

function SourcePill({ source, isZh, t }) {
  const kind =
    source.chunk_type === 'judgment' ? (isZh ? '卦辞' : 'Judgment') :
    source.chunk_type === 'image'    ? (isZh ? '象辞' : 'Image') :
    (isZh ? `第${source.line}爻` : `Line ${source.line}`);

  return (
    <View style={[styles.sourcePill, source.mandatory && styles.sourcePillCast]}>
      <Text style={styles.sourcePillHex}>
        {isZh ? `${source.hexagram}·${source.name}` : `#${source.hexagram} ${source.name}`}
      </Text>
      <Text style={styles.sourcePillKind}>{kind}</Text>
    </View>
  );
}

// ─── Quota-exhausted card ─────────────────────────────────────────────────────

function ExhaustedCard({ dailyLimit, isPremium, onUpgrade, t, tf }) {
  return (
    <View style={styles.exhaustedCard}>
      <Text style={styles.exhaustedTitle}>{t('askExhaustedTitle')}</Text>
      <Text style={styles.exhaustedBody}>
        {isPremium
          ? tf('askExhaustedPremium', { limit: dailyLimit })
          : tf('askExhaustedFree', { limit: dailyLimit, premium: PREMIUM_DAILY_ASKS })}
      </Text>
      {!isPremium && (
        <TouchableOpacity style={styles.exhaustedCTA} onPress={onUpgrade} activeOpacity={0.85}>
          <Text style={styles.exhaustedCTAText}>{t('askUpgradeCTA')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────

export default function AskOracleSection({ result, onUpgrade }) {
  const { t, tf, isZh } = useText();
  const { isPremium } = usePremium();
  const {
    ask, answer, sources, isLoading, error,
    remaining, dailyLimit, isExhausted, reset,
  } = useAskOracle();

  const [draft, setDraft] = useState('');

  const hexagramId = result?.originalHexagram?.number;
  // The API takes 1-indexed line positions; useIChing tracks them 0-indexed.
  const changingLines = useMemo(
    () => (result?.changingLineIndices ?? []).map(index => index + 1),
    [result],
  );
  const transformedHexagramId = result?.transformedHexagram?.number ?? null;

  const trimmed = draft.trim();
  const canSubmit = !!trimmed && !isLoading && !isExhausted && !!hexagramId;

  const handleAsk = useCallback(async () => {
    if (!canSubmit) return;
    Keyboard.dismiss();
    await ask({
      hexagramId,
      changingLines,
      transformedHexagramId,
      question: trimmed,
      lang: isZh ? 'zh' : 'en',
    });
  }, [canSubmit, ask, hexagramId, changingLines, transformedHexagramId, trimmed, isZh]);

  const handleAskAnother = useCallback(() => {
    reset();
    setDraft('');
  }, [reset]);

  if (!hexagramId) return null;

  const charCount = draft.length;
  const nearLimit = charCount > MAX_QUESTION_CHARS * 0.9;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('sectionAsk')}</Text>

      {/* ── Answer, once we have one ─────────────────────────────────────── */}
      {answer ? (
        <View style={styles.answerCard}>
          <Text style={styles.answerLabel}>{t('askAnswerLabel')}</Text>
          <Text style={styles.answerText}>{answer}</Text>

          {sources.length > 0 && (
            <View style={styles.sourcesBlock}>
              <Text style={styles.sourcesLabel}>{t('askSourcesLabel')}</Text>
              <View style={styles.sourcesRow}>
                {sources.map((source, i) => (
                  <SourcePill key={i} source={source} isZh={isZh} t={t} />
                ))}
              </View>
            </View>
          )}

          <Text style={styles.disclaimer}>{t('askDisclaimer')}</Text>

          <TouchableOpacity
            style={styles.askAnotherButton}
            onPress={handleAskAnother}
            activeOpacity={0.85}
          >
            <Text style={styles.askAnotherText}>{t('askAskAnother')}</Text>
          </TouchableOpacity>
        </View>
      ) : isExhausted ? (
        /* ── Allowance spent ───────────────────────────────────────────── */
        <ExhaustedCard
          dailyLimit={dailyLimit}
          isPremium={isPremium}
          onUpgrade={onUpgrade}
          t={t}
          tf={tf}
        />
      ) : (
        /* ── Question box ──────────────────────────────────────────────── */
        <View style={styles.askCard}>
          <Text style={styles.introText}>{t('askIntro')}</Text>

          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={t('askPlaceholder')}
            placeholderTextColor={COLORS.textDim}
            multiline
            maxLength={MAX_QUESTION_CHARS}
            editable={!isLoading}
            textAlignVertical="top"
            returnKeyType="default"
          />

          <View style={styles.metaRow}>
            <Text style={[styles.charCount, nearLimit && styles.charCountNear]}>
              {tf('askCharCount', { n: charCount, max: MAX_QUESTION_CHARS })}
            </Text>
            {remaining != null && (
              <Text style={styles.remaining}>
                {remaining === 1
                  ? t('askRemainingOne')
                  : tf('askRemaining', { n: remaining })}
              </Text>
            )}
          </View>

          {!!error && (
            <View style={styles.errorBlock}>
              <Text style={styles.errorText}>{error.message}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
            onPress={handleAsk}
            disabled={!canSubmit}
            activeOpacity={0.85}
          >
            {isLoading ? (
              <View style={styles.submitLoadingRow}>
                <ActivityIndicator size="small" color={COLORS.gold} />
                <Text style={styles.submitLoadingText}>{t('askSubmitting')}</Text>
              </View>
            ) : (
              <Text style={[styles.submitText, !canSubmit && styles.submitTextDisabled]}>
                {error ? t('askRetry') : t('askSubmit')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  section: { marginBottom: SPACING.lg },
  sectionTitle: {
    fontFamily: FONTS.caption, fontSize: 10, color: COLORS.goldMuted,
    letterSpacing: 4, marginBottom: SPACING.sm, textTransform: 'uppercase',
  },

  // ── Question box
  askCard: {
    backgroundColor: COLORS.surface, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.goldDim,
    padding: SPACING.lg,
  },
  introText: {
    fontFamily: FONTS.body, fontSize: 13, color: COLORS.textSecondary,
    lineHeight: 21, marginBottom: SPACING.md,
  },
  input: {
    fontFamily: FONTS.body, fontSize: 14, color: COLORS.text,
    backgroundColor: COLORS.surfaceHigh, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.goldDim,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    minHeight: 88, lineHeight: 21,
  },
  metaRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: SPACING.xs, marginBottom: SPACING.md,
  },
  charCount: {
    fontFamily: FONTS.caption, fontSize: 10, color: COLORS.textDim, letterSpacing: 0.5,
  },
  charCountNear: { color: COLORS.changing },
  remaining: {
    fontFamily: FONTS.caption, fontSize: 10, color: COLORS.goldMuted, letterSpacing: 0.5,
  },

  // ── Submit
  submitButton: {
    borderWidth: 1, borderColor: COLORS.gold, borderRadius: 10,
    paddingVertical: 13, alignItems: 'center',
    backgroundColor: 'rgba(212,175,55,0.08)',
  },
  submitButtonDisabled: {
    borderColor: COLORS.goldDim, backgroundColor: 'transparent',
  },
  submitText: {
    fontFamily: FONTS.caption, fontSize: 13, color: COLORS.gold, letterSpacing: 1.5,
  },
  submitTextDisabled: { color: COLORS.textDim },
  submitLoadingRow: { flexDirection: 'row', alignItems: 'center' },
  submitLoadingText: {
    fontFamily: FONTS.caption, fontSize: 13, color: COLORS.gold,
    letterSpacing: 1.5, marginLeft: SPACING.sm,
  },

  // ── Error
  errorBlock: {
    backgroundColor: 'rgba(207,102,121,0.08)', borderRadius: 8,
    borderWidth: 1, borderColor: COLORS.error + '55',
    padding: SPACING.sm, marginBottom: SPACING.md,
  },
  errorText: {
    fontFamily: FONTS.body, fontSize: 12, color: COLORS.error, lineHeight: 19,
  },

  // ── Answer
  answerCard: {
    backgroundColor: COLORS.surface, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.goldDim,
    borderLeftWidth: 3, borderLeftColor: COLORS.gold,
    padding: SPACING.lg,
  },
  answerLabel: {
    fontFamily: FONTS.caption, fontSize: 9, color: COLORS.goldMuted,
    letterSpacing: 3, marginBottom: SPACING.sm, textTransform: 'uppercase',
  },
  answerText: {
    fontFamily: FONTS.body, fontSize: 15, color: COLORS.text,
    lineHeight: 26, letterSpacing: 0.3,
  },

  // ── Sources
  sourcesBlock: {
    marginTop: SPACING.lg, paddingTop: SPACING.md,
    borderTopWidth: 1, borderTopColor: COLORS.goldDim + '44',
  },
  sourcesLabel: {
    fontFamily: FONTS.caption, fontSize: 9, color: COLORS.goldDim,
    letterSpacing: 2, marginBottom: SPACING.sm, textTransform: 'uppercase',
  },
  sourcesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  sourcePill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surfaceHigh, borderRadius: 6,
    borderWidth: 1, borderColor: COLORS.goldDim + '66',
    paddingHorizontal: SPACING.sm, paddingVertical: 3,
  },
  // Passages from the cast itself are weighted above retrieved ones.
  sourcePillCast: { borderColor: COLORS.goldDim, backgroundColor: 'rgba(212,175,55,0.06)' },
  sourcePillHex: {
    fontFamily: FONTS.caption, fontSize: 9, color: COLORS.goldMuted, letterSpacing: 0.5,
  },
  sourcePillKind: {
    fontFamily: FONTS.caption, fontSize: 9, color: COLORS.textSecondary,
    letterSpacing: 0.5, marginLeft: 5,
  },

  // ── Framing note
  disclaimer: {
    fontFamily: FONTS.bodyItalic, fontSize: 11, color: COLORS.textSecondary,
    lineHeight: 18, opacity: 0.75, marginTop: SPACING.md,
  },

  // ── Ask another
  askAnotherButton: {
    alignSelf: 'flex-start', marginTop: SPACING.md,
    borderWidth: 1, borderColor: COLORS.goldDim, borderRadius: 8,
    paddingVertical: 8, paddingHorizontal: SPACING.md,
  },
  askAnotherText: {
    fontFamily: FONTS.caption, fontSize: 12, color: COLORS.gold, letterSpacing: 0.5,
  },

  // ── Exhausted
  exhaustedCard: {
    backgroundColor: COLORS.surface, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.goldDim,
    padding: SPACING.lg, alignItems: 'flex-start',
  },
  exhaustedTitle: {
    fontFamily: FONTS.display, fontSize: 15, color: COLORS.goldMuted,
    letterSpacing: 1, marginBottom: SPACING.sm,
  },
  exhaustedBody: {
    fontFamily: FONTS.body, fontSize: 13, color: COLORS.textSecondary, lineHeight: 21,
  },
  exhaustedCTA: {
    marginTop: SPACING.md, borderWidth: 1, borderColor: COLORS.gold,
    borderRadius: 8, paddingVertical: 9, paddingHorizontal: SPACING.md,
    backgroundColor: 'rgba(212,175,55,0.08)',
  },
  exhaustedCTAText: {
    fontFamily: FONTS.caption, fontSize: 12, color: COLORS.gold, letterSpacing: 0.5,
  },
});
