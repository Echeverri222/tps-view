/**
 * True when a key event's target is a control that consumes typed characters (text fields, selects).
 * Checkboxes, sliders and color pickers don't count, so single-key shortcuts keep working after
 * the user clicks one of them.
 */
export function isTextEntry(t: EventTarget | null): boolean {
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  if (!(t instanceof HTMLInputElement)) return false;
  return !["checkbox", "radio", "range", "color", "button", "submit", "reset"].includes(t.type);
}
