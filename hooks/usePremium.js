/**
 * hooks/usePremium.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralised premium-status management hook.
 *
 * Replaces the scattered `const useIsPremium = () => false` mocks in each
 * screen. A single source of truth makes it trivial to swap the mock for real
 * expo-in-app-purchases when you submit to the App Store.
 *
 * Architecture:
 *   • Reads purchase state from AsyncStorage on mount
 *   • Exposes `unlock()` to set premium (called after a successful IAP)
 *   • Exposes `restore()` to re-verify a previous purchase (calls the real
 *     IAP SDK when connected; no-ops gracefully in mock mode)
 *   • Exports a singleton `premiumStore` so all hook instances share state
 *     without a Context wrapper
 *
 * To connect real IAP (after App Store setup):
 *   1. Install: expo install expo-in-app-purchases
 *   2. Uncomment the three TODO blocks below
 *   3. Set PREMIUM_PRODUCT_ID to your actual product identifier
 *
 * DEV tip — unlock premium in the simulator:
 *   import { premiumStore } from '../hooks/usePremium';
 *   premiumStore.devUnlock();    // grants premium until app restart
 *   premiumStore.devLock();      // reverts to free tier
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY         = '@iching_oracle:premium_unlocked_v1';
const PREMIUM_PRODUCT_ID  = 'com.yourcompany.ichingOracle.premium_lifetime';

// ─── Promo-code constants ─────────────────────────────────────────────────────
// SECURITY NOTE: Hard-coding a promo key in a client bundle is intentional here.
// This is a time-limited, non-financial unlock for trusted testers, not a
// substitute for real IAP. The expiry date provides an automatic cut-off.

const PROMO_CODE        = 'DANIEL_VIP_2026';
// Valid for any date strictly before this value (midnight UTC June 1 2026).
const PROMO_EXPIRY      = new Date('2026-06-01T00:00:00Z');
// Separate key so promo unlocks survive next to IAP unlocks independently.
const PROMO_STORAGE_KEY = '@premium_status';

// ─── Module-level singleton ────────────────────────────────────────────────────
// All usePremium() instances subscribe to this store so toggling premium in
// one place (e.g. UpgradeScreen) immediately reflects in ResultScreen.

const _listeners = new Set();
let   _isPremium = false;
let   _isReady   = false;

function notify() {
  _listeners.forEach(fn => fn(_isPremium));
}

export const premiumStore = {
  get isPremium() { return _isPremium; },
  get isReady()   { return _isReady;   },

  async load() {
    try {
      // Check both keys in parallel so either source of truth can unlock premium.
      // This means an IAP purchase and a promo-code redemption are both honoured
      // independently, and neither overwrites the other.
      const [iapStored, promoStored] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(PROMO_STORAGE_KEY),
      ]);
      _isPremium = iapStored === 'true' || promoStored === 'unlocked';
    } catch {
      _isPremium = false;
    }
    _isReady = true;
    notify();
  },

  async persist(value) {
    _isPremium = value;
    notify();
    try {
      await AsyncStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
    } catch { /* silent — in-memory state is still updated */ }
  },

  subscribe(fn)   { _listeners.add(fn);    return () => _listeners.delete(fn); },

  /**
   * Checks AsyncStorage for an existing premium purchase and restores it.
   * Shows a bilingual Alert on success or when no purchase is found.
   *
   * @param {{ isZh?: boolean }} opts  Pass `isZh: true` for Chinese alerts.
   * @returns {Promise<boolean>}       `true` if a purchase was restored.
   */
  async restore({ isZh = false } = {}) {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      const hadPurchase = stored === 'true';

      if (hadPurchase) {
        await this.persist(true);
        Alert.alert(
          isZh ? '恢复成功' : 'Purchases Restored',
          isZh ? '已成功恢复高级版购买。' : 'Your premium purchase has been restored successfully.',
          [{ text: isZh ? '好的' : 'OK' }],
        );
        return true;
      } else {
        Alert.alert(
          isZh ? '未找到购买记录' : 'No Purchase Found',
          isZh
            ? '未找到以前的高级版购买记录。请先完成购买。'
            : 'No previous premium purchase was found. Please complete a purchase first.',
          [{ text: isZh ? '好的' : 'OK' }],
        );
        return false;
      }
    } catch (e) {
      console.error('[premiumStore] restore error:', e);
      return false;
    }
  },

  /**
   * validateAndUnlock(code, { isZh })
   * ─────────────────────────────────────────────────────────────────────────
   * Validates a promo code and, if correct and unexpired, unlocks premium.
   *
   * Validation order:
   *   1. Wrong code  → "Invalid promo code."
   *   2. Right code but past expiry → "This promo code has expired."
   *   3. Both pass   → persist to BOTH storage keys + success Alert.
   *
   * Writing to both keys ensures the unlock is visible whether the app
   * inspects STORAGE_KEY (IAP path) or PROMO_STORAGE_KEY (promo path),
   * and load() on next cold-start will find at least one of them.
   *
   * @param {string}  code
   * @param {{ isZh?: boolean }} opts
   * @returns {Promise<boolean>}  true if unlock succeeded
   */
  async validateAndUnlock(code, { isZh = false } = {}) {
    const trimmed = typeof code === 'string' ? code.trim() : '';

    // ── Step 1: code check ──────────────────────────────────────────────────
    if (trimmed !== PROMO_CODE) {
      Alert.alert(
        isZh ? '无效兑换码' : 'Invalid Code',
        isZh ? '兑换码不正确，请检查后重试。' : 'Invalid promo code.',
        [{ text: isZh ? '好的' : 'OK' }],
      );
      return false;
    }

    // ── Step 2: expiry check ────────────────────────────────────────────────
    if (new Date() >= PROMO_EXPIRY) {
      Alert.alert(
        isZh ? '兑换码已过期' : 'Code Expired',
        isZh
          ? '此兑换码已于 2026 年 5 月 31 日到期，无法继续使用。'
          : 'This promo code has expired.',
        [{ text: isZh ? '好的' : 'OK' }],
      );
      return false;
    }

    // ── Step 3: unlock ──────────────────────────────────────────────────────
    // Update in-memory state immediately so the UI responds at once.
    _isPremium = true;
    notify();

    // Persist to both storage keys in parallel.
    try {
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEY, 'true'),           // IAP-compatible key
        AsyncStorage.setItem(PROMO_STORAGE_KEY, 'unlocked'), // task-specified key
      ]);
    } catch (e) {
      // In-memory state is already true; the next load() will retry.
      console.warn('[premiumStore] promo persist failed:', e);
    }

    Alert.alert(
      isZh ? '解锁成功！' : 'Premium Unlocked! ✦',
      isZh
        ? '高级功能已全部解锁，尽情享用易鉴完整体验。'
        : 'Premium features unlocked! Enjoy.',
      [{ text: isZh ? '好的 ✦' : 'OK ✦' }],
    );
    return true;
  },

  /** Dev-only helpers — call from __DEV__ code blocks */
  devUnlock() { if (__DEV__) this.persist(true);  },
  devLock()   { if (__DEV__) this.persist(false); },
};

