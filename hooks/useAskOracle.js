/**
 * hooks/useAskOracle.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Asks the backend a natural-language question about a cast hexagram.
 *
 * Architecture mirrors usePremium: module-level singletons hold the device
 * identity and the quota mirror, so every hook instance shares one copy without
 * a Context wrapper, and a question asked on one screen updates the counter
 * shown on another.
 *
 *   deviceStore — a stable per-install id, generated once and persisted. The
 *                 backend meters daily allowances against it.
 *   quotaStore  — a LOCAL MIRROR of the allowance, so the UI can show
 *                 "2 left today" without a round trip. The backend is the
 *                 authority: every response overwrites this, and editing it
 *                 buys nothing because the server checks independently.
 *
 * Both reset at 00:00 UTC, matching the backend's day boundary — using device
 * local time here would make the counter disagree with the server for anyone
 * not on UTC.
 *
 * Usage:
 *   const { ask, answer, isLoading, error, remaining, dailyLimit } = useAskOracle();
 *   await ask({ hexagramId: 49, changingLines: [4], question: '...' });
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ASK_ENDPOINT, REQUEST_TIMEOUT_MS, MAX_QUESTION_CHARS } from '../constants/api';
import { usePremium } from './usePremium';
import { useLanguage } from '../context/LanguageContext';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEVICE_ID_KEY = '@iching_oracle:device_id_v1';
const QUOTA_KEY     = '@iching_oracle:ask_quota_v1';

// Kept in step with FREE_DAILY_LIMIT / PREMIUM_DAILY_LIMIT in the backend's
// config.py. Used only for the pre-flight display; the server decides.
export const FREE_DAILY_ASKS    = 3;
export const PREMIUM_DAILY_ASKS = 20;

/** UTC day key — must match the backend's `_today()` or the counters diverge. */
function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Device identity ──────────────────────────────────────────────────────────

function generateDeviceId() {
  // Same shape as useIChing's sessionId. This is a metering handle, not a
  // security token — the server treats it as untrusted input either way.
  const random = () => Math.random().toString(36).slice(2, 10);
  return `dev_${Date.now().toString(36)}_${random()}${random()}`;
}

let _deviceId = null;
let _deviceIdPromise = null;

async function getDeviceId() {
  if (_deviceId) return _deviceId;
  // Concurrent callers must not each mint a different id.
  if (!_deviceIdPromise) {
    _deviceIdPromise = (async () => {
      try {
        const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
        if (stored) return stored;
        const fresh = generateDeviceId();
        await AsyncStorage.setItem(DEVICE_ID_KEY, fresh);
        return fresh;
      } catch {
        // Storage unavailable: fall back to an in-memory id. The user gets a
        // fresh allowance next launch, which is preferable to a hard failure.
        return generateDeviceId();
      }
    })();
  }
  _deviceId = await _deviceIdPromise;
  return _deviceId;
}

// ─── Quota mirror ─────────────────────────────────────────────────────────────

const _listeners = new Set();
let _quota = { date: utcToday(), remaining: null, limit: null };

function notify() {
  _listeners.forEach(fn => fn(_quota));
}

