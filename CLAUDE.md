# Cadence

A React/Vite planner wrapped in an Android WebView app. The web app builds into
`android/app/src/main/assets/web` (`npm run build:android:web`); CI builds and publishes the APK
when a version lands on `main`.

## Making a build ("build it" / "apk go")

1. Bump the version in `package.json` (and the two matching lines in `package-lock.json`).
2. Add the new version's notes to `CHANGELOG` in `client/src/lib/changelog.ts`: a few short,
   plain-language lines on what changed since the last build, split into `fixes` (things that were
   broken) and `changes` (new or different). Small visual tweaks can be summed up as "UI changes."
   They're shown once in the "What's new" window the first time the app opens after the update.
3. Run `npm run build:android:web` and commit the result.
4. Push, open a PR to `main`, and merge it.

## Icons

`client/public/favicon.svg` is the logomark (the cat) and `client/public/cadence-logotype.svg` the
logotype. After changing either, run `python3 android/tools/make_icon.py` to regenerate the Android
icon vectors.
