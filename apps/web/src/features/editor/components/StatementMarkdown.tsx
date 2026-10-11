/** @file StatementMarkdown.tsx @description Safe statement prose, inline code, and fenced examples. @module editor */
import type { ReactNode } from "react";

/** @returns Text and code nodes without interpreting HTML. */
export function inlineStatement(text: string): ReactNode[] {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    .map((part, index) =>
      part.startsWith("`") && part.endsWith("`") ? (
        <code key={index}>{part.slice(1, -1)}</code>
      ) : part.startsWith("**") && part.endsWith("**") ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    );
}

/** @returns Readable immutable statement blocks; raw HTML remains plain text. */
export function StatementMarkdown({ source }: { source: string }) {
  const blocks = source.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {blocks.map((block, index) =>
        block.startsWith("```") ? (
          <pre key={index}>
            <code>
              {block
                .replace(/^```[^\n]*\n?/, "")
                .replace(/```$/, "")
                .trimEnd()}
            </code>
          </pre>
        ) : (
          <div key={index}>
            {block
              .trim()
              .split(/\n\s*\n/)
              .filter(Boolean)
              .map((paragraph, paragraphIndex) => {
                const lines = paragraph.split("\n");
                if (lines.every((line) => /^[-*] /.test(line)))
                  return (
                    <ul key={paragraphIndex}>
                      {lines.map((line, lineIndex) => (
                        <li key={lineIndex}>{inlineStatement(line.slice(2))}</li>
                      ))}
                    </ul>
                  );
                if (/^#{1,3} /.test(paragraph))
                  return (
                    <h2 key={paragraphIndex}>
                      {inlineStatement(paragraph.replace(/^#{1,3} /, ""))}
                    </h2>
                  );
                return <p key={paragraphIndex}>{inlineStatement(paragraph)}</p>;
              })}
          </div>
        ),
      )}
    </>
  );
}
