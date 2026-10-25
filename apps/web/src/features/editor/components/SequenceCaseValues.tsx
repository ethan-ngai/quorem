/** @file SequenceCaseValues.tsx @description Stateful calls use the shared test-value presentation. @module editor */
import type { ProblemVersion, MethodCall } from "@quorem/contracts";
import { bindArguments } from "../argumentBinding";
import { CaseValue } from "./CaseOutput";

export function SequenceCaseValues({
  problem,
  calls,
}: {
  problem: ProblemVersion;
  calls: MethodCall[];
}) {
  const methods = problem.odyssey?.levels.flatMap((level) => level.methods) ?? [problem.signature];
  return (
    <>
      {calls.map((call, index) => {
        const signature = methods.find((method) => method.methodName === call.methodName);
        return (
          <div className="case-call" key={index}>
            <strong className="parameter-name">{call.methodName}</strong>
            {(signature
              ? bindArguments(signature, call.args)
              : call.args.map((value, index) => ({ name: `Argument ${index + 1}`, value }))
            ).map(({ name, value }) => (
              <CaseValue key={name} name={name} value={value} parameter />
            ))}
            {call.expected !== undefined && (
              <CaseValue
                name="Expected output"
                purpose="target"
                value={call.expected}
                tone="verdict-success"
              />
            )}
          </div>
        );
      })}
    </>
  );
}
