/** @file editorPreview.tsx @description Local fixture using the real editor and browser language services. @module dev */
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PythonEditor } from "../features/editor/PythonEditor";
import { defaultEditorSchemes } from "../features/editor/editorSchemes";
import { useIntelligence } from "../features/editor/useIntelligence";
import "@fontsource-variable/geist";
import "@fontsource/jetbrains-mono/400.css";
import "@quorem/ui/theme.css";
import "../styles/global.css";

if (!import.meta.env.DEV) throw new Error("Development fixture only");

const fixtures = {
  python: 'items: list[str] = ["apple"]\nitems.append("pear")\nitems.append(42)\n',
  typescript: 'const items: string[] = ["apple"];\nitems.push("pear");\nitems.push(42);\n',
};

/** Mount the active browser engine and expose the two default editor themes. */
function EditorPreview() {
  const [language, setLanguage] = useState<keyof typeof fixtures>("python");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const { extensions, status } = useIntelligence("alice", language, true, language);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <main style={{ maxWidth: "60rem", margin: "32px auto", padding: "0 16px" }}>
      <h1>Editor IntelliSense</h1>
      <label>
        Language{" "}
        <select
          value={language}
          onChange={(event) =>
            setLanguage(event.target.value === "python" ? "python" : "typescript")
          }
        >
          <option value="python">Python</option>
          <option value="typescript">TypeScript</option>
        </select>
      </label>{" "}
      <button type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
        {theme === "light" ? "Dark theme" : "Light theme"}
      </button>
      <p role="status">Language service {status}</p>
      <p>
        Hover over the method or the underlined argument. Type <code>items.</code> on a new line for
        suggestions.
      </p>
      <div style={{ height: "24rem" }}>
        <PythonEditor
          key={language}
          language={language}
          documentKey={language}
          documentUri={language === "python" ? "file:///typings/main.py" : "file:///main.ts"}
          initialSource={fixtures[language]}
          theme={theme}
          colorScheme={defaultEditorSchemes[theme]}
          fontSize={14}
          tabSize={4}
          wrap
          intelligenceExtensions={extensions}
          onSourceChange={() => {}}
        />
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<EditorPreview />);
