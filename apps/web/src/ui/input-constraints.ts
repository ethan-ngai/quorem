import { z } from "zod";

export type InputConstraint = {
  edit: (value: string) => boolean;
  schema: z.ZodType<string>;
  trim?: boolean;
};

const singleLineEdit = (value: string) => !/[\p{Cc}\p{Cf}]/u.test(value);
const nameEdit = (value: string) => singleLineEdit(value) && !/ {2}/.test(value);
const singleLineSchema = z.string().min(1).refine(singleLineEdit);
const scientificComplete = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function numeric(
  integer: boolean,
  { min, max }: { min?: number; max?: number } = {},
): InputConstraint {
  const pattern = integer ? /^-?\d*$/ : /^-?(?:\d+)?(?:\.\d*)?$/;
  const complete = integer ? /^-?\d+$/ : /^-?(?:\d+\.?\d*|\.\d+)$/;
  return {
    edit: (value) =>
      pattern.test(value) &&
      (!complete.test(value) || Number.isFinite(Number(value))) &&
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
  name: { edit: nameEdit, schema: singleLineSchema.refine(nameEdit), trim: true },
  tag: { edit: nameEdit, schema: singleLineSchema.refine(nameEdit), trim: true },
  identifier: {
    edit: (value: string) => value.length <= 80 && /^(?:[A-Za-z_][A-Za-z0-9_]*)?$/.test(value),
    schema: z
      .string()
      .max(80)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    trim: true,
  },
  slug: {
    edit: (value: string) =>
      value.length <= 80 && /^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*-?)?$/.test(value),
    schema: z
      .string()
      .max(80)
      .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    trim: true,
  },
  integer: (bounds?: { min?: number; max?: number }) => numeric(true, bounds),
  scientific: {
    edit: (value: string) =>
      /^-?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d*)?|\.)?$/.test(value) &&
      (!scientificComplete.test(value) || Number.isFinite(Number(value))),
    schema: z
      .string()
      .regex(scientificComplete)
      .refine((value) => Number.isFinite(Number(value))),
    trim: true,
  },
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

function withLengthLimit(
  constraint: InputConstraint,
  max: number,
  measure: (value: string) => number,
): InputConstraint {
  const withinLimit = (value: string) => measure(value) <= max;
  return {
    ...constraint,
    edit: (value) => constraint.edit(value) && withinLimit(value),
    schema: constraint.schema.refine(withinLimit),
  };
}

/** Apply limits measured in UTF-8 bytes, matching persisted question contracts. */
export function withMaxBytes(constraint: InputConstraint, max: number): InputConstraint {
  return withLengthLimit(constraint, max, (value) => new TextEncoder().encode(value).length);
}

/** Count Unicode characters as the interview and guest policies do. */
export function withMaxCharacters(constraint: InputConstraint, max: number): InputConstraint {
  return withLengthLimit(constraint, max, (value) => Array.from(value).length);
}
