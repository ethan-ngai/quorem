/** @file CaseFields.tsx @description Shared typed case editing and one contextual structure preview. @module editor */
import type { Signature } from "@quorem/contracts";
import type { ReactNode } from "react";
import { caseFieldConfig } from "../inputPresets";
import { CasePreviewLayout } from "./NodePreview";
import { TypedCaseInput } from "./TypedCaseInput";

export function CaseFields({
  id,
  signature,
  args,
  expected,
  expectedAction,
  onChange,
  children,
  preview = true,
  inputErrors,
}: {
  id: string;
  signature: Signature;
  args: readonly string[];
  expected?: string;
  expectedAction?: ReactNode;
  onChange: (patch: { args?: string[]; expected?: string }) => void;
  children?: ReactNode;
  preview?: boolean;
  inputErrors?: Readonly<Record<string, string>>;
}) {
  return (
    <CasePreviewLayout
      editable
      enabled={preview}
      context={{ signature, sources: args }}
      expectedSource={expected}
    >
      {signature.parameters.map(({ name, type, input }, index) => (
        <TypedCaseInput
          key={name}
          id={`${id}-${index}`}
          name={name}
          type={type}
          input={caseFieldConfig(signature, type, input, false, { sources: args })}
          value={args[index] ?? ""}
          validationError={inputErrors?.[name]}
          onChange={(value) =>
            onChange({
              args: signature.parameters.map((_, position) =>
                position === index ? value : (args[position] ?? ""),
              ),
            })
          }
        />
      ))}
      {expected !== undefined && signature.returnType !== "void" && (
        <div className="expected-field">
          <TypedCaseInput
            id={`${id}-expected`}
            name="Expected output"
            purpose="expected"
            type={signature.returnType}
            input={caseFieldConfig(signature, signature.returnType, undefined, true, {
              sources: args,
            })}
            value={expected}
            validationError={inputErrors?.["Expected output"]}
            action={expectedAction}
            onChange={(expected) => onChange({ expected })}
          />
        </div>
      )}
      {children}
    </CasePreviewLayout>
  );
}
