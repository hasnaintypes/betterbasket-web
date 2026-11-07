# Contracts compatibility

Every exported Zod schema has a JSON Schema snapshot in `schema-snapshots/`. The snapshots describe accepted input values. Zod 4's built-in JSON Schema conversion generates them; dates are represented as ISO date-time strings. The exporter sorts object keys, required fields, and enum values to avoid ordering-only changes.

After changing a schema, run `pnpm --filter @betterbasket/contracts build` and `pnpm --filter @betterbasket/contracts schemas:export`, then commit the updated snapshots. CI checks that snapshots match the source and compares them with the PR base branch. Removing or renaming a property, changing a type, removing an enum value, or making an optional field required fails the check. Adding an optional field or widening an enum passes.

For an incompatible change, keep the existing schema and topic intact. Export a new `V2Schema` and a `.v2` topic, dual publish while consumers migrate, and remove the old version only after a coordinated migration. A new versioned schema is additive; editing the old version in place still fails the compatibility check.

## Identity claims and capabilities

`AuthTokenClaimsSchema` describes the v2 user JWT: `sub`, `email`,
`emailVerified`, `platformRole`, nullable `orgId` and `orgRole`, `iss`, `aud`,
`iat`, `exp`, and `jti`. `PlatformRoleSchema` accepts only `customer` and
`admin`; a seller is a customer with organization membership and an eligible
seller state. `CapabilitySchema` lists the names that guards will check,
including the `admin:*` capability. Unknown capability names are rejected.

Issue #19 explicitly replaces the old, internal role and claim shape. The
compatibility checker has an exception for the exact before and after hashes
of the three affected snapshots in `scripts/approved-breaking-changes.json`.
Any later breaking edit to those schemas still fails the comparison. Update
the auth issuer and downstream guards together before using v2 JWTs in a
deployed environment.
