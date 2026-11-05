import type { Signature } from "@quorem/contracts";
import { methodDeclaration } from "../../odyssey/methodStubs";
import { useQuestionLanguage } from "../QuestionLanguage";
import { CodeLiteral } from "./CodeLiteral";

/** Preview the declaration the workspace inserts when it unlocks a method. */
export function MethodSignature({ signature }: { signature: Signature }) {
  const language = useQuestionLanguage();
  return (
    <CodeLiteral
      className="machine-value code-literal"
      language={language}
      source={methodDeclaration(signature, language)}
    />
  );
}
