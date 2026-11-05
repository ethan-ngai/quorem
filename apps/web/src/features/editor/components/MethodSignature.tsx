import type { Signature } from "@quorem/contracts";
import { methodDeclarationParts } from "../../odyssey/methodStubs";
import { useQuestionLanguage } from "../QuestionLanguage";
import { TypeSyntaxText } from "./TypeSyntax";
import "./code-literal.css";

/** Highlight the same declaration the workspace inserts when it unlocks a method. */
export function MethodSignature({ signature }: { signature: Signature }) {
  const language = useQuestionLanguage();
  return (
    <code className="machine-value code-literal">
      {methodDeclarationParts(signature, language).map(({ text, role }, index) =>
        role === "type" ? (
          <TypeSyntaxText
            key={index}
            text={language === "java" ? text.replace(/\bjava\.util\.List(?=<)/g, "List") : text}
          />
        ) : (
          <span className={`code-${role}`} key={index}>
            {text}
          </span>
        ),
      )}
    </code>
  );
}
