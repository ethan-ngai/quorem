/** @file StatementMarkdown.tsx @description Safe Markdown and bounded mathematics. @module editor */
import type { ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { gfm } from "micromark-extension-gfm";
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

function safeLink(value: string): string | undefined {
  try {
    const url = new URL(value, "https://leetcode.com");
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function renderMarkdown(source: string, inline: boolean): ReactNode[] {
  const tree = fromMarkdown(source, {
    extensions: [math(), gfm()],
    mdastExtensions: [mathFromMarkdown(), gfmFromMarkdown()],
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
        return inline ? node.children.map(render) : <p key={key}>{node.children.map(render)}</p>;
      case "break":
        return <br key={key} />;
      case "list":
        return node.ordered ? (
          <ol key={key}>{node.children.map(render)}</ol>
        ) : (
          <ul key={key}>{node.children.map(render)}</ul>
        );
      case "listItem":
        return <li key={key}>{node.children.map(render)}</li>;
      case "table":
        return (
          <table key={key}>
            <thead>
              <tr>
                {node.children[0]?.children.map((cell, i) => (
                  <th key={i}>{cell.children.map(render)}</th>
                ))}
              </tr>
            </thead>
            <tbody>{node.children.slice(1).map(render)}</tbody>
          </table>
        );
      case "tableRow":
        return <tr key={key}>{node.children.map(render)}</tr>;
      case "tableCell":
        return <td key={key}>{node.children.map(render)}</td>;
      case "link": {
        const href = safeLink(node.url);
        return href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {node.children.map(render)}
          </a>
        ) : (
          literal
        );
      }
      case "image": {
        const src = safeLink(node.url);
        // Problem diagrams use LeetCode's public asset hosts only.
        return src &&
          ["assets.leetcode.com", "s3-lc-upload.s3.amazonaws.com"].includes(
            new URL(src).hostname,
          ) ? (
          <img
            key={key}
            src={src}
            alt={node.alt ?? ""}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          literal
        );
      }
      default:
        return literal;
    }
  };
  return tree.children.map(render);
}

export function inlineStatement(source: string): ReactNode[] {
  return renderMarkdown(source, true);
}

export function StatementMarkdown({ source }: { source: string }) {
  return <>{renderMarkdown(source.trim(), false)}</>;
}
