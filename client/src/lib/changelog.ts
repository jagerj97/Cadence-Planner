/** The app's version, from package.json at build time ("dev" when run without the Android build). */
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

/**
 * Quick notes on what changed in each version, shown once in the "What's new" window the first time
 * the app opens after an update (see WhatsNew): fixes (things that were broken) and changes (new or
 * different). Add the new version's notes whenever a build is made.
 */
export type ReleaseNotes = { fixes?: string[]; changes?: string[] };
export const CHANGELOG: Record<string, ReleaseNotes> = {
  "1.5.2-beta": { changes: [
    "A window like this one now shows what changed after each update.",
    "Tasks due today show at the top of the schedule. Checked-off tasks leave that row.",
    "After a focus session of more than 5 minutes, you can add it to your calendar.",
    "Finishing a focus session from the notification now opens the app.",
    "Habits can be at a set time or all day.",
    "UI changes.",
  ] },
};
