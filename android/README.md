# Cadence for Android

This Android Studio project bundles the same React interface used by the Cadence website. The Android build intercepts the app's local API calls and stores planner items, routines, habits, journal entries, focus history, settings, and calendar subscriptions in an on-device IndexedDB database. It does not connect to the hosted Cadence account or transfer its contents; your phone starts with its own empty planner.

## Install the supplied APK

Copy `Cadence-Android-debug.apk` to your Android phone, open it, and approve installation from that source if Android asks. The debug APK is signed with a development key, so it is appropriate for personal testing rather than Play Store distribution. Android 8.0 or newer is required. Keep a copy of the APK and project; replacing the app with a differently signed build will require uninstalling it, which erases its local database.

## Open and rebuild in Android Studio

Open this `android` directory as a project. Allow Android Studio to install SDK Platform 35 and sync Gradle, then choose **Build > Build Bundle(s) / APK(s) > Build APK(s)**. The APK appears at `app/build/outputs/apk/debug/app-debug.apk`. This project includes the prebuilt web interface in `app/src/main/assets/web`, so Node.js is not needed to rebuild the supplied Android source. Use JDK 17 for Gradle.

If editing the shared Cadence web interface in the parent repository, run `npm install` and `npm run build:android:web` from the parent `cadence` directory before rebuilding the Android APK. The regular website build is separate.

## Data and notifications

- The database stays in Android's private app storage. System backup is disabled for this app. Uninstalling the app or clearing its storage deletes your planner data.
- Use **Settings > Backup & restore** to save a complete JSON backup, then restore it on this phone or another Android installation. It includes planner items, habits and their progress, journal entries, focus history, current timer, routines, settings, and calendar subscriptions. Review the file summary before confirming a restore; restoring replaces the phone's current data. Backup files are not encrypted and may contain private notes and calendar subscription tokens, so store them securely.
- Import `.ics` files with the file picker or subscribe to a public HTTPS iCal feed, including `webcal://` URLs (converted to HTTPS). Feed refreshes while the app is open; it is not a background cloud synchronization service.
- Use **Calendar links > Export** to save your planner to an `.ics` file. A public subscribe-to-Cadence URL is intentionally unavailable because an offline, phone-only database cannot serve a reachable calendar feed to another device.
- Grant Android notification permission in Settings. Cadence schedules upcoming timed-item reminders for the next 31 days and reschedules them when the app opens or its items change; active focus timers also schedule a device notification. Scheduled alerts are restored after a reboot. Android may deliver local alarms a little late under battery optimization. Recurring items beyond the 31-day window are scheduled when you open the app again. In-app reminders and the countdown run while the app is open.
- The phone-local app is separate from `cadenceplanner.pplx.app`. Import/export `.ics` if you want to move calendar items between installations; journal, habit progress, and settings are not covered by that calendar export.
