import { expect, it, vi } from "vitest";
import { watchEditorActivity } from "./languageActivity";

it("inactive windows never acquire the engine; focus resumes once, blur/hidden pauses", () => {
  const events = new EventTarget();
  const page = Object.assign(new EventTarget(), {
    visibilityState: "visible" as DocumentVisibilityState,
    focused: false,
    hasFocus() {
      return this.focused;
    },
  });
  const resume = vi.fn();
  const pause = vi.fn();
  const dispose = watchEditorActivity(resume, pause, page, events);
  expect(pause).toHaveBeenCalledTimes(1);
  events.dispatchEvent(new Event("focus"));
  expect(resume).not.toHaveBeenCalled();
  page.focused = true;
  events.dispatchEvent(new Event("focus"));
  events.dispatchEvent(new Event("focus"));
  expect(resume).toHaveBeenCalledTimes(1);
  events.dispatchEvent(new Event("blur"));
  expect(pause).toHaveBeenCalledTimes(2);
  page.visibilityState = "hidden";
  page.dispatchEvent(new Event("visibilitychange"));
  events.dispatchEvent(new Event("focus"));
  expect(resume).toHaveBeenCalledTimes(1);
  page.visibilityState = "visible";
  page.dispatchEvent(new Event("visibilitychange"));
  expect(resume).toHaveBeenCalledTimes(2);
  dispose();
  events.dispatchEvent(new Event("blur"));
  expect(pause).toHaveBeenCalledTimes(2);
});
