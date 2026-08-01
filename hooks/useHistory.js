/**
 * hooks/useHistory.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Persists and retrieves divination history.
 *
 * Storage strategy:
 *   Only the minimal data needed to reconstruct a full result is stored —
 *   hexagram *numbers*, line values, and polarities. Full hexagram content
 *   (judgment, image, premium categories, etc.) is always re-joined from
 *   hexagrams.json at read time. This keeps storage small and ensures content
 *   updates to the JSON are immediately reflected in history items.
 *
 *   The row store itself lives in ./historyStorage, which Metro resolves
 *   per-platform: expo-sqlite on native, AsyncStorage on web. See
 *   historyStorage.web.js for why web cannot use the SQLite path.
 *
 * Row shape:
 *   session_id          — from useIChing sessionId
 *   timestamp           — Unix ms, for sorting
 *   original_hex_num    — 1–64
 *   transformed_hex_num — null if no changing lines
 *   line_values         — JSON [6,7,8,9,...]
 *   changing_indices    — JSON [0,3,...] (0-based)
 *   orig_polarities     — JSON [1,0,1,...]
 *   trans_polarities    — JSON or null
 *   question            — user's focus question
 *
 * Exports:
 *   FREE_HISTORY_LIMIT    — number of records shown to free users
 *   reconstructResult(r)  — turns a stored row into a full result object
 *   useHistory()          — the hook
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import hexagramData from '../data/hexagrams.json';
import { loadRows, insertRow, deleteRow, clearRows } from './historyStorage';

// ─── Constants ────────────────────────────────────────────────────────────────

export const FREE_HISTORY_LIMIT = 5;

// ─── Hexagram lookup (module-level cache) ─────────────────────────────────────

const HEX_MAP = new Map(
  hexagramData.hexagrams.map(h => [h.number, h])
);

function findHex(number) {
  return HEX_MAP.get(number) ?? null;
}

// ─── Reconstruct ──────────────────────────────────────────────────────────────

/**
 * Turns a raw stored row back into the full `result` object that ResultScreen
 * expects. Re-joins hexagram content from hexagrams.json.
 *
 * @param {object} row  — row returned by the storage layer
 * @returns {DivinationResult | null}
 */
export function reconstructResult(row) {
  if (!row) return null;

  try {
    const lineValues      = JSON.parse(row.line_values);
    const changingIndices = JSON.parse(row.changing_indices);
    const origPolarities  = JSON.parse(row.orig_polarities);
    const transPolarities = row.trans_polarities
      ? JSON.parse(row.trans_polarities) : null;

    const originalData    = findHex(row.original_hex_num);
    const transformedData = row.transformed_hex_num
      ? findHex(row.transformed_hex_num) : null;

    if (!originalData) {
      console.warn(`[useHistory] Hexagram #${row.original_hex_num} not found in JSON`);
      return null;
    }

    return {
      status:              'COMPLETE',
      lineValues,
      currentLineIndex:    5,
      sessionId:           row.session_id,
      changingLineIndices: changingIndices,
      // Graceful fallback for rows saved before the question feature existed
      question:            row.question ?? null,
      error:               null,
      originalHexagram: {
        number:     row.original_hex_num,
        data:       originalData,
        polarities: origPolarities,
      },
      transformedHexagram: (transformedData && transPolarities)
        ? {
            number:     row.transformed_hex_num,
            data:       transformedData,
            polarities: transPolarities,
          }
        : null,
    };
  } catch (e) {
    console.error('[useHistory] reconstructResult error:', e, row);
    return null;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useHistory()
 *
 * @returns {{
 *   records:    object[],   — raw rows, newest first
 *   totalCount: number,     — total records stored
 *   isLoading:  boolean,
 *   error:      string | null,
 *   saveCast:   (result: DivinationResult, question?: string) => void,
 *   deleteCast: (sessionId: string) => void,
 *   clearAll:   () => void,
 *   refresh:    () => void,
 *   reconstructResult: (row: object) => DivinationResult | null,
 * }}
 */
export function useHistory() {
  const [records,    setRecords]    = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading,  setIsLoading]  = useState(true);
  const [error,      setError]      = useState(null);

  // The storage layer is async on every platform, so a resolved load must not
  // write state into an unmounted screen.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const rows = await loadRows();
      if (!mounted.current) return;
      setRecords(rows);
      setTotalCount(rows.length);
    } catch (e) {
      console.error('[useHistory] load error:', e);
      if (mounted.current) setError(e.message ?? 'Unknown error loading history');
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Save ────────────────────────────────────────────────────────────────────

  /**
   * Persists a completed divination result. Safe to call multiple times with
   * the same result — the storage layer ignores a session_id it already has.
   *
   * @param {DivinationResult} result   — from useIChing.castHexagram()
   * @param {string}           question — user's focus question; defaults to
   *                                      "General Inquiry" / "起卦问事" if blank
   */
  const saveCast = useCallback(async (result, question) => {
    if (!result?.sessionId || !result?.originalHexagram?.data) {
      console.warn('[useHistory] saveCast: invalid result, skipping');
      return;
    }

    // Normalise: trim whitespace; fall back to bilingual default
    const normalised = typeof question === 'string' && question.trim().length > 0
      ? question.trim()
      : 'General Inquiry · 起卦问事';

    const { originalHexagram, transformedHexagram, lineValues, changingLineIndices } = result;
    const row = {
      session_id:          result.sessionId,
      timestamp:           Date.now(),
      original_hex_num:    originalHexagram.number,
      transformed_hex_num: transformedHexagram?.number ?? null,
      line_values:         JSON.stringify(lineValues),
      changing_indices:    JSON.stringify(changingLineIndices),
      orig_polarities:     JSON.stringify(originalHexagram.polarities),
      trans_polarities:    transformedHexagram
        ? JSON.stringify(transformedHexagram.polarities) : null,
      question:            normalised,
    };

    try {
      const inserted = await insertRow(row);
      if (!inserted || !mounted.current) return;

      // Update in-memory state without a full reload
      setRecords(prev => (
        prev.some(r => r.session_id === row.session_id) ? prev : [row, ...prev]
      ));
      setTotalCount(c => c + 1);
    } catch (e) {
      console.error('[useHistory] saveCast error:', e);
    }
  }, []);

  // ── Delete ──────────────────────────────────────────────────────────────────

  const deleteCast = useCallback(async (sessionId) => {
    try {
      await deleteRow(sessionId);
      if (!mounted.current) return;
      setRecords(prev => prev.filter(r => r.session_id !== sessionId));
      setTotalCount(c => Math.max(0, c - 1));
    } catch (e) {
      console.error('[useHistory] deleteCast error:', e);
    }
  }, []);

  // ── Clear all ───────────────────────────────────────────────────────────────

  const clearAll = useCallback(async () => {
    try {
      await clearRows();
      if (!mounted.current) return;
      setRecords([]);
      setTotalCount(0);
    } catch (e) {
      console.error('[useHistory] clearAll error:', e);
    }
  }, []);

  return {
    records,
    totalCount,
    isLoading,
    error,
    saveCast,
    deleteCast,
    clearAll,
    refresh: load,
    reconstructResult,   // re-exported for convenience
  };
}

export default useHistory;
