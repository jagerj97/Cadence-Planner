/**
 * Whether Cadence is running in the Android app. The web version has a stand-in bridge too (webBridge.ts,
 * which quietly ignores what only a phone can do), so having `window.CadenceAndroid` isn't enough: things
 * with a browser way of their own (sounds, vibration, location) check this instead.
 */
export const onDevice = () => !!window.CadenceAndroid && !window.cadenceWeb;
