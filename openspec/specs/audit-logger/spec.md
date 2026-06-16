# Audit Logger Specification

## Purpose

Audit logging system for operator actions and socio data changes. Provides immutable, queryable audit trail for compliance, debugging, and accountability.

## Requirements

### Requirement: Immutable Audit Trail

The system MUST record all auditable events in an append-only audit log. Audit records MUST NOT be updated or deleted after insertion.

#### Scenario: Audit record is immutable

- GIVEN an audit record with id=12345 exists
- WHEN any update or delete is attempted on that record
- THEN the operation MUST be rejected with an error

### Requirement: API Operation Logging

The system MUST log all API operations (create, update, delete) with: operator_id, timestamp, action type, entity type, entity_id, old_value, new_value, and source IP.

#### Scenario: API create logged

- GIVEN operator "OP-001" creates a new socio record via API
- WHEN the create request is processed
- THEN audit log MUST contain: operator_id="OP-001", action="CREATE", entity_type="socio", entity_id="SOC-NEW", old_value=null, new_value="<record>", source_ip="192.168.1.10"

#### Scenario: API update logged

- GIVEN operator "OP-002" updates socio "SOC-001" address via API
- WHEN the update request is processed
- THEN audit log MUST contain: operator_id="OP-002", action="UPDATE", entity_type="socio", entity_id="SOC-001", old_value="<old-address>", new_value="<new-address>", source_ip="192.168.1.11"

#### Scenario: API delete logged

- GIVEN operator "OP-001" deletes a payment record via API
- WHEN the delete request is processed
- THEN audit log MUST contain: operator_id="OP-001", action="DELETE", entity_type="pago", entity_id="PAGO-123", old_value="<record>", new_value=null, source_ip="192.168.1.10"

### Requirement: Socio Card Change Events

The system MUST log socio card lifecycle events: sport changes, payment registrations, new members (alta), member exits (baja), and data edits.

#### Scenario: New member (alta) logged

- GIVEN a new socio is registered in the system
- WHEN the registration completes
- THEN audit log MUST contain: action="ALTA", entity_type="socio", entity_id="SOC-NEW", details including sport_id and alta timestamp

#### Scenario: Member exit (baja) logged

- GIVEN socio "SOC-001" is marked as baja (exit)
- WHEN the baja is processed
- THEN audit log MUST contain: action="BAJA", entity_type="socio", entity_id="SOC-001", details including baja reason and timestamp

#### Scenario: Sport change logged

- GIVEN socio "SOC-001" changes sport from "futbol" to "basquet"
- WHEN the sport change is processed
- THEN audit log MUST contain: action="SPORT_CHANGE", entity_type="socio", entity_id="SOC-001", old_value="futbol", new_value="basquet"

#### Scenario: Payment registration logged

- GIVEN a payment of 500 is registered for socio "SOC-001"
- WHEN the payment is recorded
- THEN audit log MUST contain: action="PAYMENT_REG", entity_type="pago", entity_id="PAGO-NEW", new_value="<payment-amount:500>", details including socio_id

### Requirement: Audit Query Interface

The system MUST provide a query interface for operators and admins to search and filter audit records by operator, entity, action type, and date range.

#### Scenario: Query by operator

- GIVEN audit records exist for operators "OP-001" and "OP-002"
- WHEN admin queries audit log with filter operator_id="OP-001"
- THEN response MUST return only records where operator_id="OP-001"

#### Scenario: Query by date range

- GIVEN audit records exist from the past 30 days
- WHEN admin queries with start_date="2024-06-01" and end_date="2024-06-30"
- THEN response MUST return only records within that date range

### Requirement: Lineage Integration

Audit events MUST be integrated into the existing lineage system as first-class lineage events, enabling traceability from displayed facts to the operator action that created or modified them.

#### Scenario: Audit event in lineage chain

- GIVEN socio "SOC-001" was created by operator "OP-001" via API
- WHEN lineage query is executed for SOC-001
- THEN lineage chain MUST include the audit event showing operator_id, action, and timestamp

## Input/Output Contracts

### Audit Record Schema

```typescript
interface AuditRecord {
  id: string;              // UUID
  operator_id: string;     // Operator who performed the action
  timestamp: string;       // ISO 8601
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'ALTA' | 'BAJA' | 'SPORT_CHANGE' | 'PAYMENT_REG';
  entity_type: string;     // e.g., 'socio', 'pago', 'deporte'
  entity_id: string;       // ID of the affected entity
  old_value: object | null;
  new_value: object | null;
  source_ip: string;
  metadata?: object;       // Optional extra context
}
```

### Audit Query API

```typescript
interface AuditQuery {
  operator_id?: string;
  entity_type?: string;
  entity_id?: string;
  action?: string;
  start_date?: string;     // ISO 8601
  end_date?: string;       // ISO 8601
  limit?: number;         // Default 100
  offset?: number;
}

interface AuditQueryResponse {
  records: AuditRecord[];
  total: number;
  limit: number;
  offset: number;
}
```

## Success Criteria

- All API operations (create/update/delete) produce audit records
- All socio card events (alta, baja, sport change, payment reg) produce audit records
- Audit records are immutable — no update or delete permitted
- Query interface supports filtering by operator, entity, action, and date range
- Audit events appear in lineage queries for affected entities
- Audit log is append-only with no mutation pathways
