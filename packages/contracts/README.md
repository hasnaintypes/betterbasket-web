# Contracts compatibility

Every exported Zod schema has a JSON Schema snapshot in `schema-snapshots/`. The snapshots describe accepted input values. Zod 4's built-in JSON Schema conversion generates them; dates are represented as ISO date-time strings. The exporter sorts object keys, required fields, and enum values to avoid ordering-only changes.

After changing a schema, run `pnpm --filter @betterbasket/contracts build` and `pnpm --filter @betterbasket/contracts schemas:export`, then commit the updated snapshots. CI checks that snapshots match the source and compares them with the PR base branch. Removing or renaming a property, changing a type, removing an enum value, or making an optional field required fails the check. Adding an optional field or widening an enum passes.

For an incompatible change, keep the existing schema and topic intact. Export a new `V2Schema` and a `.v2` topic, dual publish while consumers migrate, and remove the old version only after a coordinated migration. A new versioned schema is additive; editing the old version in place still fails the compatibility check.
