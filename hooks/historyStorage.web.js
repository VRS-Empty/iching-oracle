/**
 * hooks/historyStorage.web.js — web implementation
 * ─────────────────────────────────────────────────────────────────────────────
 * Same interface and same row shape as historyStorage.js, backed by
 * AsyncStorage (localStorage on web) instead of SQLite.
 *
 * Why not expo-sqlite here: its web build runs wa-sqlite in a Worker and the
 * synchronous API — which useHistory uses — reaches that Worker through
 * `Atomics.wait` on a SharedArrayBuffer. SharedArrayBuffer only exists in a
 * cross-origin isolated context, so it requires the host to send
 *
 *     Cross-Origin-Opener-Policy: same-origin
 *     Cross-Origin-Embedder-Policy: require-corp
 *
 * Without them `new SharedArrayBuffer()` throws, and because the call sits
 * inside a React effect the throw takes down the whole tree — a blank page,
 * not a broken history list. GitHub Pages and most simple static hosts cannot
 * set those headers, so binding the web build to them would decide where the
 * app may be deployed. A few hundred history rows in localStorage costs
 * nothing and works everywhere.
 *
 * The trade-off: localStorage is synchronous, string-only, and capped around
 * 5 MB per origin. Each row is well under 1 KB, so the cap is thousands of
 * casts — far beyond what this feature accumulates.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@iching_oracle:history_v1';

async function readAll() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or unreadable storage should cost the user their history, not
    // the screen that renders it.
    return [];
  }
}

async function writeAll(rows) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    /* quota exceeded or storage disabled — in-memory state still updated */
  }
}

/** Every stored cast, newest first — matching the SQLite ORDER BY. */
export async function loadRows() {
  const rows = await readAll();
  return rows.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
}

/**
 * Persists one cast, mirroring SQLite's INSERT OR IGNORE: an existing
 * session_id is left untouched rather than duplicated or overwritten.
 *
 * @returns {Promise<boolean>} whether a new row was written
 */
export async function insertRow(row) {
  const rows = await readAll();
  if (rows.some(existing => existing.session_id === row.session_id)) {
    return false;
  }
  rows.unshift(row);
  await writeAll(rows);
  return true;
}

export async function deleteRow(sessionId) {
  const rows = await readAll();
  await writeAll(rows.filter(row => row.session_id !== sessionId));
}

export async function clearRows() {
  await writeAll([]);
}