// Boot the store once at module evaluation time
premiumStore.load();

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * usePremium()
 *
 * @returns {{
 *   isPremium: boolean,
 *   isLoading: boolean,
 *   unlock:  () => Promise<void>,
 *   restore: () => Promise<void>,
 * }}
 */
export function usePremium() {
  const [isPremium, setIsPremium] = useState(premiumStore.isPremium);
  const [isLoading, setIsLoading] = useState(!premiumStore.isReady);
  const [isRestoring, setIsRestoring] = useState(false);

  // Subscribe to store changes
  useEffect(() => {
    const unsub = premiumStore.subscribe(value => {
      setIsPremium(value);
      setIsLoading(false);
    });
    // In case load() already finished before this component mounted
    if (premiumStore.isReady) {
      setIsPremium(premiumStore.isPremium);
      setIsLoading(false);
    }
    return unsub;
  }, []);

  // ── Purchase ───────────────────────────────────────────────────────────────

  /**
   * Triggers the IAP purchase flow. In mock mode, immediately grants premium.
   * Replace the body with real IAP logic when ready.
   */
  const unlock = useCallback(async () => {
    // ── TODO: Real IAP ──────────────────────────────────────────────────────
    // import * as InAppPurchases from 'expo-in-app-purchases';
    // try {
    //   await InAppPurchases.connectAsync();
    //   await InAppPurchases.purchaseItemAsync(PREMIUM_PRODUCT_ID);
    //   // The purchase listener (set up in App.js) will call premiumStore.persist(true)
    // } catch (e) {
    //   console.error('[usePremium] purchase error:', e);
    // }
    // ── END TODO ────────────────────────────────────────────────────────────

    // MOCK — immediate grant (remove once real IAP is connected)
    await premiumStore.persist(true);
  }, []);

  /**
   * Re-verifies a previous purchase (e.g. after reinstall).
   * Delegates to `premiumStore.restore()` which handles AsyncStorage lookup
   * and shows an Alert for both success and "not found" outcomes.
   *
   * @param {{ isZh?: boolean }} opts  Forward language preference for Alerts.
   * @returns {Promise<boolean>}       `true` if premium was restored.
   */
  const restore = useCallback(async ({ isZh = false } = {}) => {
    if (isRestoring) return false;
    setIsRestoring(true);
    try {
      // ── TODO: Real IAP restore ───────────────────────────────────────────
      // import * as InAppPurchases from 'expo-in-app-purchases';
      // await InAppPurchases.connectAsync();
      // const history = await InAppPurchases.getPurchaseHistoryAsync();
      // const hasPurchase = history.results.some(p => p.productId === PREMIUM_PRODUCT_ID);
      // await premiumStore.persist(hasPurchase);
      // ── END TODO ────────────────────────────────────────────────────────

      return await premiumStore.restore({ isZh });
    } catch (e) {
      console.error('[usePremium] restore error:', e);
      return false;
    } finally {
      setIsRestoring(false);
    }
  }, [isRestoring]);

  /**
   * Validates a promo code and unlocks premium if correct and unexpired.
   * Delegates entirely to premiumStore.validateAndUnlock so all subscribers
   * are notified through the singleton.
   *
   * @param {string} code
   * @param {{ isZh?: boolean }} opts  Pass language so Alerts are bilingual.
   * @returns {Promise<boolean>}
   */
  const validateAndUnlock = useCallback(async (code, { isZh = false } = {}) => {
    return await premiumStore.validateAndUnlock(code, { isZh });
  }, []); // no deps — premiumStore is module-level and never changes

  return { isPremium, isLoading, isRestoring, unlock, restore, validateAndUnlock };
}

export default usePremium;
