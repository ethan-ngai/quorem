/** Shared registration rules; input schemas allow incomplete values while editing. */
import { z } from "zod";

export const usernameInputSchema = z
  .string()
  .max(30)
  .regex(/^[a-z0-9]*$/);
export const usernameSchema = usernameInputSchema.min(3, "Use 3–30 lowercase letters or digits.");
export const emailInputSchema = z
  .string()
  .max(254)
  .regex(/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~@-]*$/);
export const emailSchema = z.email("Enter a valid email address.").max(254).toLowerCase();
export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(128)
  .regex(/[\p{P}\p{S}]/u, "Include at least one special character.");
export const optionalNameSchema = z
  .string()
  .trim()
  .max(80, "Use at most 80 characters for your name.")
  .regex(/^[^\p{Cc}\p{Cf}]*$/u, "Your name cannot contain control characters.")
  .optional()
  .default("");
export const accountSetupSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  name: optionalNameSchema,
});
