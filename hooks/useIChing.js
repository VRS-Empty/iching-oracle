/**
 * useIChing.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Core divination hook implementing the authentic "Three Coin Method" (三枚铜钱法).
 *
 * LINE VALUES:
 *   6  → Old Yin  (三阴, 3 Tails)  — Changing, transforms to Yang (—)
 *   7  → Young Yang (二阴一阳, 2T+1H) — Static Yang line (—)
 *   8  → Young Yin  (二阳一阴, 2H+1T) — Static Yin line (- -)
 *   9  → Old Yang (三阳, 3 Heads)   — Changing, transforms to Yin (- -)
 *
 * A hexagram is built from the BOTTOM up across 6 throws.
 * Changing lines (6 or 9) produce a second "Transformed Hexagram" (变卦).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback, useRef } from 'react';
import hexagramData from '../data/hexagrams.json';

// ─── Constants ────────────────────────────────────────────────────────────────

export const LINE_VALUE = {
  OLD_YIN:    6,  // ×  changing → Yang
  YOUNG_YANG: 7,  // —  static Yang
  YOUNG_YIN:  8,  // -- static Yin
  OLD_YANG:   9,  // o  changing → Yin
};

export const DIVINATION_STATES = {
  IDLE:        'IDLE',
  CASTING:     'CASTING',
  ANIMATING:   'ANIMATING',
  COMPLETE:    'COMPLETE',
};

// Binary representation for King Wen sequence lookup
// Each hexagram is 6 bits: bit0 = line1 (bottom), bit5 = line6 (top)
// 0 = Yin (- -), 1 = Yang (—)
const KING_WEN_LOOKUP = {
  // Key: "bottom-to-top binary string" e.g. "111111" = Qian
  '111111': 1,   // ☰☰ Qian (乾)
  '000000': 2,   // ☷☷ Kun (坤)
  '100010': 3,   // ☵☳ Zhun (屯)
  '010001': 4,   // ☶☵ Meng (蒙)
  '111010': 5,   // ☵☰ Xu (需)
  '010111': 6,   // ☰☵ Song (讼)
  '010000': 7,   // ☷☵ Shi (师)
  '000010': 8,   // ☵☷ Bi (比)
  '111011': 9,   // ☴☰ Xiao Xu (小畜)
  '110111': 10,  // ☰☱ Lü (履)
  '111000': 11,  // ☷☰ Tai (泰)
  '000111': 12,  // ☰☷ Pi (否)
  '101111': 13,  // ☰☲ Tong Ren (同人)
  '111101': 14,  // ☲☰ Da You (大有)
  '000100': 15,  // ☷☶ Qian (谦)
  '001000': 16,  // ☳☷ Yu (豫)
  '100110': 17,  // ☱☳ Sui (随)
  '011001': 18,  // ☶☴ Gu (蛊)
  '110000': 19,  // ☷☱ Lin (临)
  '000011': 20,  // ☴☷ Guan (观)
  '100101': 21,  // ☲☳ Shi He (噬嗑)
  '101001': 22,  // ☶☲ Bi (贲)
  '000001': 23,  // ☶☷ Bo (剥)
  '100000': 24,  // ☷☳ Fu (复)
  '100111': 25,  // ☰☳ Wu Wang (无妄)
  '111001': 26,  // ☶☰ Da Xu (大畜)
  '100001': 27,  // ☶☳ Yi (颐)
  '011110': 28,  // ☱☴ Da Guo (大过)
  '010010': 29,  // ☵☵ Kan (坎)
  '101101': 30,  // ☲☲ Li (离)
  '001110': 31,  // ☱☶ Xian (咸)
  '011100': 32,  // ☳☴ Heng (恒)
  '001111': 33,  // ☰☶ Dun (遁)
  '111100': 34,  // ☳☰ Da Zhuang (大壮)
  '000101': 35,  // ☲☷ Jin (晋)
  '101000': 36,  // ☷☲ Ming Yi (明夷)
  '101011': 37,  // ☴☲ Jia Ren (家人)
  '110101': 38,  // ☲☱ Kui (睽)
  '001010': 39,  // ☵☶ Jian (蹇)
  '010100': 40,  // ☳☵ Jie (解)
  '110001': 41,  // ☶☱ Sun (损)
  '100011': 42,  // ☴☳ Yi (益)
  '111110': 43,  // ☱☰ Guai (夬)
  '011111': 44,  // ☰☴ Gou (姤)
  '000110': 45,  // ☱☷ Cui (萃)
  '011000': 46,  // ☷☴ Sheng (升)
  '010110': 47,  // ☱☵ Kun (困)
  '011010': 48,  // ☵☴ Jing (井)
  '101110': 49,  // ☱☲ Ge (革)
  '011101': 50,  // ☲☴ Ding (鼎)
  '001001': 51,  // ☳☳ Zhen (震)
  '100100': 52,  // ☶☶ Gen (艮)
  '001011': 53,  // ☴☶ Jian (渐)
  '110100': 54,  // ☳☱ Gui Mei (归妹)
  '001101': 55,  // ☲☶ Feng (丰)  — corrected
  '101100': 56,  // ☲☶ Lü (旅)
  '011011': 57,  // ☴☴ Xun (巽)
  '110110': 58,  // ☱☱ Dui (兑)
  '010011': 59,  // ☴☵ Huan (涣)
  '110010': 60,  // ☵☱ Jie (节)
  '110011': 61,  // ☴☱ Zhong Fu (中孚)
  '001100': 62,  // ☳☶ Xiao Guo (小过)
  '010101': 63,  // ☵☲ Ji Ji (既济)
  '101010': 64,  // ☲☵ Wei Ji (未济)
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Simulates throwing 3 coins and returns a line value (6, 7, 8, or 9).
 * Each coin: 0 = Tails (Yin = 2pts), 1 = Heads (Yang = 3pts)
 * Weighted to match traditional probabilities:
 *   P(6) = 1/8,  P(7) = 3/8,  P(8) = 3/8,  P(9) = 1/8
 */
