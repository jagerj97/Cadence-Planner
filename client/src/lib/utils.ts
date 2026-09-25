import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * For Radix `onOpenAutoFocus`: focus the dialog/popover itself rather than its first text field,
 * so the on-screen keyboard only opens once the user taps an input.
 */
export function focusContainerOnOpen(handler?: (event: Event) => void) {
  return (event: Event) => {
    handler?.(event)
    if (event.defaultPrevented) return
    event.preventDefault()
    ;(event.target as HTMLElement | null)?.focus?.({ preventScroll: true })
  }
}
