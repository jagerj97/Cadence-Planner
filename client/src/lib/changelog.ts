/** The app's version, from package.json at build time ("dev" when run without the Android build). */
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

/**
 * Quick notes on what changed in each version, shown once in the "What's new" window the first time
 * the app opens after an update (see WhatsNew): fixes (things that were broken) and changes (new or
 * different). Add the new version's notes whenever a build is made.
 */
export type ReleaseNotes = { fixes?: string[]; changes?: string[] };
export const CHANGELOG: Record<string, ReleaseNotes> = {
  "1.5.3-beta": {
    fixes: [
      "Deleting an item deletes its journal entry too, and a focus session saved to the calendar goes with its item.",
      "This window no longer comes back after changing settings.",
      "Errors show even with in-app pop-ups turned off.",
      "The default focus time can be cleared and typed again.",
    ],
    changes: [
      "Reminders and timers sound through your notifications: a little bell jingle, or the chime with Cadence outside.",
      "Display mode: dark, light, your phone's setting, or sunrise/sunset.",
      "A new schedule view in the calendar, and a Schedule card for Today.",
      "A new layout for adding and editing items. Tasks are due at a time and can open days before.",
      "Items over several days are one bar in the week and month views, and overlapping items nest.",
      "Journal entries open when tapped, save when you tap outside, and can have their #tags turned off.",
      "Habits show missed days as a streak below zero, and can shift their schedule to today.",
      "Times are typed as hrs:mins, and dragged items snap to the quarter hour.",
      "Fewer pop-ups, and UI changes.",
    ],
  },
  "1.5.2-beta": { changes: [
    "A window like this one now shows what changed after each update.",
    "Tasks due today show at the top of the schedule. Checked-off tasks leave that row.",
    "After a focus session of more than 5 minutes, you can add it to your calendar.",
    "Finishing a focus session from the notification now opens the app.",
    "Habits can be at a set time or all day.",
    "UI changes.",
  ] },
};
