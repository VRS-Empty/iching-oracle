/**
 * components/LanguageToggle.js
 * ─────────────────────────────────────────────────────────────────────────────
 * An animated pill toggle that switches between 中文 and EN.
 *
 * Design:
 *   ┌──────────────────────┐
 *   │  中文  │  EN          │   ← pill slides between the two labels
 *   └──────────────────────┘
 *
 * The active side gets a gold fill; the inactive side is transparent.
 * A spring animation slides the indicator on toggle.
 *
 * Props:
 *   size?     'sm' | 'md' (default 'md')
 *   style?    ViewStyle — outer container override
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useLanguage, LANG } from '../context/LanguageContext';
import { COLORS, FONTS, SPACING } from '../constants/theme';

// ─── Size variants ────────────────────────────────────────────────────────────

const SIZES = {
  sm: { pillW: 72,  pillH: 26, fontSize: 10, borderRadius: 13 },
  md: { pillW: 96,  pillH: 32, fontSize: 12, borderRadius: 16 },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function LanguageToggle({ size = 'md', style }) {
  const { language, toggleLanguage, isZh } = useLanguage();
  const dim = SIZES[size] ?? SIZES.md;

  // The sliding indicator's X position:
  //   isZh → 0 (left, 中文 side)
  //   isEn → dim.pillW / 2 (right, EN side)
  const slideX = useRef(new Animated.Value(isZh ? 0 : dim.pillW / 2)).current;

  useEffect(() => {
    Animated.spring(slideX, {
      toValue:         isZh ? 0 : dim.pillW / 2,
      tension:         180,
      friction:        14,
      useNativeDriver: true,
    }).start();
  }, [isZh, dim.pillW]);

  const handlePress = useCallback(async () => {
    await Haptics.selectionAsync();
    toggleLanguage();
  }, [toggleLanguage]);

  const halfW = dim.pillW / 2;

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.85}
      accessibilityRole="switch"
      accessibilityLabel={isZh ? 'Switch to English' : '切换到中文'}
      accessibilityState={{ checked: isZh }}
      style={[
        styles.container,
        {
          width:        dim.pillW,
          height:       dim.pillH,
          borderRadius: dim.borderRadius,
        },
        style,
      ]}
    >
      {/* ── Sliding gold indicator ─────────────────────────────────────── */}
      <Animated.View
        style={[
          styles.indicator,
          {
            width:        halfW,
            height:       dim.pillH - 4,
            borderRadius: dim.borderRadius - 2,
            transform:    [{ translateX: slideX }],
          },
        ]}
      />

      {/* ── 中文 label ──────────────────────────────────────────────────── */}
      <View style={[styles.label, { width: halfW }]}>
        <Text
          style={[
            styles.labelText,
            { fontSize: dim.fontSize },
            isZh && styles.labelTextActive,
          ]}
        >
          中文
        </Text>
      </View>

      {/* ── EN label ────────────────────────────────────────────────────── */}
      <View style={[styles.label, { width: halfW }]}>
        <Text
          style={[
            styles.labelText,
            { fontSize: dim.fontSize },
            !isZh && styles.labelTextActive,
          ]}
        >
          EN
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: COLORS.surface,
    borderWidth:     1,
    borderColor:     COLORS.goldDim,
    overflow:        'hidden',
    position:        'relative',
  },

  indicator: {
    position:        'absolute',
    top:             2,
    left:            2,
    backgroundColor: COLORS.gold,
    // Gold shadow on iOS only (Android elevation doesn't mix well with overflow:hidden)
    ...Platform.select({
      ios: {
        shadowColor:   COLORS.gold,
        shadowOpacity: 0.5,
        shadowRadius:  6,
        shadowOffset:  { width: 0, height: 0 },
      },
    }),
  },

  label: {
    alignItems:  'center',
    justifyContent: 'center',
    zIndex:      1, // stays above indicator so text is tappable
  },

  labelText: {
    fontFamily: FONTS.caption,
    color:      COLORS.goldDim,
    letterSpacing: 0.5,
    fontWeight: '600',
  },

  labelTextActive: {
    color: COLORS.background, // dark text on gold pill
  },
});
