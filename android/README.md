# Cadence for Android

This Android project wraps Cadence's React interface (in `../client`) in a WebView. The app answers its own `/api/...` requests on the device (`client/src/lib/androidApi.ts`) and stores planner items, routines, habits, journal entries, focus history, settings, and calendar subscriptions in a private IndexedDB database. Nothing is sent to a server; each phone has its own planner.

## Builds and releases

Every push to `main` runs `.github/workflows/build-apk.yml`, which builds the web interface, builds a signed release APK, and publishes it as a GitHub release named after the version (for example `v1.3.1-beta`) that can be downloaded and installed on a phone. Every build is signed with the same key (`app/cadence.keystore`), so each new APK installs over the last one and keeps its data. Android 8.0 or newer is required.

The version shown in Settings and on the release comes from `version` in the root `package.json`. Bump it for each release with `npm version <x.y.z-beta> --no-git-tag-version` from the repository root; pushing without a bump replaces that version's APK. The CI run number is used only as the APK's internal `versionCode`.

## Building locally

From the repository root, run `npm ci` and `npm run build:android:web`, which writes the web interface into `app/src/main/assets/web`. Then open this `android` directory in Android Studio (SDK Platform 35, JDK 17) or run `./gradlew assembleRelease`.

## Data and notifications

- The database stays in Android's private app storage. System backup is disabled for this app. Uninstalling the app or clearing its storage deletes your planner data.
- Use **Settings > Backup & restore** to save a complete JSON backup, then restore it on this phone or another Android installation. It includes planner items, habits and their progress, journal entries, focus history, current timer, routines, settings, and calendar subscriptions. Review the file summary before confirming a restore; restoring replaces the phone's current data. Backup files are not encrypted and may contain private notes and calendar subscription tokens, so store them securely.
- Import `.ics` files with the file picker or subscribe to a public HTTPS iCal feed, including `webcal://` URLs (converted to HTTPS). Feeds refresh while the app is open; there is no background sync.
- Use **Calendar links > Export** to save your planner to an `.ics` file. A subscribe-to-Cadence URL isn't available because a phone-only database can't serve a calendar feed to other devices.
- Grant notification permission in Settings. Items can have several reminders; Cadence schedules the soonest 128 reminder notifications over the next 31 days and reschedules them whenever the app opens or items change. Scheduled alerts are restored after a reboot, and Android may deliver them a little late under battery optimization.
- A running focus or break timer shows an ongoing notification with a live countdown and Pause/Resume and Stop buttons, which work even while the app is closed (`FocusTimer.java`).
- The **Cadence · Today** home screen widget shows Right now, Your day, Schedule, Tasks, and Habits from a week-long snapshot the app saves whenever your plan changes, so it stays current while the app is closed. Choose its panels when you add it, or later from its gear icon (`CadenceWidget.java`, `WidgetConfigActivity.java`).
- **Settings > In-app pop-ups** turns off the app's own pop-ups so reminders arrive only as phone notifications. Errors still show in the app.
