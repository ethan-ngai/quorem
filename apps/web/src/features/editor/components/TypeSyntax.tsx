import { Fragment } from "react";
import { useQuestionLanguage } from "../QuestionLanguage";
import { questionTypeName } from "../questionTypes";
import { valueAtoms, valueWrappers } from "../typedValues";
import "./code-literal.css";

const containers: ReadonlySet<string> = new Set([...valueWrappers, "java.util.List", "option"]);
const atoms: ReadonlySet<string> = new Set([
  ...valueAtoms.filter((type) => type !== "ListNode" && type !== "TreeNode"),
  "void",
]);

/** Color a type component without treating a generic expression as one token. */
export function typeTokenClass(token: string) {
  if (containers.has(token)) return "code-generic";
  if (atoms.has(token)) return "code-primitive";
  return "code-type";
}

export function TypeSyntax({ type }: { type: string }) {
  const language = useQuestionLanguage();
  const primitives = new Set([
    ...[...atoms].map((atom) => questionTypeName(atom, language)),
    // Java boxes scalar values inside generic types.
    "Integer",
    "Long",
    "Double",
    "Boolean",
    // Optional TypeScript values are rendered as a union.
    "null",
  ]);
  const tokens = questionTypeName(type, language).match(/[\w.]+|\s+|[^\w.\s]/g) ?? [];
  return tokens.map((token, index) => (
    <Fragment key={index}>
      {/\s/.test(token) ? (
        token
      ) : (
        <span
          className={
            !/^[\w.]+$/.test(token)
              ? "code-operator"
              : containers.has(token)
                ? "code-generic"
                : primitives.has(token)
                  ? "code-primitive"
                  : "code-type"
          }
        >
          {token}
        </span>
      )}
    </Fragment>
  ));
}
