// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { observeMatchEditorInput } from "./matchEditorInput";

let editor: HTMLElement;
let problem: HTMLElement;
let stop: () => void;
const clipboardRule = vi.fn(() => true);
const blockedDrop = vi.fn();

beforeEach(() => {
  clipboardRule.mockClear();
  blockedDrop.mockClear();
  document.body.innerHTML = `
    <section class="problem-pane">Problem text</section>
    <section class="coding-pane"><div class="cm-content">Editor text</div></section>
  `;
  editor = document.querySelector(".cm-content")!;
  problem = document.querySelector(".problem-pane")!;
  stop = observeMatchEditorInput(clipboardRule, blockedDrop);
});

afterEach(() => {
  stop();
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

function clipboard(target: HTMLElement, type: string, clipboardData = new DataTransfer()) {
  return target.dispatchEvent(
    new ClipboardEvent(type, { clipboardData, bubbles: true, cancelable: true }),
  );
}

it("exempts editor clipboard round trips but applies policy to problem copies and unverified pastes", () => {
  // Mirror CodeMirror's synchronous clipboard write before the document's bubble listener.
  editor.addEventListener("copy", (event) => {
    event.clipboardData?.setData("text/plain", "Editor text");
    event.preventDefault();
  });
  const internal = new DataTransfer();
  clipboard(editor, "copy", internal);
  expect(clipboard(editor, "paste", internal)).toBe(true);
  expect(clipboardRule).not.toHaveBeenCalled();

  const external = new DataTransfer();
  external.setData("text/plain", "Editor text");
  expect(clipboard(editor, "paste", external)).toBe(false);
  internal.setData("text/plain", "Changed text");
  expect(clipboard(editor, "paste", internal)).toBe(false);
  expect(clipboard(problem, "copy")).toBe(false);
  expect(clipboardRule.mock.calls).toEqual([["clipboard"], ["clipboard"], ["copy"]]);
});

it("lets an editor drag reach its drop handler and intercepts external or stale drops", () => {
  const received = vi.fn();
  editor.addEventListener("drop", received);
  const drag = (target: HTMLElement, type: string, dataTransfer: DataTransfer) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    return target.dispatchEvent(event);
  };
  const internal = new DataTransfer();
  drag(editor, "dragstart", internal);
  expect(drag(editor, "drop", internal)).toBe(true);
  expect(drag(editor, "drop", internal)).toBe(false);
  const external = new DataTransfer();
  drag(problem, "dragstart", external);
  expect(drag(editor, "drop", external)).toBe(false);
  expect(received).toHaveBeenCalledTimes(1);
  expect(blockedDrop).toHaveBeenCalledTimes(2);
});
