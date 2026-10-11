/** @file StatementMarkdown.tsx @description Restricted inline Markdown and bounded mathematics. @module editor */
import type { ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { fromMarkdown } from "mdast-util-from-markdown";
import { mathFromMarkdown } from "mdast-util-math";
import { math } from "micromark-extension-math";
import type { Nodes } from "mdast";

function InlineMath({ value, source }: { value: string; source: string }) {
  if (value.length > 4096) return source;
  try {
    const html = katex.renderToString(value, {
      displayMode: false,
      throwOnError: true,
      strict: "error",
      trust: false,
      macros: {},
      maxSize: 10,
      maxExpand: 100,
    });
    // Only KaTeX output enters HTML; authored Markdown never enters this sink.
    return <span className="statement-math" dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return source;
  }
}

/** Only inline code, emphasis and mathematics have rendering semantics. */
export function inlineStatement(source: string): ReactNode[] {
  const tree = fromMarkdown(source, {
    extensions: [math()],
    mdastExtensions: [mathFromMarkdown()],
  });
  const render = (node: Nodes, key: number): ReactNode => {
    const literal = source.slice(node.position?.start.offset, node.position?.end.offset);
    switch (node.type) {
      case "text":
        return node.value;
      case "inlineCode":
        return <code key={key}>{node.value}</code>;
      case "strong":
        return <strong key={key}>{node.children.map(render)}</strong>;
      case "emphasis":
        return <em key={key}>{node.children.map(render)}</em>;
      case "inlineMath":
        return <InlineMath key={key} value={node.value} source={literal} />;
      case "paragraph":
        return node.children.map(render);
      default:
        return literal;
    }
  };
  let end = 0;
  const rendered: ReactNode[] = [];
  tree.children.forEach((node, index) => {
    const start = node.position?.start.offset ?? end;
    rendered.push(source.slice(end, start), render(node, index));
    end = node.position?.end.offset ?? start;
  });
  rendered.push(source.slice(end));
  return rendered;
}

/** Paragraph boundaries remain explicit; block Markdown stays literal. */
export function StatementMarkdown({ source }: { source: string }) {
  return (
    <>
      {source
        .trim()
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((paragraph, index) => (
          <p key={index}>{inlineStatement(paragraph)}</p>
        ))}
    </>
  );
}
