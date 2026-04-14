/**
 * theme.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Design tokens for I-Ching Oracle.
 * Dark Mode by default. Gold accent system. Serif/display type pairing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const COLORS = {
  // ── Backgrounds
  background:  '#000000',
  surface:     '#0D0D0D',
  surfaceHigh: '#141414',
  surfaceDim:  '#222222',

  // ── Gold accent system
  gold:        '#D4AF37',   // Primary gold — headings, active elements
  goldMuted:   '#A88B20',   // Secondary gold — subtitles, labels
  goldDim:     '#5A4810',   // Tertiary gold — borders, dividers
  changing:    '#E8A020',   // Amber — used for changing lines (6 and 9)
  accent:      '#8B5CF6',   // Deep violet — premium highlights

  // ── Text
  text:          '#F0E6C8', // Warm off-white — body text
  textSecondary: '#8A7A60', // Muted tan — secondary body text
  textDim:       '#4A4030', // Near-invisible — placeholders

  // ── Semantic
  success:  '#4CAF50',
  warning:  '#E8A020',
  error:    '#CF6679',
  info:     '#64B5F6',

  // ── Utility
  transparent: 'transparent',
  white:       '#FFFFFF',
  black:       '#000000',
};

/**
 * Font families.
 * In production, load these via expo-font:
 *
 * Display:    "Noto Serif SC" or "Ma Shan Zheng" (supports Chinese glyphs)
 * Body:       "Crimson Pro" or "EB Garamond" (old-style serif for English)
 * Caption:    "Cinzel" or "Cormorant SC" (small caps for labels)
 *
 * Fallback to system serif if expo-font fails.
 */
export const FONTS = {
  display:    Platform.OS === 'ios' ? 'Georgia' : 'serif',    // Chinese + display
  body:       Platform.OS === 'ios' ? 'Georgia' : 'serif',    // Long-form reading
  bodyItalic: Platform.OS === 'ios' ? 'Georgia' : 'serif',    // Translations, quotes
  caption:    Platform.OS === 'ios' ? 'System'  : 'sans-serif', // Labels, UI chrome
  mono:       Platform.OS === 'ios' ? 'Courier' : 'monospace', // Hex numbers
};

export const SPACING = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
};

export const BORDER_RADIUS = {
  sm: 6,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const SHADOWS = {
  gold: {
    shadowColor: COLORS.gold,
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  soft: {
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
};

// ── Re-export Platform for theme consumers ──────────────────────────────────
import { Platform } from 'react-native';
export { Platform };
