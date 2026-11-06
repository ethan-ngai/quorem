/** @file sourceFilter.ts @description Shared source constraints before collaborative admission. @module collaboration */
import { EditorState } from "@codemirror/state";
import { toast } from "sonner";
export const sourceFilter = EditorState.changeFilter.of((transaction) => {
  let hasNUL = false;
  transaction.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    if (inserted.toString().includes("\0")) hasNUL = true;
  });
  if (hasNUL) toast.error("Source cannot contain NUL characters.", { id: "shared-source-nul" });
  return !hasNUL;
});
