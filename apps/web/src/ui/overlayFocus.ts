/** Focus the overlay itself so opening it does not activate a nested tooltip. */
export function focusOverlayOnOpen(event: Event) {
  if (event.defaultPrevented || !(event.target instanceof HTMLElement)) return;
  event.preventDefault();
  event.target.focus({ preventScroll: true });
}
