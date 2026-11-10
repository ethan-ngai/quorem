/** @file StatementMarkdown.tsx @description Safe Markdown and bounded mathematics. @module editor */
import { Fragment } from "react";
import { CodeLiteral } from "./CodeLiteral";
import { renderStatementFigure, type ExampleArgument } from "./StatementFigure";
import { useQuestionLanguage } from "../QuestionLanguage";
import type { EditorLanguage } from "../editorLanguages";
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

const fenceLanguages: Record<string, EditorLanguage> = {
  py: "python",
  python: "python",
  java: "java",
  js: "typescript",
  javascript: "typescript",
  ts: "typescript",
  typescript: "typescript",
  ml: "ocaml",
  ocaml: "ocaml",
  sql: "postgresql",
  postgres: "postgresql",
  postgresql: "postgresql",
  pseudocode: "python",
};

function renderMarkdown(
  source: string,
  inline: boolean,
  language?: EditorLanguage,
  allowFigures = false,
  exampleArgument?: ExampleArgument,
): ReactNode[] {
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
        return <CodeLiteral key={key} source={node.value} language={language} />;
      case "code": {
        const fence = node.lang?.toLowerCase() ?? "";
        if (allowFigures && (fence === "grid" || fence === "svg")) {
          const figure = renderStatementFigure(fence, node.value, node.meta, exampleArgument);
          if (figure) return <Fragment key={key}>{figure}</Fragment>;
        }
        return (
          <CodeLiteral
            key={key}
            block
            source={node.value}
            language={Object.hasOwn(fenceLanguages, fence) ? fenceLanguages[fence] : language}
          />
        );
      }
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

export function StatementMarkdown({
  source,
  allowFigures = false,
  exampleArgument,
}: {
  source: string;
  allowFigures?: boolean;
  exampleArgument?: ExampleArgument;
}) {
  const language = useQuestionLanguage();
  return <>{renderMarkdown(source.trim(), false, language, allowFigures, exampleArgument)}</>;
}
