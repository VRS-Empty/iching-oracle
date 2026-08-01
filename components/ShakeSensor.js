/**
 * ShakeSensor.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Detects device shake gestures via the Accelerometer and orchestrates the
 * full divination flow: haptics → coin throw animation → hexagram generation.
 *
 * Design decisions:
 *  • Debounce + cooldown prevents accidental double-triggers.
 *  • Jerk (Δacceleration) detection is more reliable than raw magnitude.
 *  • Haptic pattern mirrors the "dropping coins" sensation (6 pulses).
 *  • All sensor subscriptions are cleaned up on unmount.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
  useImperativeHandle,
  forwardRef,
} from 'react';
import * as Haptics from 'expo-haptics';
import { subscribeToAccelerometer, MOTION_SUPPORTED } from '../utils/motion';

// ─── Configuration ────────────────────────────────────────────────────────────

const CONFIG = {
  /** Sensor polling interval in ms. 16ms ≈ 60fps. */
  UPDATE_INTERVAL_MS: 16,

  /**
   * Jerk threshold to trigger a shake event.
   * "Jerk" = magnitude of the change in acceleration vector between frames.
   * Empirically, casual pocket motion ≈ 0.3–0.8 G·s⁻¹, deliberate shake > 1.8
   */
  SHAKE_JERK_THRESHOLD: 1.8,

  /**
   * Minimum milliseconds between accepted shake events.
   * Prevents the gyroscope "ringing" after a single hard shake from firing twice.
   */
  SHAKE_COOLDOWN_MS: 1800,

  /**
   * Number of consecutive above-threshold samples required before accepting.
   * Filters out single-frame noise spikes.
   */
  CONSECUTIVE_THRESHOLD_COUNT: 2,

  /**
   * Delay (ms) between haptic pulses when forming each line.
   * Should feel like individual coins falling.
   */
  HAPTIC_PULSE_INTERVAL_MS: 320,

  /**
   * Extra animation settle time after the last line is formed,
   * before the result is surfaced to the parent.
   */
  RESULT_REVEAL_DELAY_MS: 600,
};

// ─── Haptic Sequences ─────────────────────────────────────────────────────────

/**
 * Fires a precise haptic pattern to simulate "throwing coins."
 * Heavier impact = changing line (6 or 9), lighter = static line.
 */
