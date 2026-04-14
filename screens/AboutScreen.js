/**
 * screens/AboutScreen.js
 * ─────────────────────────────────────────────────────────────────────────────
 * About page — developer info, version, and mission statement.
 * Fully bilingual via useText() / isZh.
 * Matches the oracle theme: black background, gold accents, display fonts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Platform, Animated, Linking,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useText } from '../context/LanguageContext';
import LanguageToggle from '../components/LanguageToggle';
import { COLORS, FONTS, SPACING } from '../constants/theme';

// ─── App metadata ─────────────────────────────────────────────────────────────

const APP_VERSION   = '1.0.0';
const DEVELOPER     = 'Daniel Liu';
const SCHOOL        = 'Queens College, CUNY';
const MAJOR         = 'Computer Science';
const CONTACT_EMAIL = 'danielliiux7@gmail.com'; 

// ─── Section cards ────────────────────────────────────────────────────────────

function SectionCard({ children, style }) {
  return (
    <View style={[styles.card, style]}>
      {children}
    </View>
  );
}

function SectionTitle({ children }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function Divider() {
  return <View style={styles.divider} />;
}

// ─── AboutScreen ──────────────────────────────────────────────────────────────

export default function AboutScreen() {
  const navigation = useNavigation();
  const { isZh }   = useText();

  // Entrance animation — fade + slide up
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 70, friction: 11, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={styles.container}>

      {/* ── Navbar ────────────────────────────────────────────────────────── */}
      <View style={styles.navbar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.navBack}>
          <Text style={styles.navBackText}>← {isZh ? '返回' : 'Back'}</Text>
        </TouchableOpacity>

        <Text style={styles.navTitle}>{isZh ? '关于' : 'ABOUT'}</Text>

        <LanguageToggle size="sm" />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ── Hero ────────────────────────────────────────────────────── */}
          <View style={styles.hero}>
            <Text style={styles.heroIcon}>易鉴</Text>
            <Text style={styles.heroSub}>I-CHING ORACLE</Text>
            <View style={styles.heroDivider} />
            <Text style={styles.versionBadge}>v{APP_VERSION}</Text>
          </View>

          {/* ── Mission ─────────────────────────────────────────────────── */}
          <SectionCard>
            <SectionTitle>
              {isZh ? '使命宣言' : 'MISSION'}
            </SectionTitle>
            <Divider />
            {isZh ? (
              <>
                <Text style={styles.bodyText}>
                  易鉴将数千年的《易经》智慧与现代人工智能技术相融合，为当代用户提供直观、深刻的占卜体验。
                </Text>
                <Text style={[styles.bodyText, styles.bodyTextSpaced]}>
                  我们相信古老的智慧不应随时间消逝，而应以崭新的形式照亮现代人的内心。
                  易鉴的每一次占卜，都是一次与自我内心的深刻对话。
                </Text>
                <Text style={[styles.bodyText, styles.bodyTextSpaced]}>
                  无论您面临事业、感情、健康还是人生的十字路口，易鉴都将以客观、中立的方式，
                  引导您倾听内心最真实的声音。
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.bodyText}>
                  易鉴 bridges millennia of I-Ching wisdom with modern technology, giving contemporary
                  users an intuitive and deeply personal divination experience.
                </Text>
                <Text style={[styles.bodyText, styles.bodyTextSpaced]}>
                  Ancient insight should not be lost to time — it should be rekindled in new forms
                  that speak to the modern mind. Every cast in 易鉴 is a conversation with your
                  deeper self.
                </Text>
                <Text style={[styles.bodyText, styles.bodyTextSpaced]}>
                  Whether you face a career crossroads, a matter of the heart, or simply seek
                  clarity, 易鉴 guides you toward your own inner wisdom — never imposing, always
                  illuminating.
                </Text>
              </>
            )}
          </SectionCard>

          {/* ── How it works ────────────────────────────────────────────── */}
          <SectionCard>
            <SectionTitle>
              {isZh ? '占卜原理' : 'HOW IT WORKS'}
            </SectionTitle>
            <Divider />
            {[
              {
                num: '一',
                en:  'Three Coin Method — shake or tap to cast each of the six lines using the classical three-coin oracle.',
                zh:  '三枚铜钱法 — 通过摇动或点击铜钱，以传统三铜钱法依次起出六爻。',
              },
              {
                num: '二',
                en:  'King Wen Sequence — all 64 hexagrams drawn from the Zhou Yi (周易), the foundational I-Ching text.',
                zh:  '文王序列 — 六十四卦均源自《周易》，以文王卦序排列，遵循最正统的易学传承。',
              },
              {
                num: '三',
                en:  'Changing Lines — when a line changes, a transformed hexagram is revealed, showing the direction of movement.',
                zh:  '变爻解析 — 当爻发生变化，变卦将揭示当前局势的演变方向与未来走势。',
              },
              {
                num: '四',
                en:  'Deep Analysis (Premium) — six life categories with actionable guidance for Career, Romance, Health, Travel, Business and Decision Making.',
                zh:  '六类深度解读（高级版）— 涵盖事业、感情、健康、出行、商业与决策六大生活维度的深度洞见与具体行动建议。',
              },
            ].map(item => (
              <View key={item.num} style={styles.howRow}>
                <Text style={styles.howNum}>{item.num}</Text>
                <Text style={styles.howText}>{isZh ? item.zh : item.en}</Text>
              </View>
            ))}
          </SectionCard>

          {/* ── Developer ───────────────────────────────────────────────── */}
          <SectionCard>
            <SectionTitle>
              {isZh ? '开发者' : 'DEVELOPER'}
            </SectionTitle>
            <Divider />

            <View style={styles.developerRow}>
              <View style={styles.developerBadge}>
                <Text style={styles.developerInitial}>
                  {DEVELOPER.charAt(0)}
                </Text>
              </View>
              <View style={styles.developerInfo}>
                <Text style={styles.developerName}>{DEVELOPER}</Text>
                <Text style={styles.developerDetail}>{MAJOR}</Text>
                <Text style={styles.developerDetail}>{SCHOOL}</Text>
              </View>
            </View>

            <Divider />

            <Text style={styles.developerBio}>
              {isZh
                ? '作为一名计算机科学学生，我将对东方哲学的热爱与技术能力相结合，'
                  + '致力于用现代方式传承中华传统文化的精髓。'
                  + '易鉴是古今智慧融合的一次真诚实践。'
                : 'As a Computer Science student with a deep appreciation for Eastern philosophy, '
                  + 'I built 易鉴 to bridge ancient Chinese wisdom and modern technology. '
                  + 'This app is a sincere attempt to make the I-Ching accessible, '
                  + 'beautiful, and meaningful for a contemporary audience.'}
            </Text>

            <TouchableOpacity
              style={styles.contactButton}
              onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`)}
              activeOpacity={0.75}
            >
              <Text style={styles.contactButtonText}>
                {isZh ? '✉ 联系开发者' : '✉ Contact Developer'}
              </Text>
            </TouchableOpacity>
          </SectionCard>

          {/* ── Tech stack ──────────────────────────────────────────────── */}
          <SectionCard>
            <SectionTitle>
              {isZh ? '技术栈' : 'BUILT WITH'}
            </SectionTitle>
            <Divider />
            <View style={styles.techGrid}>
              {[
                'React Native', 'Expo', 'SQLite', 'AsyncStorage',
                'Zhou Yi (周易)', 'Three-Coin Method',
              ].map(tech => (
                <View key={tech} style={styles.techPill}>
                  <Text style={styles.techPillText}>{tech}</Text>
                </View>
              ))}
            </View>
          </SectionCard>

          {/* ── Legal footer ────────────────────────────────────────────── */}
          <View style={styles.legalFooter}>
            <Text style={styles.legalText}>
              {isZh
                ? `© ${new Date().getFullYear()} ${DEVELOPER}. 保留所有权利。`
                : `© ${new Date().getFullYear()} ${DEVELOPER}. All rights reserved.`}
            </Text>
            <Text style={styles.legalText}>
              {isZh
                ? '本应用仅供娱乐与反思之用，不构成任何专业建议。'
                : 'For entertainment and self-reflection only. Not professional advice.'}
            </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Disclaimer')}>
              <Text style={styles.legalLink}>
                {isZh ? '查看完整免责声明 →' : 'View full disclaimer →'}
              </Text>
            </TouchableOpacity>
          </View>

        </Animated.View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  // ── Navbar
  navbar: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingTop:        Platform.OS === 'ios' ? 56 : 36,
    paddingBottom:     12,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.goldDim,
    backgroundColor:   COLORS.background,
  },
  navBack:     { padding: 4, minWidth: 70 },
  navBackText: { fontFamily: FONTS.caption, fontSize: 13, color: COLORS.gold, letterSpacing: 0.5 },
  navTitle:    { fontFamily: FONTS.caption, fontSize: 11, color: COLORS.goldMuted, letterSpacing: 4 },

  // ── Scroll
  scrollContent: { paddingHorizontal: SPACING.lg, paddingBottom: 60 },

  // ── Hero
  hero: {
    alignItems:    'center',
    paddingTop:    SPACING.xl,
    paddingBottom: SPACING.lg,
  },
  heroIcon: {
    fontFamily:    FONTS.display,
    fontSize:      56,
    color:         COLORS.gold,
    letterSpacing: 14,
    lineHeight:    68,
  },
  heroSub: {
    fontFamily:    FONTS.caption,
    fontSize:      11,
    color:         COLORS.goldMuted,
    letterSpacing: 6,
    marginTop:     -4,
  },
  heroDivider: {
    width:           60,
    height:          1,
    backgroundColor: COLORS.goldDim,
    marginVertical:  SPACING.md,
    opacity:         0.5,
  },
  versionBadge: {
    fontFamily:       FONTS.caption,
    fontSize:         11,
    color:            COLORS.goldDim,
    letterSpacing:    2,
    borderWidth:      1,
    borderColor:      COLORS.goldDim,
    borderRadius:     6,
    paddingVertical:  4,
    paddingHorizontal: SPACING.sm,
    opacity:          0.7,
  },

  // ── Cards
  card: {
    backgroundColor: COLORS.surface,
    borderRadius:    14,
    borderWidth:     1,
    borderColor:     COLORS.goldDim,
    padding:         SPACING.lg,
    marginBottom:    SPACING.md,
  },

  sectionTitle: {
    fontFamily:    FONTS.caption,
    fontSize:      9,
    color:         COLORS.goldMuted,
    letterSpacing: 4,
    marginBottom:  SPACING.sm,
    textTransform: 'uppercase',
  },

  divider: {
    height:          1,
    backgroundColor: COLORS.goldDim,
    opacity:         0.3,
    marginBottom:    SPACING.md,
  },

  // ── Body text
  bodyText: {
    fontFamily: FONTS.body,
    fontSize:   14,
    color:      COLORS.textSecondary,
    lineHeight: 22,
  },
  bodyTextSpaced: { marginTop: SPACING.sm },

  // ── How it works
  howRow: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    marginBottom:  SPACING.md,
  },
  howNum: {
    fontFamily:    FONTS.display,
    fontSize:      18,
    color:         COLORS.gold,
    width:         28,
    marginTop:     -2,
    letterSpacing: 1,
  },
  howText: {
    flex:       1,
    fontFamily: FONTS.body,
    fontSize:   13,
    color:      COLORS.textSecondary,
    lineHeight: 20,
  },

  // ── Developer card
  developerRow: {
    flexDirection: 'row',
    alignItems:    'center',
    marginBottom:  SPACING.md,
  },
  developerBadge: {
    width:           52,
    height:          52,
    borderRadius:    26,
    backgroundColor: COLORS.gold + '22',
    borderWidth:     1.5,
    borderColor:     COLORS.gold,
    alignItems:      'center',
    justifyContent:  'center',
    marginRight:     SPACING.md,
  },
  developerInitial: {
    fontFamily: FONTS.display,
    fontSize:   22,
    color:      COLORS.gold,
  },
  developerInfo: { flex: 1 },
  developerName: {
    fontFamily:    FONTS.display,
    fontSize:      18,
    color:         COLORS.text,
    letterSpacing: 1,
    marginBottom:  2,
  },
  developerDetail: {
    fontFamily:    FONTS.body,
    fontSize:      12,
    color:         COLORS.textSecondary,
    lineHeight:    18,
  },
  developerBio: {
    fontFamily: FONTS.body,
    fontSize:   13,
    color:      COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: SPACING.md,
  },
  contactButton: {
    alignSelf:        'flex-start',
    borderWidth:      1,
    borderColor:      COLORS.goldDim,
    borderRadius:     8,
    paddingVertical:  8,
    paddingHorizontal: SPACING.md,
  },
  contactButtonText: {
    fontFamily:    FONTS.caption,
    fontSize:      12,
    color:         COLORS.goldMuted,
    letterSpacing: 0.5,
  },

  // ── Tech stack
  techGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           SPACING.sm,
  },
  techPill: {
    backgroundColor:  COLORS.gold + '15',
    borderRadius:     6,
    borderWidth:      1,
    borderColor:      COLORS.goldDim,
    paddingVertical:  5,
    paddingHorizontal: SPACING.sm,
  },
  techPillText: {
    fontFamily:    FONTS.caption,
    fontSize:      10,
    color:         COLORS.goldMuted,
    letterSpacing: 0.5,
  },

  // ── Legal footer
  legalFooter: {
    alignItems:   'center',
    paddingBottom: SPACING.lg,
    gap:           SPACING.xs,
  },
  legalText: {
    fontFamily:    FONTS.caption,
    fontSize:      9,
    color:         COLORS.textSecondary,
    textAlign:     'center',
    letterSpacing: 0.5,
    opacity:       0.5,
  },
  legalLink: {
    fontFamily:    FONTS.caption,
    fontSize:      10,
    color:         COLORS.goldDim,
    letterSpacing: 0.5,
    marginTop:     SPACING.xs,
    textDecorationLine: 'underline',
  },
});
