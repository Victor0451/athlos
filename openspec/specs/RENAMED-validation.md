> **Note, not a capability**

# validation-zod — rename note

## Note: validation-zod → validation rename

**Original capability:** `validation-zod/`
**Destination:** `validation/spec.md`
**Observed:** 2026-06-18

The `validation-zod` capability was renamed to `validation` once the underlying library choice (Zod) stopped being the discriminator — the team standardized on Zod for all runtime validation, making the library name redundant in the capability name. The capabilities defined in the original `validation-zod` spec were preserved verbatim under the new `validation/` directory. This note exists to prevent future `sdd-propose` runs from re-creating `validation-zod` as if it were a new capability.