function throwThreeCoins() {
  const coins = [
    Math.random() < 0.5 ? 2 : 3, // coin 1
    Math.random() < 0.5 ? 2 : 3, // coin 2
    Math.random() < 0.5 ? 2 : 3, // coin 3
  ];
  return coins[0] + coins[1] + coins[2]; // sum ∈ {6, 7, 8, 9}
}

/**
 * Given a line value, returns its base polarity for hexagram construction.
 * 6 & 8 → Yin (0), 7 & 9 → Yang (1)
 */
function lineValueToPolarity(value) {
  return (value === 7 || value === 9) ? 1 : 0;
}

/**
 * Given a changing line value, returns its transformed polarity.
 * Old Yin (6) → Yang (1), Old Yang (9) → Yin (0)
 * Static lines are unchanged.
 */
function transformedPolarity(value) {
  if (value === LINE_VALUE.OLD_YIN)  return 1; // Yin changes to Yang
  if (value === LINE_VALUE.OLD_YANG) return 0; // Yang changes to Yin
  return lineValueToPolarity(value);
}

/**
 * Converts an array of 6 polarities (bottom→top) to a King Wen lookup key.
 * @param {number[]} polarities - Array of 6 values (0 or 1), index 0 = bottom line
 * @returns {string} e.g. "111111"
 */
function polaritiesToKey(polarities) {
  return polarities.join('');
}

/**
 * Looks up hexagram number from polarities. Falls back to 1 if not found.
 */
function lookupHexagramNumber(polarities) {
  const key = polaritiesToKey(polarities);
  return KING_WEN_LOOKUP[key] ?? 1;
}

/**
 * Retrieves full hexagram data from JSON store.
 */
function getHexagramData(number) {
  return hexagramData.hexagrams.find(h => h.number === number) ?? null;
}

/**
 * Describes a single line in human-readable terms.
 */
export function describeLineValue(value) {
  switch (value) {
    case LINE_VALUE.OLD_YIN:    return { symbol: '×', label: 'Old Yin',    chinese: '老阴', changing: true,  polarity: 'yin'  };
    case LINE_VALUE.YOUNG_YANG: return { symbol: '—', label: 'Young Yang', chinese: '少阳', changing: false, polarity: 'yang' };
    case LINE_VALUE.YOUNG_YIN:  return { symbol: '--', label: 'Young Yin', chinese: '少阴', changing: false, polarity: 'yin'  };
    case LINE_VALUE.OLD_YANG:   return { symbol: 'o', label: 'Old Yang',   chinese: '老阳', changing: true,  polarity: 'yang' };
    default: return null;
  }
}

// ─── Initial State ────────────────────────────────────────────────────────────

