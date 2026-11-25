import { z } from "zod";

const email = z.email().max(320);
const password = z.string().min(12, "Use at least 12 characters").max(128);

export const SignUpInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email,
    password,
    confirmPassword: z.string(),
  })
  .strict()
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export const SignInInputSchema = z.object({ email, password: z.string().min(1) }).strict();
export const ForgotPasswordInputSchema = z.object({ email }).strict();
export const ResetPasswordInputSchema = z
  .object({ password, confirmPassword: z.string() })
  .strict()
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
export const ProfileInputSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
export const ChangePasswordInputSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: password,
    confirmPassword: z.string(),
  })
  .strict()
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
