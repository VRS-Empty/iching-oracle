/**
 * constants/api.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Backend endpoint configuration for the Ask-the-Oracle feature.
 *
 * The client holds nothing but this URL. API keys (Anthropic, Voyage) live only
 * in the backend's environment — they are never bundled into the app.
 *
 * ── Pointing at a local backend during development ──────────────────────────
 * `localhost` on a phone means the phone itself, not your computer, so a real
 * device needs your machine's LAN address. Find it with `ipconfig` (Windows) or
 * `ifconfig | grep inet` (macOS), then set DEV_HOST below.
 *
 *   Real device / Expo Go   → your machine's LAN IP, e.g. '192.168.1.42'
 *   Android emulator        → '10.0.2.2' (its alias for the host machine)
 *   iOS simulator           → 'localhost' works
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Platform } from 'react-native';

// ─── Pick ONE of the two dev routes below ────────────────────────────────────
//
// ROUTE 1 — Tunnel. Required when Expo runs with `--tunnel`, because the phone
// then reaches Metro over the internet via ngrok and may not be on your LAN at
// all. Expose the backend the same way and paste the full https URL here:
//
//   cloudflared tunnel --url http://localhost:5000     (no account needed)
//   ngrok http 5000                                    (needs an authtoken)
//
// The URL changes every time the tunnel restarts. Being https also sidesteps
// iOS's plaintext-HTTP restrictions entirely.
const DEV_API_URL = null;   // e.g. 'https://abc-def-123.trycloudflare.com'

// ROUTE 2 — LAN. Works when Expo runs without `--tunnel`, the phone is on the
// same Wi-Fi, and inbound TCP 5000 is allowed through the host firewall.
// `localhost` would resolve to the phone itself, which is why leaving this
// unset surfaces as "无法连接到神谕服务" even with the backend running.
// DHCP-assigned, so it can change when you rejoin the network (`ipconfig`).
const LAN_IP = '192.168.1.102';

const DEV_HOST = LAN_IP ?? Platform.select({
  android: '10.0.2.2',   // Android emulator alias for the host machine
  ios:     'localhost',  // iOS simulator shares the host network stack
  default: 'localhost',
});
const DEV_PORT = 5000;

// ─── Deployed backend (Render) ───────────────────────────────────────────────
const PRODUCTION_URL = 'https://iching-oracle-api.onrender.com';

// A tunnel URL, when set, wins over the LAN host — it is the route that works
// regardless of whether the phone and the host share a network.
export const API_BASE_URL = __DEV__
  ? (DEV_API_URL ?? `http://${DEV_HOST}:${DEV_PORT}`)
  : PRODUCTION_URL;

export const ASK_ENDPOINT = `${API_BASE_URL}/api/ask`;

/**
 * Render's free tier suspends idle instances; the first request after a lull
 * pays a cold start of roughly a minute. The timeout has to clear that, or
 * every morning's first question fails.
 */
export const REQUEST_TIMEOUT_MS = 60000;

/** Mirrors MAX_QUESTION_CHARS in the backend's config.py. */
export const MAX_QUESTION_CHARS = 200;

export default { API_BASE_URL, ASK_ENDPOINT, REQUEST_TIMEOUT_MS, MAX_QUESTION_CHARS };
