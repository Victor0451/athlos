> **Note, not a capability**

# user-management-rbac — fold note

## Note: user-management-rbac → auth-login absorption

**Original capability:** `user-management-rbac/`
**Destination:** `auth-login/spec.md` (absorbed into REQ-3)
**Observed:** 2026-06-18

The `user-management-rbac` capability was absorbed into `auth-login` once RBAC became a cross-cutting concern of authentication and authorization — no longer a standalone domain. The requirements defined in the original `user-management-rbac` spec (4 roles + overrides, effective permissions = role⊕flags⊕delegations, password history 10 hashes) were merged into `auth-login`'s REQ-3 (Role-based access control). This note exists to prevent future `sdd-propose` runs from re-creating `user-management-rbac` as if it were a new capability.
