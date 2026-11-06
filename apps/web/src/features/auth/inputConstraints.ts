import { z } from "zod";
import {
  emailInputSchema,
  emailSchema,
  usernameInputSchema,
  usernameSchema,
} from "@quorem/contracts/auth";
import type { InputConstraint } from "../../ui/input-constraints";

export const authInputConstraints = {
  email: {
    edit: (value: string) => emailInputSchema.safeParse(value).success,
    schema: emailSchema,
  },
  username: {
    edit: (value: string) => usernameInputSchema.safeParse(value).success,
    schema: usernameSchema,
  },
  password: { edit: (value: string) => value.length <= 128, schema: z.string().max(128) },
  code: { edit: (value: string) => /^\d{0,6}$/.test(value), schema: z.string().regex(/^\d{6}$/) },
} satisfies Record<string, InputConstraint>;
