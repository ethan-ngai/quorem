import type { Signature } from "@quorem/contracts";
import { Fragment } from "react";
import { TypeSyntax } from "./TypeSyntax";
import "./code-literal.css";

/** The same language-aware signature in authoring and in the public question. */
export function MethodSignature({ signature }: { signature: Signature }) {
  return (
    <code className="machine-value code-literal">
      <span className="code-function">{signature.methodName || "method"}</span>
      <span className="code-operator">(</span>
      {signature.parameters.map(({ name, type }, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="code-operator">, </span>}
          <span className="code-parameter">{name}</span>
          <span className="code-operator">: </span>
          <TypeSyntax type={type} />
        </Fragment>
      ))}
      <span className="code-operator">) → </span>
      <TypeSyntax type={signature.returnType} />
    </code>
  );
}
