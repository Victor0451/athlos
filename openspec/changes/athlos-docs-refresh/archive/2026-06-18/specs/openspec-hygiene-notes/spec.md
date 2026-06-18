# OpenSpec Hygiene Notes Specification

## Purpose

Document two historical OpenSpec migrations in place — a capability rename (`validation-zod/` → `validation/`) and a capability fold (`user-management-rbac/` absorbed into `auth-login/`) — without moving folders or rewriting archived change artifacts. The notes exist so future `sdd-*` sub-agents and human readers do not re-derive these capabilities from scratch or propose them as if they were new.

## Requirements

### Requirement: Rename Note Exists for Validation

A file MUST exist at `openspec/specs/RENAMED-validation.md`. The file MUST begin with the literal header `> **Note, not a capability**`. The body MUST state the original capability name (`validation-zod/`), the destination capability name (`validation/`), the date of the rename (or `as observed 2026-06-18` if the exact date is unknown), and a one-paragraph rationale explaining why the rename happened (e.g. validation became the canonical name once the underlying library choice stopped being the discriminator).

#### Scenario: A future sdd-propose agent scans the spec tree

- GIVEN `openspec/specs/RENAMED-validation.md` exists
- WHEN a future sdd-propose agent enumerates `openspec/specs/` to find capabilities
- THEN it MUST find the rename note
- AND the note MUST NOT contain any `### Requirement:` block (it is a note, not a capability)
- AND the agent MUST NOT propose adding `validation-zod` as a new capability

### Requirement: Fold Note Exists for RBAC

A file MUST exist at `openspec/specs/auth-login/FOLDED-rbac.md`. The file MUST begin with the literal header `> **Note, not a capability**`. The body MUST state the original capability name (`user-management-rbac/`), the destination (`auth-login/`, with the current `auth-login/spec.md` being the home of the absorbed RBAC content), the date of the fold (or `as observed 2026-06-18`), and a one-paragraph rationale explaining why the content was absorbed.

#### Scenario: A future sdd-spec agent examines auth-login

- GIVEN `openspec/specs/auth-login/FOLDED-rbac.md` exists
- WHEN an sdd-spec agent reads the `auth-login/` folder to understand its history
- THEN it MUST find the fold note in the same directory
- AND the note MUST NOT contain any `### Requirement:` block
- AND the agent MUST NOT propose adding `user-management-rbac` as a new or separate capability

### Requirement: Notes Are Discoverable and Non-Capability

Both note files MUST live directly under `openspec/specs/` (or its direct subdirectories) so any spec-listing tool that walks the tree finds them. Both MUST use the prefix convention `RENAMED-` or `FOLDED-` so they sort to the end of alphabetized capability lists and are visually distinct from real capabilities. Both MUST NOT define any `### Requirement:` block.

#### Scenario: A spec-listing tool enumerates capabilities

- GIVEN both note files exist with their required headers
- WHEN a tool lists every `.md` file under `openspec/specs/` (recursively)
- THEN it MUST include both `RENAMED-validation.md` and `auth-login/FOLDED-rbac.md` in the listing
- AND a human reviewer MUST be able to recognize each as a note (not a capability) by the prefix and the header line within 2 seconds

## Notes

These are hygiene notes, NOT capabilities. They do not introduce, modify, or remove any requirement on runtime behavior. They exist solely to preserve migration history in place, which is safer than moving or renaming folders (folder moves would break any external links and would require rewriting the `athlos-foundation` archive). The `RENAMED-` and `FOLDED-` filename prefixes, combined with the `> **Note, not a capability**` header, are the two signals future readers (human or agent) MUST rely on to distinguish these files from real capability specs.