export const askQuotaStore = {
  get state() { return _quota; },

  subscribe(fn) { _listeners.add(fn); return () => _listeners.delete(fn); },

  async load() {
    try {
      const raw = await AsyncStorage.getItem(QUOTA_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      // A stored entry from a previous UTC day is stale — drop it rather than
      // showing yesterday's exhausted counter.
      if (parsed && parsed.date === utcToday()) {
        _quota = parsed;
      } else {
        _quota = { date: utcToday(), remaining: null, limit: null };
      }
    } catch {
      _quota = { date: utcToday(), remaining: null, limit: null };
    }
    notify();
  },

  /** Records the allowance the backend just reported. */
  async sync({ remaining, limit }) {
    _quota = { date: utcToday(), remaining, limit };
    notify();
    try {
      await AsyncStorage.setItem(QUOTA_KEY, JSON.stringify(_quota));
    } catch { /* in-memory value still updated */ }
  },

  /** Dev helper — clears the local mirror only; the server keeps its count. */
  async devReset() {
    if (__DEV__) {
      _quota = { date: utcToday(), remaining: null, limit: null };
      notify();
      try { await AsyncStorage.removeItem(QUOTA_KEY); } catch { /* ignore */ }
    }
  },
};

askQuotaStore.load();

// ─── Error shaping ────────────────────────────────────────────────────────────
//
// The backend already returns message_zh / message_en for anything it rejects.
// These cover the cases where no response arrives at all, so the user still
// gets a sentence in their own language rather than a raw exception.

const CLIENT_ERRORS = {
  network: {
    zh: '无法连接到神谕服务，请检查网络后重试。',
    en: 'Could not reach the oracle. Check your connection and try again.',
  },
  timeout: {
    zh: '神谕响应超时，请稍后再试。',
    en: 'The oracle took too long to respond. Please try again.',
  },
  empty_question: {
    zh: '请先写下你的问题。',
    en: 'Please write your question first.',
  },
  too_long: {
    zh: `问题请控制在 ${MAX_QUESTION_CHARS} 字以内。`,
    en: `Please keep your question under ${MAX_QUESTION_CHARS} characters.`,
  },
};

function clientError(code) {
  return {
    code,
    messageZh: CLIENT_ERRORS[code].zh,
    messageEn: CLIENT_ERRORS[code].en,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useAskOracle()
 *
 * @returns {{
 *   ask:        (params) => Promise<string|null>,
 *   answer:     string | null,
 *   sources:    object[],
 *   isLoading:  boolean,
 *   error:      { code, message } | null,
 *   remaining:  number | null,   — null until the first response of the day
 *   dailyLimit: number,
 *   isExhausted:boolean,
 *   reset:      () => void,
 * }}
 */
export function useAskOracle() {
  const { isPremium } = usePremium();
  const { isZh } = useLanguage();

  const [answer,    setAnswer]    = useState(null);
  const [sources,   setSources]   = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError]     = useState(null);
  const [quota,     setQuota]     = useState(askQuotaStore.state);

  const inFlight = useRef(false);
  const mounted  = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = askQuotaStore.subscribe(setQuota);
    return () => { mounted.current = false; unsubscribe(); };
  }, []);

  const dailyLimit = quota.limit ?? (isPremium ? PREMIUM_DAILY_ASKS : FREE_DAILY_ASKS);

  /**
   * Sends a question. Resolves with the answer text, or null on failure —
   * inspect `error` for the reason, which is already localised.
   */
  const ask = useCallback(async ({
    hexagramId,
    changingLines = [],
    transformedHexagramId = null,
    question,
    lang,
  }) => {
    if (inFlight.current) return null;

    const trimmed = (question ?? '').trim();
    if (!trimmed) {
      setError(localise(clientError('empty_question'), isZh));
      return null;
    }
    if (trimmed.length > MAX_QUESTION_CHARS) {
      setError(localise(clientError('too_long'), isZh));
      return null;
    }

    inFlight.current = true;
    setIsLoading(true);
    setError(null);
    setAnswer(null);
    setSources([]);

    // AbortController gives the request a ceiling; without it a hung socket
    // leaves the spinner running forever.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const deviceId = await getDeviceId();
      const response = await fetch(ASK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          device_id: deviceId,
          hexagram_id: hexagramId,
          changing_lines: changingLines,
          transformed_hexagram_id: transformedHexagramId,
          question: trimmed,
          lang: lang ?? (isZh ? 'zh' : 'en'),
          is_premium: isPremium,
        }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        // The backend supplies both languages for everything it rejects.
        const failure = body?.error
          ? { code: body.error, messageZh: body.message_zh, messageEn: body.message_en }
          : clientError('network');
        // A quota rejection still carries the authoritative counts.
        if (body?.daily_limit != null) {
          await askQuotaStore.sync({
            remaining: body.remaining_quota ?? 0,
            limit: body.daily_limit,
          });
        }
        if (mounted.current) setError(localise(failure, isZh));
        return null;
      }

      await askQuotaStore.sync({
        remaining: body.remaining_quota,
        limit: body.daily_limit,
      });

      if (mounted.current) {
        setAnswer(body.answer);
        setSources(body.sources ?? []);
      }
      return body.answer;

    } catch (e) {
      const failure = clientError(e?.name === 'AbortError' ? 'timeout' : 'network');
      if (mounted.current) setError(localise(failure, isZh));
      return null;

    } finally {
      clearTimeout(timer);
      inFlight.current = false;
      if (mounted.current) setIsLoading(false);
    }
  }, [isPremium, isZh]);

  const reset = useCallback(() => {
    setAnswer(null);
    setSources([]);
    setError(null);
  }, []);

  return {
    ask,
    answer,
    sources,
    isLoading,
    error,
    remaining: quota.remaining,
    dailyLimit,
    isExhausted: quota.remaining === 0,
    reset,
  };
}

/** Collapses a bilingual failure into the one string the UI will render. */
function localise(failure, isZh) {
  return {
    code: failure.code,
    message: (isZh ? failure.messageZh : failure.messageEn)
      // Fall back across languages rather than rendering an empty error.
      || failure.messageEn || failure.messageZh || '',
  };
}

export default useAskOracle;
