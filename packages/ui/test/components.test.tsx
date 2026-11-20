import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "@betterbasket/api-client";
import { ErrorView } from "../src/components/error-view";
import { Button } from "../src/components/button";
import { Dialog } from "../src/components/dialog";
import { FormField } from "../src/components/form";
import { Input } from "../src/components/input";

test("boundary shows a safe API message, request ID, and retry control", () => {
  const error = new ApiError("REQUEST_IN_PROGRESS", "Please retry", "request-123");
  const html = renderToStaticMarkup(<ErrorView error={error} reset={() => {}} />);
  assert.match(html, /Please retry/);
  assert.match(html, /Request ID: request-123/);
  assert.match(html, /Try again/);
  assert.match(html, /role="alert"/);
});

test("boundary hides unexpected exception details", () => {
  const html = renderToStaticMarkup(
    <ErrorView error={new Error("private database connection string")} reset={() => {}} />,
  );
  assert.doesNotMatch(html, /private database/);
  assert.match(html, /Please try again/);
});

test("form primitives have labels and buttons do not submit by default", () => {
  const html = renderToStaticMarkup(
    <FormField id="email" label="Email" error="Required">
      <Input id="email" aria-describedby="email-error" />
    </FormField>,
  );
  assert.match(html, /for="email"/);
  assert.match(html, /aria-describedby="email-error"/);
  assert.match(html, /role="alert"/);
  assert.match(renderToStaticMarkup(<Button>Save</Button>), /type="button"/);
});

test("dialog has an accessible name", () => {
  const html = renderToStaticMarkup(
    <Dialog open={false} onOpenChange={() => {}} title="Confirm change">
      Continue?
    </Dialog>,
  );
  assert.match(html, /aria-labelledby=/);
  assert.match(html, /Confirm change/);
});
