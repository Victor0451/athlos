# Doc Bilingual README Specification

## Purpose

Define the structure and content contract for the repository root `README.md` so that it serves as the single bilingual (English + Spanish) entry point for new contributors. The README MUST reflect the current shipped truth of the project (versions, status, layout, run/test commands) and present that truth in both languages without silent drift.

## Requirements

### Requirement: Bilingual Section Layout

The `README.md` MUST contain a single top-level Table of Contents that lists every English section, followed by a clearly-labeled Spanish section (e.g. `## ES` or `## Versión en Español`). The English section MUST be canonical and appear first; the Spanish section MUST mirror the English content. Section headings MUST NOT produce anchor collisions between languages.

#### Scenario: A reader scans the README structure

- GIVEN `README.md` is rendered on GitHub or in a Markdown preview
- WHEN the reader inspects the top-level Table of Contents
- THEN the ToC MUST enumerate every English section header
- AND a parallel Spanish section header MUST be visible below the English content
- AND both languages MUST cover the same canonical topics (versions, status, layout, run commands, test command, package inventory)

### Requirement: Current Tech Stack Versions

`README.md` MUST state the current versions of all core dependencies so a contributor can identify any single version in under 30 seconds. The English and Spanish sections MUST carry identical version numbers.

The README MUST mention at minimum:

- Next.js 16.2.9
- React 19
- Fastify 5
- Pino (logging)
- Zod (validation)
- PostgreSQL 16
- Drizzle ORM (already shipped — MUST NOT say "coming in PR 2")
- pnpm 9.15.9
- Node.js 22
- TypeScript 5.7.2 (strict mode)
- 439/439 tests passing
- 16 internal packages + 4 integration adapters

#### Scenario: A contributor searches for the Next.js version

- GIVEN a contributor is reading `README.md` to find the Next.js version
- WHEN they Ctrl-F for `Next` or `Next.js`
- THEN they MUST find `16.2.9` (or equivalent) within the visible page
- AND the Spanish section MUST show the same version

#### Scenario: The README is grep-checked for stale strings

- GIVEN the README is being verified during the apply phase
- WHEN the verifier greps for `Next.js 15`, `Drizzle lands in PR 2`, or `coming in PR 2+`
- THEN none of those strings MUST appear in `README.md`

### Requirement: Shipped vs In-Development Status

`README.md` MUST distinguish between packages that are already shipped and packages or modules that are planned for follow-up changes. Shipped packages MUST be listed as available; planned work (`athlos-ui`, `athlos-deploy`, `athlos-e2e`) MUST be marked as such, not omitted.

#### Scenario: A contributor evaluates what's safe to depend on

- GIVEN a contributor reads the package inventory section of `README.md`
- WHEN they look up a package name
- THEN shipped packages MUST be labeled as shipped (e.g. status badge or section heading)
- AND in-development modules MUST be labeled as planned or "not yet started", with a pointer to the relevant follow-up change

### Requirement: No Silent Drift Between EN and ES

Both the English and Spanish sections of `README.md` MUST carry equivalent information. A change to either section MUST be reflected in the other before the PR closes.

#### Scenario: A version is bumped in the EN section

- GIVEN the English section of `README.md` is updated (e.g. Next.js version, test count, package count)
- WHEN the PR is opened or amended
- THEN the Spanish section MUST be updated in the same commit (or an immediately following commit)
- AND a CI drift-check (when implemented in a future change) MUST be able to detect any divergence

## Notes

This capability is doc-only. It does NOT affect runtime, schema, API, dependency, or test files. The version bump to `v0.4.0` in `package.json` and the `[0.4.0]` entry in `CHANGELOG.md` are intentionally deferred to PR close per project convention and are scoped by the proposal, not by this spec.