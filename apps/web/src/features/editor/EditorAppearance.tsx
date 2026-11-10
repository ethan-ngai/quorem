import { useLayoutEffect } from "react";
import { useLocalEditorPreferences } from "../settings/useLocalEditorPreferences";
import { editorColorVariable, type EditorColorRole } from "./editorColors";
import { resolveEditorPalette } from "./editorPalettes";
import { editorSyntaxStyle } from "./syntaxHighlighting";

/** Expose the selected palettes and shared token rules to static code and portals. */
export function EditorAppearance() {
  const {
    editorSchemes: { light, dark },
  } = useLocalEditorPreferences();
  useLayoutEffect(() => {
    const lightColors = resolveEditorPalette(light, "light").colors;
    const darkColors = resolveEditorPalette(dark, "dark").colors;
    const root = document.documentElement;
    const roles = Object.keys(lightColors) as EditorColorRole[];
    // Root variables also reach menus rendered through a portal.
    for (const role of roles) {
      root.style.setProperty(
        editorColorVariable(role),
        `light-dark(${lightColors[role]}, ${darkColors[role]})`,
      );
    }
    return () => {
      for (const role of roles) root.style.removeProperty(editorColorVariable(role));
    };
  }, [light, dark]);
  return <style>{editorSyntaxStyle.module?.getRules()}</style>;
}
