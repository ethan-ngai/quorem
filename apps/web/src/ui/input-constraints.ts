import { z } from "zod";

export type InputConstraint = {
  edit: (value: string) => boolean;
  schema: z.ZodType<string>;
  trim?: boolean;
};

const singleLineEdit = (value: string) => !/[\p{Cc}\p{Cf}]/u.test(value);
const nameEdit = (value: string) => singleLineEdit(value) && !/ {2}/.test(value);
const singleLineSchema = z.string().min(1).refine(singleLineEdit);

function numeric(
  integer: boolean,
  { min, max }: { min?: number; max?: number } = {},
): InputConstraint {
  const pattern = integer ? /^-?\d*$/ : /^-?(?:\d+)?(?:\.\d*)?$/;
  const complete = integer ? /^-?\d+$/ : /^-?(?:\d+\.?\d*|\.\d+)$/;
  return {
    edit: (value) =>
      pattern.test(value) &&
      !(min !== undefined && min >= 0 && value.startsWith("-")) &&
      !(max !== undefined && max >= 0 && complete.test(value) && Number(value) > max),
    schema: z.string().refine((value) => {
      if (!complete.test(value)) return false;
      const number = Number(value);
      return (
        Number.isFinite(number) &&
        (min === undefined || number >= min) &&
        (max === undefined || number <= max)
      );
    }),
    trim: true,
  };
}

export const inputConstraints = {
  singleLine: { edit: singleLineEdit, schema: singleLineSchema, trim: true },
  name: { edit: nameEdit, schema: singleLineSchema.refine(nameEdit), trim: true },
  tag: { edit: nameEdit, schema: singleLineSchema.refine(nameEdit), trim: true },
  identifier: {
    edit: (value: string) => /^(?:[A-Za-z_][A-Za-z0-9_]*)?$/.test(value),
    schema: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    trim: true,
  },
  email: {
    edit: (value: string) => !/\s/.test(value),
    schema: z.email(),
    trim: true,
  },
  integer: (bounds?: { min?: number; max?: number }) => numeric(true, bounds),
  decimal: (bounds?: { min?: number; max?: number }) => numeric(false, bounds),
} satisfies Record<
  string,
  InputConstraint | ((bounds?: { min?: number; max?: number }) => InputConstraint)
>;

export function isAllowedInput(value: string, constraint: InputConstraint): boolean {
  return constraint.edit(value);
}

export function validateInput(value: string, constraint: InputConstraint) {
  return constraint.schema.safeParse(constraint.trim ? value.trimEnd() : value);
}
