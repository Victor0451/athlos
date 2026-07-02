# Module Package Map Specification

## Purpose

Provide a single authoritative table that maps each documented product module to the code (apps, packages, integration adapters) that implements or will implement it. The map lives in the Obsidian vault at `5-Modules/8-Module-Package-Map.md` and serves as the bridge between product-facing documentation (`5-Modules/0-Inventory.md`) and the engineering monorepo.

## Requirements

### Requirement: Map File Exists With Review Stamp

A file MUST exist at `5-Modules/8-Module-Package-Map.md` in the Obsidian vault. The file MUST begin with a `> Last reviewed: 2026-06-18` stamp (or a current-date stamp) that signals the last time the table was verified against the live monorepo. The stamp MUST be re-applied on every refresh.

#### Scenario: An sdd-explore sub-agent queries the review date

- GIVEN the map file exists at `5-Modules/8-Module-Package-Map.md`
- WHEN an sdd-explore sub-agent reads the first 10 lines of the file
- THEN it MUST find a `> Last reviewed:` line containing a recent ISO date (e.g. `2026-06-18`)
- AND the date MUST serve as the freshness signal that prompts re-verification

### Requirement: All Nine Product Modules Listed

The map MUST enumerate all 9 product modules documented in `5-Modules/0-Inventory.md`: Padrón, Cuenta Corriente, Auth/Roles, Disciplinas, Escuela, Contabilidad, Tesorería, Cuota Social, and Reportes. Each module MUST appear as one row in the table.

#### Scenario: A reader searches for the Disciplinas module

- GIVEN the map file exists
- WHEN a contributor Ctrl-F for `Disciplinas` (or any other module name from the inventory)
- THEN they MUST find exactly one matching row
- AND that row MUST state Disciplinas' primary code home, packages used, and status

### Requirement: Each Row Declares Code Home, Packages, and Status

Every module row MUST declare at minimum:

- **Module name** (canonical product name from the inventory)
- **Primary code home** (app + path, e.g. `apps/api/src/modules/socios`, or `legacy-only` / `not yet started`)
- **Packages used** (names of `@athlos/*` packages or integration adapters, or `none`)
- **Status** — one of `shipped`, `legacy-only`, `partial`, or `not yet started`

#### Scenario: An sdd-explore sub-agent looks up Cuota Social

- GIVEN the map file exists with all 9 rows
- WHEN an sdd-explore sub-agent searches for `Cuota Social`
- THEN the row MUST declare the primary code home (e.g. `legacy-only` if no dedicated folder exists, or a path under `apps/api/src/modules/`)
- AND the row MUST list the packages used (e.g. `@athlos/ctacte` if the module is part of the cuenta corriente domain, or `none`)
- AND the row MUST declare a status that reflects the actual state of the code

#### Scenario: A reader cross-checks the Padrón module against the repo

- GIVEN the map declares Padrón's primary code home as `apps/api/src/modules/socios`
- WHEN a contributor runs `ls apps/api/src/modules/`
- THEN the directory MUST exist and contain module code
- AND the map MUST NOT claim a code home that does not exist on disk

## Notes

This capability is doc-only. It does NOT add or modify runtime code. Status values are intentionally limited to four discrete buckets (`shipped`, `legacy-only`, `partial`, `not yet started`) to keep the map legible and to make future drift detection trivial. A CI drift-check workflow is deferred to a follow-up change and is out of scope here.