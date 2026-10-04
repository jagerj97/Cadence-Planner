/**
 * The web version (GitHub Pages) runs the same app as the APK, so it stands in for the Android
 * bridge the app talks to: data stays in this browser's database (androidApi.ts), backups and
 * calendar exports download as files, and the running focus timer is kept in localStorage.
 * Phone-only features (notifications, widgets, calendar feeds) do nothing here.
 */
import type { AndroidBridge } from "./androidApi";

const stored = {
  get: (key: string) => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage off */ } },
};

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toLocaleDateString("en-CA");
const nothing = () => {};

const webBridge: AndroidBridge = {
  fetchCalendar: () => JSON.stringify({ error: "Calendar links sync in the Android app." }),
  saveIcs: (text) => download(`cadence-${stamp()}.ics`, "text/calendar", text),
  saveBackup: (text) => download(`cadence-backup-${stamp()}.json`, "application/json", text),
  notify: nothing,
  requestNotifications: nothing,
  notificationsAllowed: () => false,
  scheduleReminders: nothing,
  scheduleFocus: nothing,
  cancelFocus: nothing,
  finishFocus: nothing,
  getFocus: () => stored.get("cadence-focus") || "null",
  saveFocus: (json) => stored.set("cadence-focus", json || "null"),
  takeFocusStop: () => "null",
};

// Any other bridge call (settings the phone applies, like the app icon or sounds) is ignored.
if (!window.CadenceAndroid) {
  // Places open in Google Maps here rather than through geo: links (links.tsx).
  window.cadenceWeb = true;
  window.CadenceAndroid = new Proxy(webBridge, {
    get: (target, key) => (key in target ? target[key as keyof AndroidBridge] : key === "then" || key === "systemDark" ? undefined : () => ""),
  });
}
