/** Only the visible, focused browser window owns remote language assistance. */
type ActivityDocument = Pick<
  Document,
  "visibilityState" | "hasFocus" | "addEventListener" | "removeEventListener"
>;

export function watchEditorActivity(
  resume: () => void,
  pause: () => void,
  page: ActivityDocument = document,
  focusEvents: Pick<Window, "addEventListener" | "removeEventListener"> = window,
): () => void {
  let active: boolean | undefined;
  const update = (focused = page.hasFocus()) => {
    const next = focused && page.visibilityState === "visible";
    if (next === active) return;
    active = next;
    if (next) resume();
    else pause();
  };
  const focus = () => update();
  const blur = () => update(false);
  focusEvents.addEventListener("focus", focus);
  focusEvents.addEventListener("blur", blur);
  page.addEventListener("visibilitychange", focus);
  update();
  return () => {
    focusEvents.removeEventListener("focus", focus);
    focusEvents.removeEventListener("blur", blur);
    page.removeEventListener("visibilitychange", focus);
  };
}
