/** The app's version, from package.json at build time ("dev" when run without the Android build). */
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

/**
 * Quick notes on what changed in each version, shown once in the "What's new" window the first time
 * the app opens after an update (see WhatsNew): fixes (things that were broken) and changes (new or
 * different). Add the new version's notes whenever a build is made.
 */
export type ReleaseNotes = { fixes?: string[]; changes?: string[] };
export const CHANGELOG: Record<string, ReleaseNotes> = {
  "1.5.6-beta": {
    fixes: [
      "Bug fixes, including reminders on daylight saving days",
      "Faster, especially during a focus session",
    ],
    changes: [
      "Routines can be set for certain days of the week",
      "A new Journal widget, and app shortcuts to each page",
      "Calendar items can have their own color",
      "UI changes",
    ],
  },
  "1.5.5-beta": {
    fixes: [
      "Calendar links with lots of events sync again, and long-running repeats show their current dates",
      "Saving a journal entry without changes no longer marks it edited",
      "Items running past midnight say \"next day\" instead of showing a date",
    ],
    changes: [
      "The journal has an Archive. Entries of finished tasks and past events go there on their own",
      "The calendar has a Timeline view, and a menu to switch views",
      "Week, month and agenda fill the screen, with bigger text",
      "Links and locations open in your browser or maps app",
      "Customize on Today lets you reorder the bottom bar. Tap the chevron to see the whole day",
      "Widgets take their own colors, open their pages, and fit smaller sizes",
      "The status bar matches the top of the app, and long tag lists fold away",
      "UI changes",
    ],
  },
  "1.5.4-beta": {
    fixes: [
      "The agenda opens quickly, even with a lot planned",
      "Dragging on an item scrolls, in the timeline and every list. Hold an item to move it, as before",
      "The Timeline widget no longer jumps back to the current hour while you scroll it",
    ],
    changes: [
      "The schedule view is now called Agenda. The calendar switch reads Agenda, Week, Month",
      "Today's timeline and agenda are one card, with a switch between them",
      "Swipe left or right to go to the next page",
      "A new Agenda widget for the next two weeks",
      "Delete a journal entry from its edit window",
      "UI changes to the focus timer",
    ],
  },
  "1.5.3-beta": {
    fixes: [
      "Deleting an item deletes its journal entry too, and a focus session saved to the calendar goes with its item",
      "This window no longer comes back after changing settings",
      "Errors show even with in-app pop-ups turned off",
      "The default focus time can be cleared and typed again",
    ],
    changes: [
      "Reminders and timers sound through your notifications: a little bell jingle, or the chime with Cadence outside",
      "Display mode: dark, light, your phone's setting, or sunrise/sunset",
      "A new schedule view in the calendar, and a Schedule card for Today",
      "A new layout for adding and editing items. Tasks are due at a time and can open days before",
      "Items over several days are one bar in the week and month views, and overlapping items nest",
      "Journal entries open when tapped, save when you tap outside, and can have their #tags turned off",
      "Habits show missed days as a streak below zero, and can shift their schedule to today",
      "Times are typed as hrs:mins, and dragged items snap to the quarter hour",
      "Fewer pop-ups, and UI changes",
    ],
  },
  "1.5.2-beta": { changes: [
    "A window like this one now shows what changed after each update",
    "Tasks due today show at the top of the schedule. Checked-off tasks leave that row",
    "After a focus session of more than 5 minutes, you can add it to your calendar",
    "Finishing a focus session from the notification now opens the app",
    "Habits can be at a set time or all day",
    "UI changes",
  ] },
};