const initialState = {
  status:             DIVINATION_STATES.IDLE,
  lineValues:         [],      // Array of 0–6 values (6 = 7|8|9|6), built bottom→top
  currentLineIndex:   -1,      // Which line is being formed (0–5)
  originalHexagram:   null,    // { number, data, polarities }
  transformedHexagram: null,   // { number, data, polarities } — null if no changing lines
  changingLineIndices: [],      // Indices (0-based) of changing lines
  sessionId:          null,    // Unique ID for history tracking
  error:              null,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useIChing() {
  const [state, setState] = useState(initialState);
  const castingRef = useRef(false); // Prevents concurrent casts

  /**
   * Generates a complete hexagram cast asynchronously,
   * yielding control between each line to allow animation.
   * @param {Function} onLineFormed - Called after each line with (lineIndex, lineValue)
   * @returns {Promise<DivinationResult>}
   */
  const castHexagram = useCallback(async (onLineFormed) => {
    if (castingRef.current) return null;
    castingRef.current = true;

    // Reset and enter casting state
    setState(prev => ({
      ...initialState,
      status: DIVINATION_STATES.CASTING,
      sessionId: `cast_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    }));

    const lineValues = [];

    // ── Throw 6 times (bottom → top) ─────────────────────────────────────────
    for (let i = 0; i < 6; i++) {
      // Small yield so React can re-render between lines
      await new Promise(resolve => setTimeout(resolve, 0));

      const value = throwThreeCoins();
      lineValues.push(value);

      setState(prev => ({
        ...prev,
        currentLineIndex: i,
        lineValues: [...lineValues],
      }));

      // Notify caller for animation / haptics
      if (typeof onLineFormed === 'function') {
        onLineFormed(i, value);
      }
    }

    // ── Derive hexagrams ──────────────────────────────────────────────────────

    const originalPolarities  = lineValues.map(lineValueToPolarity);
    const transformedPolarities = lineValues.map(transformedPolarity);

    const hasChangingLines = lineValues.some(
      v => v === LINE_VALUE.OLD_YIN || v === LINE_VALUE.OLD_YANG
    );

    const changingLineIndices = lineValues
      .map((v, i) => ((v === LINE_VALUE.OLD_YIN || v === LINE_VALUE.OLD_YANG) ? i : -1))
      .filter(i => i !== -1);

    const originalNumber     = lookupHexagramNumber(originalPolarities);
    const originalData       = getHexagramData(originalNumber);

    let transformedHexagram  = null;
    if (hasChangingLines) {
      const transformedNumber = lookupHexagramNumber(transformedPolarities);
      const transformedData   = getHexagramData(transformedNumber);
      transformedHexagram = {
        number:     transformedNumber,
        data:       transformedData,
        polarities: transformedPolarities,
      };
    }

    const result = {
      status:              DIVINATION_STATES.COMPLETE,
      lineValues,
      currentLineIndex:    5,
      originalHexagram:    { number: originalNumber, data: originalData, polarities: originalPolarities },
      transformedHexagram,
      changingLineIndices,
      sessionId: `cast_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      error: null,
    };

    setState(result);
    castingRef.current = false;
    return result;

  }, []);

  /**
   * Resets the oracle back to idle state.
   */
  const reset = useCallback(() => {
    castingRef.current = false;
    setState(initialState);
  }, []);

  /**
   * Convenience selector: is the oracle ready to accept a new cast?
   */
  const isReady = state.status === DIVINATION_STATES.IDLE;

  /**
   * Convenience selector: is a cast in progress?
   */
  const isCasting = state.status === DIVINATION_STATES.CASTING;

  /**
   * Returns changing line details for premium display.
   * Each entry: { lineIndex, lineValue, description, originalLine, changingLine }
   */
  const getChangingLineDetails = useCallback(() => {
    if (!state.lineValues.length) return [];
    return state.changingLineIndices.map(i => ({
      lineIndex:    i,
      lineNumber:   i + 1,             // 1-indexed for display
      lineValue:    state.lineValues[i],
      description:  describeLineValue(state.lineValues[i]),
      lineText:     state.originalHexagram?.data?.lines?.[i] ?? null,
    }));
  }, [state]);

  return {
    // State
    ...state,

    // Actions
    castHexagram,
    reset,

    // Derived
    isReady,
    isCasting,
    getChangingLineDetails,

    // Utilities (exposed for UI rendering)
    describeLineValue,
    LINE_VALUE,
  };
}

export default useIChing;
