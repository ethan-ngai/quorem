/** @file editorPreview.tsx @description Local fixture using the real editor and browser language services. @module dev */
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { linter, type Diagnostic } from "@codemirror/lint";
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

const severitySamples = [
  { severity: "error", message: "Argument must be a string." },
  { severity: "warning", message: "This API is deprecated." },
  { severity: "info", message: "The inferred type is list[str]." },
  { severity: "hint", message: "This annotation can be inferred." },
] as const satisfies readonly Pick<Diagnostic, "severity" | "message">[];

const severitySource = severitySamples.map(({ severity }) => severity).join("\n");
const severityExtensions = [
  linter(({ state }) =>
    severitySamples.map((sample, index) => {
      const { from, to } = state.doc.line(index + 1);
      return { ...sample, from, to };
    }),
  ),
];

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
        Hover over <code>{language === "python" ? "append" : "push"}</code> for its signature, or
        over <code>42</code> for the diagnostic. Type <code>items.</code> on a new line for
        suggestions.
      </p>
      <div style={{ height: "14rem" }}>
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
      <h2>Diagnostic severity</h2>
      <p>Hover over each underline to compare its tooltip. Switch themes to compare colors.</p>
      <div style={{ height: "8rem" }}>
        <PythonEditor
          documentKey="diagnostic-severity"
          documentUri="file:///diagnostic-severity.py"
          initialSource={severitySource}
          theme={theme}
          colorScheme={defaultEditorSchemes[theme]}
          fontSize={14}
          tabSize={4}
          wrap
          readOnly
          completionEnabled={false}
          intelligenceExtensions={severityExtensions}
          onSourceChange={() => {}}
        />
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<EditorPreview />);
