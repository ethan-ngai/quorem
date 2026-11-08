/** @file useServerSearch.ts @description Immediate input and debounced server search. @module ui */
import { useDebouncer } from "@tanstack/react-pacer/debouncer";
import { useLayoutEffect, useState } from "react";

export function useServerSearch(
  value: string,
  commit: (value: string) => void,
  scope: unknown = value,
) {
  const [edit, setEdit] = useState<{ scope: unknown; value: string; text: string }>();
  const debouncer = useDebouncer(commit, { wait: 250 });
  // A restored URL or changed scope supersedes any queued edit.
  useLayoutEffect(() => () => debouncer.cancel(), [debouncer, scope, value]);
  if (edit && (edit.scope !== scope || edit.value !== value)) setEdit(undefined);
  return {
    text: edit?.text ?? value,
    change(text: string) {
      setEdit({ scope, value, text });
      const query = text.trim();
      if (query === value) debouncer.cancel();
      else debouncer.maybeExecute(query);
    },
    reset() {
      debouncer.cancel();
      setEdit(undefined);
    },
  };
}
