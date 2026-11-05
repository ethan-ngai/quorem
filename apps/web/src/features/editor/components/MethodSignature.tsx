import type { Signature } from "@quorem/contracts";
import { methodDocumentation } from "../../odyssey/methodDocumentation";
import { methodDeclarationParts } from "../../odyssey/methodStubs";
import { useQuestionLanguage } from "../QuestionLanguage";
import { TypeSyntaxText } from "./TypeSyntax";
import "./code-literal.css";

/** Highlight the same declaration the workspace inserts when it unlocks a method. */
export function MethodSignature({
  signature,
  showDocumentation = false,
}: {
  signature: Signature;
  showDocumentation?: boolean;
}) {
  const language = useQuestionLanguage();
  const documentation = showDocumentation
    ? methodDocumentation(signature, language, language === "python" ? "    " : "").trimEnd()
    : "";
  const comment = documentation && <span className="code-doc-comment">{documentation}</span>;
  return (
    <code className="machine-value code-literal">
      {comment && language !== "python" && (
        <>
          {comment}
          {"\n"}
        </>
      )}
      {methodDeclarationParts(signature, language).map(({ text, role }, index) =>
        role === "type" ? (
          <TypeSyntaxText key={index} text={text} />
        ) : (
          <span className={`code-${role}`} key={index}>
            {text}
          </span>
        ),
      )}
      {comment && language === "python" && (
        <>
          {"\n"}
          {comment}
        </>
      )}
    </code>
  );
}
