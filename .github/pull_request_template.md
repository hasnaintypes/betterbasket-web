## Linked issue

Closes #<!-- issue number --> (planning id, e.g. M01-04: )

## Requirements covered

<!-- Requirement ids / acceptance criteria from the issue that this PR satisfies -->

## What changed and why

<!-- Short summary. Note any deviation from the issue and why. -->

## Architectural impact

<!-- New dependencies, changed contracts/schemas/events, new services or env vars. "None" if none. -->

## Tests added or changed

<!-- Unit / integration / contract / E2E / security tests, and how to run them. Paste evidence for each acceptance criterion. -->

## Documentation updated

<!-- In-repo docs (README, .env.*.example, OpenAPI/Swagger). Private design docs: list the changes needed. -->

## Migration / deployment impact

<!-- Database migrations (expand/contract), config changes, rollout or rollback notes. "None" if none. -->

## Checklist

- [ ] `pnpm turbo run lint type-check test build --filter=<changed packages>...` passes locally
- [ ] Acceptance criteria verified; negative/authorization tests added where relevant
- [ ] No secrets, credentials or real customer/payment data in code, fixtures, logs or this PR
- [ ] Payments: test mode only (no live keys); provisional policies stay configurable
- [ ] I did not make an unplanned architectural decision (raised `blocked:decision` instead)
