import type { Signature } from "@quorem/contracts";
import { useQuestionLanguage } from "../QuestionLanguage";
import { questionTypeName } from "../questionTypes";

/** The same readable signature in authoring and the public preview. */
export function MethodSignature({ signature }: { signature: Signature }) {
  const language = useQuestionLanguage();
  const parameters = signature.parameters.map(
    ({ name, type }) => `${name}: ${questionTypeName(type, language)}`,
  );
  return (
    <code className="machine-value">
      {signature.className}.{signature.methodName || "method"}({parameters.join(", ")}) →{" "}
      {questionTypeName(signature.returnType, language)}
    </code>
  );
}
