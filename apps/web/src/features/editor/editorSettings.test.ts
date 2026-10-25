import { afterEach, describe, expect, it, vi } from "vitest";
import { readEditorPreferences, writePreference } from "./editorSettings";

afterEach(() => vi.unstubAllGlobals());

describe("browser display preferences", () => {
  it("rejects malformed persisted values before they reach CodeMirror", () => {
    const values = new Map([
      ["quorem.code-font-size.v1", '"huge"'],
      ["quorem.tab-size.v1", "128"],
      ["quorem.wrap.v1", '"false"'],
      ["quorem.editor-scheme.v1", '"unknown"'],
    ]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null });
    expect(readEditorPreferences()).toEqual({
      editorScheme: "workspace",
      fontSize: 15,
      tabSize: 4,
      wrap: false,
    });
  });

  it("restores supported choices", () => {
    const values = new Map([
      ["quorem.code-font-size.v1", "18"],
      ["quorem.tab-size.v1", "2"],
      ["quorem.wrap.v1", "true"],
      ["quorem.editor-scheme.v1", '"darcula"'],
    ]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null });
    expect(readEditorPreferences()).toEqual({
      editorScheme: "darcula",
      fontSize: 18,
      tabSize: 2,
      wrap: true,
    });
  });

  it("keeps settings usable when browser storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    });
    expect(() => writePreference("quorem.wrap.v1", true)).not.toThrow();
    expect(readEditorPreferences().wrap).toBe(false);
  });
});
