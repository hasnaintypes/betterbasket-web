import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SignUpInputSchema,
  SignInInputSchema,
  ResetPasswordInputSchema,
  ChangePasswordInputSchema,
} from "../dist/index.js";

test("buyer auth forms reject unknown fields and weak or mismatched passwords", () => {
  const signup = {
    name: "Buyer",
    email: "buyer@example.test",
    password: "a-long-password",
    confirmPassword: "a-long-password",
  };
  assert.equal(SignUpInputSchema.safeParse(signup).success, true);
  assert.equal(SignUpInputSchema.safeParse({ ...signup, password: "short" }).success, false);
  assert.equal(
    SignUpInputSchema.safeParse({ ...signup, confirmPassword: "different" }).success,
    false,
  );
  assert.equal(SignUpInputSchema.safeParse({ ...signup, role: "admin" }).success, false);
  assert.equal(
    SignInInputSchema.safeParse({
      email: signup.email,
      password: signup.password,
      next: "//evil.example",
    }).success,
    false,
  );
  assert.equal(
    ResetPasswordInputSchema.safeParse({ password: signup.password, confirmPassword: "different" })
      .success,
    false,
  );
  assert.equal(
    ChangePasswordInputSchema.safeParse({
      currentPassword: "old",
      newPassword: "short",
      confirmPassword: "short",
    }).success,
    false,
  );
});
