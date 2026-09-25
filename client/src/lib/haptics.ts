import type { Settings } from "@shared/schema";
import { queryClient } from "./queryClient";

/**
 * hold     — an item was picked up to move
 * complete — a task or habit was checked off
 * tick     — a light tap (unchecking, partial habit, dropping an item)
 * warn     — an action isn't allowed
 */
export type Haptic = "hold" | "complete" | "tick" | "warn";

const WEB_PATTERNS: Record<Haptic, number | number[]> = { hold: 25, complete: [12, 60, 18], tick: 8, warn: [30, 50, 30] };

export function hapticsEnabled(): boolean {
  return queryClient.getQueryData<Settings>(["/api/settings"])?.haptics !== false;
}

/** Plays a haptic if the user hasn't turned haptics off. Uses Android's native feedback in the app. */
export function haptic(kind: Haptic, force = false) {
  if (!force && !hapticsEnabled()) return;
  try {
    const bridge = window.CadenceAndroid;
    if (bridge?.haptic) bridge.haptic(kind);
    else navigator.vibrate?.(WEB_PATTERNS[kind]);
  } catch {
    // Haptics are a nicety; never let them break an action.
  }
}