async function playLineHaptic(lineValue) {
  const isChanging = lineValue === 6 || lineValue === 9;

  if (isChanging) {
    // Double-impact for changing lines — feels like two coins landing together
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await delay(80);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } else {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

/**
 * Celebration haptic when the full hexagram is revealed.
 */
async function playRevealHaptic() {
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

/**
 * Warning haptic for errors or unavailability.
 */
async function playErrorHaptic() {
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Computes the Euclidean magnitude of an acceleration vector {x, y, z}.
 */
function magnitude({ x, y, z }) {
  return Math.sqrt(x * x + y * y + z * z);
}

/**
 * Computes the "jerk" between two acceleration samples (change per unit time).
 * Returns a unitless scalar representing motion intensity.
 */
function computeJerk(prev, curr) {
  const dx = curr.x - prev.x;
  const dy = curr.y - prev.y;
  const dz = curr.z - prev.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ─── Shake Sensor Component ────────────────────────────────────────────────────

/**
 * ShakeSensor
 *
 * A headless (renderless) component that manages the accelerometer subscription
 * and coordinates the divination timing. Exposes an imperative handle so the
 * parent can also trigger a cast manually (e.g. via a button tap).
 *
 * Props:
 *   onCastStart       () => void          — Called when shake is detected
 *   onLineFormed      (lineIdx, val) => void — Called after each of 6 lines
 *   onCastComplete    (result) => void    — Called with final DivinationResult
 *   onError           (error) => void     — Called on failures
 *   castHexagram      Function            — From useIChing hook
 *   disabled          boolean             — Temporarily disables shake detection
 *   children          ReactNode           — Optional render prop
 */
const ShakeSensor = forwardRef(function ShakeSensor(
  {
    onCastStart,
    onLineFormed,
    onCastComplete,
    onError,
    castHexagram,
    disabled = false,
    children,
  },
  ref
) {
  // ── Internal refs (don't need re-renders) ───────────────────────────────────
  const subscriptionRef       = useRef(null);
  const lastAccelRef          = useRef({ x: 0, y: 0, z: 0 });
  const lastShakeTimeRef      = useRef(0);
  const consecutiveCountRef   = useRef(0);
  const isCastingRef          = useRef(false);

  // ── State (drives UI in parent via callbacks) ───────────────────────────────
  const [isListening, setIsListening] = useState(false);

  // ─── Internal cast orchestrator ─────────────────────────────────────────────

  const triggerCast = useCallback(async () => {
    if (isCastingRef.current || disabled) return;
    isCastingRef.current = true;

    try {
      // 1. Notify parent that casting has begun
      onCastStart?.();

      // 2. Opening haptic burst — "coins in hand"
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      await delay(120);

      // 3. Run the divination, providing a per-line callback
      const result = await castHexagram(async (lineIndex, lineValue) => {
        // Delay to spread out the lines visually and haptically
        await delay(CONFIG.HAPTIC_PULSE_INTERVAL_MS);
        await playLineHaptic(lineValue);
        onLineFormed?.(lineIndex, lineValue);
      });

      // 4. Brief pause before reveal
      await delay(CONFIG.RESULT_REVEAL_DELAY_MS);

      // 5. Celebration haptic
      await playRevealHaptic();

      // 6. Surface result to parent
      onCastComplete?.(result);

    } catch (err) {
      console.error('[ShakeSensor] Cast error:', err);
      await playErrorHaptic();
      onError?.(err);
    } finally {
      isCastingRef.current = false;
    }
  }, [disabled, castHexagram, onCastStart, onLineFormed, onCastComplete, onError]);

  // ─── Accelerometer logic ──────────────────────────────────────────────────

  const handleAccelerometerData = useCallback(({ x, y, z }) => {
    const now = Date.now();
    const prev = lastAccelRef.current;

    const jerk = computeJerk(prev, { x, y, z });
    lastAccelRef.current = { x, y, z };

    const cooldownElapsed = (now - lastShakeTimeRef.current) > CONFIG.SHAKE_COOLDOWN_MS;

    if (jerk > CONFIG.SHAKE_JERK_THRESHOLD) {
      consecutiveCountRef.current += 1;
    } else {
      consecutiveCountRef.current = 0;
    }

    const shakeConfirmed =
      consecutiveCountRef.current >= CONFIG.CONSECUTIVE_THRESHOLD_COUNT &&
      cooldownElapsed &&
      !isCastingRef.current &&
      !disabled;

    if (shakeConfirmed) {
      consecutiveCountRef.current = 0;
      lastShakeTimeRef.current = now;
      triggerCast();
    }
  }, [disabled, triggerCast]);

  // ─── Subscription lifecycle ──────────────────────────────────────────────

  const startListening = useCallback(() => {
    // No-ops where there is no accelerometer (web); the parent's tap handler
    // still reaches triggerCast through the imperative handle below.
    subscriptionRef.current = subscribeToAccelerometer(
      CONFIG.UPDATE_INTERVAL_MS, handleAccelerometerData,
    );
    setIsListening(MOTION_SUPPORTED);
  }, [handleAccelerometerData]);

  const stopListening = useCallback(() => {
    subscriptionRef.current?.();
    subscriptionRef.current = null;
    setIsListening(false);
  }, []);

  useEffect(() => {
    startListening();
    return () => stopListening();
  }, [startListening, stopListening]);

  // ─── Imperative handle (allows parent to trigger manually) ──────────────

  useImperativeHandle(ref, () => ({
    /** Manually trigger a cast (e.g. from a button) */
    triggerCast,
    /** Pause shake detection */
    pause: stopListening,
    /** Resume shake detection */
    resume: startListening,
    /** Whether the sensor is currently active */
    isListening,
  }), [triggerCast, stopListening, startListening, isListening]);

  // ─── Render ───────────────────────────────────────────────────────────────

  // Headless by default; optionally accepts children as render prop
  if (typeof children === 'function') {
    return children({ isListening, triggerCast });
  }

  return children ?? null;
});

export default ShakeSensor;

// ─── Named exports for testing / storybook ────────────────────────────────────

export {
  CONFIG as SHAKE_CONFIG,
  computeJerk,
  playLineHaptic,
  playRevealHaptic,
};
