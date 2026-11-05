import type { Signature } from "@quorem/contracts";
import { Fragment } from "react";
import { useQuestionLanguage } from "../QuestionLanguage";
import { questionTypeName } from "../questionTypes";
import "./code-literal.css";

/** The same language-aware signature in authoring and in the public question. */
export function MethodSignature({ signature }: { signature: Signature }) {
  const language = useQuestionLanguage();
  return (
    <code className="machine-value code-literal">
      <span className="code-type">{signature.className}</span>.
      <span className="code-function">{signature.methodName || "method"}</span>(
      {signature.parameters.map(({ name, type }, index) => (
        <Fragment key={index}>
          {index > 0 && ", "}
          <span className="code-parameter">{name}</span>
          {": "}
          <span className="code-type">{questionTypeName(type, language)}</span>
        </Fragment>
      ))}
      {") → "}
      <span className="code-type">{questionTypeName(signature.returnType, language)}</span>
    </code>
  );
}
