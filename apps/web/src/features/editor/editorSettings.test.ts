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
      editorSchemes: { light: "jetbrains-light", dark: "jetbrains-dark" },
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
      editorSchemes: { light: "jetbrains-light", dark: "darcula" },
      fontSize: 18,
      tabSize: 2,
      wrap: true,
    });
  });

  it("validates each mode independently without falling back to legacy settings", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "quorem.editor-schemes.v2"
          ? JSON.stringify({ light: "github-light", dark: "jetbrains-light" })
          : JSON.stringify("darcula"),
    });
    expect(readEditorPreferences().editorSchemes).toEqual({
      light: "github-light",
      dark: "jetbrains-dark",
    });
  });

  it.each(["workspace", "unknown", null])("uses JetBrains defaults for legacy %s", (value) => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => (key === "quorem.editor-scheme.v1" ? JSON.stringify(value) : null),
    });
    expect(readEditorPreferences().editorSchemes).toEqual({
      light: "jetbrains-light",
      dark: "jetbrains-dark",
    });
  });

  it("migrates a legacy light choice only into the light slot", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "quorem.editor-scheme.v1" ? JSON.stringify("jetbrains-light") : null,
    });
    expect(readEditorPreferences().editorSchemes).toEqual({
      light: "jetbrains-light",
      dark: "jetbrains-dark",
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
