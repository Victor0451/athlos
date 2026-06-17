# Delta for notifications

> Source: PR 6b `notifications` spec + Decision 1 (DATA_STEWARD is the routing target for `drift_alert`, not the global ADMIN role). All other notification triggers (import_completed, import_failed, login_new_ip, approval_link_created) are unchanged.

## MODIFIED Requirements

### Requirement: Notification Trigger — Drift Detected

The notification dispatcher MUST trigger when the drift-detector reports drift. The system MUST send `email` to all operators with `email` enabled for `drift_alert` AND role `DATA_STEWARD`. The system MUST insert an `in_app` row for every operator with `in_app` enabled for `drift_alert` AND role `DATA_STEWARD`.

Operators whose role is `ADMIN` MUST NOT receive `drift_alert` notifications. Operators whose role is anything other than `DATA_STEWARD` MUST NOT receive them either. The role filter runs BEFORE preferences.
(Decision 1: drift is a data-quality concern, not an operations concern. Routing to a dedicated `DATA_STEWARD` role gives a small, surgical notification target and avoids spamming all admins with every CTACTE mismatch.)

#### Scenario: Drift detected in CTACTE alerts only DATA_STEWARD operators

- GIVEN drift is detected in domain `ctacte` (5 records)
- AND `steward1` and `steward2` (both DATA_STEWARD) have `email` and `in_app` enabled for `drift_alert`
- AND `admin1` and `admin2` (both ADMIN) also have `email` and `in_app` enabled for `drift_alert`
- WHEN the drift-detector emits the event
- THEN `steward1` and `steward2` MUST each receive one `drift_alert` email
- AND `steward1` and `steward2` MUST each have one in-app row with `event_type: 'drift_alert'`
- AND `admin1` and `admin2` MUST receive ZERO emails and ZERO in-app rows for this event

#### Scenario: Non-DATA_STEWARD roles are excluded

- GIVEN an operator with role `OPERATOR` has `email` enabled for `drift_alert`
- WHEN drift is detected
- THEN that operator MUST NOT receive the drift email
- AND no in-app row MUST be inserted for them
- AND this MUST hold regardless of the preference table, because the role filter runs before preferences

#### Scenario: Zero DATA_STEWARD operators → events are still audited

- GIVEN no operator in the system has role `DATA_STEWARD`
- WHEN drift is detected
- THEN zero emails MUST be sent
- AND zero in-app rows MUST be inserted
- AND the drift itself MUST still be recorded in `audit_events` (via the drift package's direct write — see drift-detector delta) so the event is not silently lost
