/** The app's version, from package.json at build time ("dev" when run without the Android build). */
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

/**
 * Quick notes on what changed in each version, shown once in the "What's new" window the first time
 * the app opens after an update (see WhatsNew). Add the new version's notes whenever a build is made.
 */
export const CHANGELOG: Record<string, string[]> = {};
