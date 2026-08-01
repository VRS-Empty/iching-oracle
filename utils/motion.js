/**
 * utils/motion.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Platform-safe accelerometer access.
 *
 * expo-sensors ships a web implementation, but it is a stub: calling
 * `Accelerometer.addListener` on web throws
 *
 *     TypeError: this._nativeModule.addListener is not a function
 *
 * Because both subscription sites do this inside a React effect, the throw is
 * an uncaught error during commit — React 19 responds by unmounting the entire
 * tree, so the web build rendered a blank page with no error in the console.
 * That failure mode is invisible enough to be worth a shared wrapper rather
 * than a `Platform.OS` check copy-pasted at each call site.
 *
 * Everything here degrades to a no-op when motion is unavailable. Callers that
 * need to adapt their UI — "shake or tap" versus "tap" — read MOTION_SUPPORTED.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Platform } from 'react-native';
import { Accelerometer } from 'expo-sensors';

/**
 * Whether shake and tilt input can work at all on this platform.
 * Browsers expose DeviceOrientation only on some mobile devices, behind a
 * permission prompt and a secure context; treating web as motionless keeps the
 * experience predictable instead of working on one phone and not another.
 */
export const MOTION_SUPPORTED = Platform.OS !== 'web';

const noop = () => {};

/**
 * Subscribes to accelerometer updates.
 *
 * @param   {number}   intervalMs  desired sampling interval
 * @param   {Function} handler     receives { x, y, z }
 * @returns {Function}             unsubscribe; always safe to call
 */
export function subscribeToAccelerometer(intervalMs, handler) {
  if (!MOTION_SUPPORTED) return noop;

  try {
    Accelerometer.setUpdateInterval(intervalMs);
    const subscription = Accelerometer.addListener(handler);
    return () => {
      try {
        subscription?.remove();
      } catch {
        /* already torn down */
      }
    };
  } catch (error) {
    // A device that reports the sensor but fails to start it should cost the
    // user the gesture, not the screen.
    console.warn('[motion] accelerometer unavailable:', error?.message ?? error);
    return noop;
  }
}

export default { MOTION_SUPPORTED, subscribeToAccelerometer };
