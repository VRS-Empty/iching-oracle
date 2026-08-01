/**
 * hooks/historyStorage.js — native implementation
 * ─────────────────────────────────────────────────────────────────────────────
 * Row-level persistence for divination history, backed by expo-sqlite.
 *
 * This is the storage layer only; useHistory owns the React state and the
 * re-joining of hexagram content. Metro picks historyStorage.web.js instead
 * when bundling for web, because expo-sqlite's synchronous web API requires
 * SharedArrayBuffer — which needs cross-origin isolation (COOP/COEP headers)
 * that most static hosts do not send. Rather than constrain where the web
 * build can be deployed, the web file stores the same rows in AsyncStorage.
 *
 * Both files expose the same async interface and the same row shape, so
 * useHistory and reconstructResult are platform-agnostic.
 *
 * Row shape (unchanged from the original schema):
 *   session_id, timestamp, original_hex_num, transformed_hex_num,
 *   line_values, changing_indices, orig_polarities, trans_polarities, question
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as SQLite from 'expo-sqlite';

const DB_NAME = 'history_v2.db';
const TABLE = 'cast_history';

// One connection shared across all hook instances, opened lazily. The
// CREATE TABLE is idempotent.
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

/** Every stored cast, newest first. */
export async function loadRows() {
  return getDB().getAllSync(`SELECT * FROM ${TABLE} ORDER BY timestamp DESC`) ?? [];
}

/**
 * Persists one cast. Existing session_ids are left untouched, so calling this
 * twice for the same cast is a no-op rather than a duplicate or an overwrite.
 *
 * @returns {Promise<boolean>} whether a new row was written
 */
export async function insertRow(row) {
  const result = getDB().runSync(
    `INSERT OR IGNORE INTO ${TABLE}
       (session_id, timestamp, original_hex_num, transformed_hex_num,
        line_values, changing_indices, orig_polarities, trans_polarities,
        question)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.session_id,
      row.timestamp,
      row.original_hex_num,
      row.transformed_hex_num,
      row.line_values,
      row.changing_indices,
      row.orig_polarities,
      row.trans_polarities,
      row.question,
    ],
  );
  return (result?.changes ?? 0) > 0;
}

export async function deleteRow(sessionId) {
  getDB().runSync(`DELETE FROM ${TABLE} WHERE session_id = ?`, [sessionId]);
}

export async function clearRows() {
  getDB().execSync(`DELETE FROM ${TABLE}`);
}
