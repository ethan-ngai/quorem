/** @file matchEditorInput.ts @description Match clipboard and drop boundaries. @module matches */
const editorSelector = ".coding-pane .cm-content";
const matchPaneSelector = ".coding-pane, .problem-pane";
const editorDataType = "application/x-quorem-match-editor";

function element(target: EventTarget | null) {
  return target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
}

function plainText(data: DataTransfer) {
  return data.getData("text/plain").replace(/\r\n/g, "\n");
}

export function observeMatchEditorInput(
  clipboardRule: (kind: "clipboard" | "copy") => boolean,
  onBlockedDrop: () => void,
) {
  const editorCopies = new WeakSet<ClipboardEvent>();
  let copied: { token: string; text: string } | undefined;
  let drag: { editor: Element; token: string } | undefined;

  const captureClipboard = (event: ClipboardEvent) => {
    const target = element(event.target);
    const editor = target?.closest(editorSelector);
    const data = event.clipboardData;
    if (event.type === "paste") {
      if (!target?.closest(matchPaneSelector)) return;
      if (
        editor &&
        copied &&
        data &&
        data.getData(editorDataType) === copied.token &&
        plainText(data) === copied.text
      )
        return;
    } else {
      const selection = document.getSelection();
      if (
        editor &&
        (!selection ||
          selection.isCollapsed ||
          (editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)))
      ) {
        editorCopies.add(event);
        return;
      }
      if (
        !target?.closest(matchPaneSelector) &&
        !element(selection?.anchorNode ?? null)?.closest(matchPaneSelector) &&
        !element(selection?.focusNode ?? null)?.closest(matchPaneSelector) &&
        ![...document.querySelectorAll(".problem-pane")].some((pane) =>
          selection?.containsNode(pane, true),
        )
      )
        return;
    }
    if (clipboardRule(event.type === "paste" ? "clipboard" : "copy")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  const tagCopy = (event: ClipboardEvent) => {
    const data = event.clipboardData;
    // CodeMirror writes the exact clipboard text first, including linewise and multi-range copies.
    if (!editorCopies.has(event) || !event.defaultPrevented || !data) return;
    copied = { token: crypto.randomUUID(), text: plainText(data) };
    data.setData(editorDataType, copied.token);
  };
  const startDrag = (event: DragEvent) => {
    drag = undefined;
    const editor = element(event.target)?.closest(editorSelector);
    if (!editor || !event.dataTransfer) return;
    drag = { editor, token: crypto.randomUUID() };
    event.dataTransfer.setData(editorDataType, drag.token);
  };
  const endDrag = () => {
    drag = undefined;
  };
  const drop = (event: DragEvent) => {
    const editor = element(event.target)?.closest(editorSelector);
    const internal =
      drag && drag.editor === editor && event.dataTransfer?.getData(editorDataType) === drag.token;
    endDrag();
    if (!editor || internal) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    onBlockedDrop();
  };

  const events = ["copy", "cut", "paste"] as const;
  for (const type of events) document.addEventListener(type, captureClipboard, true);
  document.addEventListener("copy", tagCopy);
  document.addEventListener("cut", tagCopy);
  document.addEventListener("dragstart", startDrag, true);
  document.addEventListener("dragend", endDrag, true);
  document.addEventListener("drop", drop, true);
  return () => {
    for (const type of events) document.removeEventListener(type, captureClipboard, true);
    document.removeEventListener("copy", tagCopy);
    document.removeEventListener("cut", tagCopy);
    document.removeEventListener("dragstart", startDrag, true);
    document.removeEventListener("dragend", endDrag, true);
    document.removeEventListener("drop", drop, true);
  };
}
