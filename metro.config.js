/**
 * metro.config.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Extends Expo's default Metro configuration.
 *
 * The only change is registering `.wasm` as an asset extension. expo-sqlite's
 * web implementation is wa-sqlite compiled to WebAssembly, and it imports the
 * .wasm binary directly; without this, a web build fails to resolve
 * `./wa-sqlite/wa-sqlite.wasm` and the whole bundle errors out. Native builds
 * are unaffected — they use the platform SQLite and never touch this path.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

module.exports = config;
