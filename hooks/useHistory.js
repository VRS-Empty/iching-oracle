/**
 * hooks/useHistory.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Persists and retrieves divination history using expo-sqlite v14.
 *
 * Storage strategy:
 *   Only the minimal data needed to reconstruct a full result is stored —
 *   hexagram *numbers*, line values, and polarities. Full hexagram content
 *   (judgment, image, premium categories, etc.) is always re-joined from
 *   hexagrams.json at read time. This keeps the DB small and ensures content
 *   updates to the JSON are immediately reflected in history items.
 *
 * Schema:
 *   cast_history (
 *     session_id          TEXT PRIMARY KEY  — from useIChing sessionId
 *     timestamp           INTEGER NOT NULL  — Unix ms, for sorting
 *     original_hex_num    INTEGER NOT NULL  — 1–64
 *     transformed_hex_num INTEGER           — null if no changing lines
 *     line_values         TEXT NOT NULL     — JSON [6,7,8,9,...]
 *     changing_indices    TEXT NOT NULL     — JSON [0,3,...] (0-based)
 *     orig_polarities     TEXT NOT NULL     — JSON [1,0,1,...]
 *     trans_polarities    TEXT              — JSON or null
 *   )
 *
 * Exports:
 *   FREE_HISTORY_LIMIT    — number of records shown to free users
 *   reconstructResult(r)  — turns a DB row into a full result object
 *   useHistory()          — the hook
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback } from 'react';
import * as SQLite from 'expo-sqlite';
import hexagramData from '../data/hexagrams.json';

// ─── Constants ────────────────────────────────────────────────────────────────

export const FREE_HISTORY_LIMIT = 5;
const DB_NAME  = 'history_v2.db';
const TABLE    = 'cast_history';

// ─── Hexagram lookup (module-level cache) ─────────────────────────────────────

const HEX_MAP = new Map(
  hexagramData.hexagrams.map(h => [h.number, h])
);

function findHex(number) {
  return HEX_MAP.get(number) ?? null;
}

// ─── DB singleton ─────────────────────────────────────────────────────────────
// One connection shared across all hook instances. Initialised lazily on first
// call to getDB() and then reused. The CREATE TABLE is idempotent.

let _db = null;

function getDB() {
  if (_db) return _db;

  _db = SQLite.openDatabaseSync(DB_NAME);

  _db.execSync(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      session_id          TEXT PRIMARY KEY,
      timestamp           INTEGER NOT NULL,
      original_hex_num    INTEGER NOT NULL,
      transformed_hex_num INTEGER,
      line_values         TEXT    NOT NULL,
      changing_indices    TEXT    NOT NULL,
      orig_polarities     TEXT    NOT NULL,
      trans_polarities    TEXT,
      question            TEXT
    );
  `);

  // Index for chronological queries (DESC sort is the common path)
  _db.execSync(`
    CREATE INDEX IF NOT EXISTS idx_cast_history_ts
    ON ${TABLE} (timestamp DESC);
  `);

  return _db;
}

// ─── Reconstruct ──────────────────────────────────────────────────────────────

/**
 * Turns a raw DB row back into the full `result` object that ResultScreen
 * expects. Re-joins hexagram content from hexagrams.json.
 *
 * @param {object} row  — row returned by getAllSync / getFirstSync
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
 *   records:    object[],   — raw DB rows, newest first
 *   totalCount: number,     — total records in DB
 *   isLoading:  boolean,
 *   error:      string | null,
 *   saveCast:   (result: DivinationResult) => void,
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

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(() => {
    setIsLoading(true);
    setError(null);
    try {
      const db   = getDB();
      const rows = db.getAllSync(`SELECT * FROM ${TABLE} ORDER BY timestamp DESC`);
      setRecords(rows ?? []);
      setTotalCount(rows?.length ?? 0);
    } catch (e) {
      console.error('[useHistory] load error:', e);
      setError(e.message ?? 'Unknown error loading history');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Save ────────────────────────────────────────────────────────────────────

  /**
   * Persists a completed divination result. Safe to call multiple times with
   * the same result — INSERT OR IGNORE prevents duplicates by session_id.
   *
   * @param {DivinationResult} result   — from useIChing.castHexagram()
   * @param {string}           question — user's focus question; defaults to
   *                                      "General Inquiry" / "起卦问事" if blank
   */
  const saveCast = useCallback((result, question) => {
    if (!result?.sessionId || !result?.originalHexagram?.data) {
      console.warn('[useHistory] saveCast: invalid result, skipping');
      return;
    }

    // Normalise: trim whitespace; fall back to bilingual default
    const normalised = typeof question === 'string' && question.trim().length > 0
      ? question.trim()
      : 'General Inquiry · 起卦问事';

    try {
      const db = getDB();
      const { originalHexagram, transformedHexagram, lineValues, changingLineIndices } = result;

      db.runSync(
        `INSERT OR IGNORE INTO ${TABLE}
           (session_id, timestamp, original_hex_num, transformed_hex_num,
            line_values, changing_indices, orig_polarities, trans_polarities,
            question)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.sessionId,
          Date.now(),
          originalHexagram.number,
          transformedHexagram?.number ?? null,
          JSON.stringify(lineValues),
          JSON.stringify(changingLineIndices),
          JSON.stringify(originalHexagram.polarities),
          transformedHexagram
            ? JSON.stringify(transformedHexagram.polarities)
            : null,
          normalised,
        ]
      );

      // Update in-memory state without a full reload
      setRecords(prev => {
        const alreadyExists = prev.some(r => r.session_id === result.sessionId);
        if (alreadyExists) return prev;
        const newRow = {
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
        return [newRow, ...prev];
      });
      setTotalCount(c => c + 1);
    } catch (e) {
      console.error('[useHistory] saveCast error:', e);
    }
  }, []);

  // ── Delete ──────────────────────────────────────────────────────────────────

  const deleteCast = useCallback((sessionId) => {
    try {
      getDB().runSync(`DELETE FROM ${TABLE} WHERE session_id = ?`, [sessionId]);
      setRecords(prev => prev.filter(r => r.session_id !== sessionId));
      setTotalCount(c => Math.max(0, c - 1));
    } catch (e) {
      console.error('[useHistory] deleteCast error:', e);
    }
  }, []);

  // ── Clear all ───────────────────────────────────────────────────────────────

  const clearAll = useCallback(() => {
    try {
      getDB().execSync(`DELETE FROM ${TABLE}`);
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
