# Delta for Notifications

## MODIFIED Requirements

### Requirement: Email Adapter Contract

The email adapter MUST expose a single `send(to, subject, body, context)` method. Adapters MUST live in `packages/integrations/email/`. A `RealEmailAdapter` MUST use nodemailer and report a `messageId` only after its SMTP transport acknowledges submission; a synthetic, pending, locally generated, or pre-transport identifier MUST NOT represent delivery. A `StubEmailAdapter` MUST record every send into an instance-owned in-memory `outbox` exposed on the injected stub instance for deterministic test assertions, matching the repository pattern in which each `StubWhatsApp` instance owns `stub.messages`; no global hook SHALL be introduced. Contact delivery MUST be bounded by the existing five-second SMTP timeout and failure MUST be observable to the contact caller without exposing transport details.
(Previously: the real adapter was required to submit through nodemailer and return a messageId.)

#### Scenario: Real adapter receives SMTP acknowledgement
- GIVEN the `RealEmailAdapter` has a valid SMTP transport
- WHEN `send("ops@gorriti.com", "Drift detected", "5 records in CTACTE", { eventId: "..." })` is called
- THEN nodemailer MUST submit the message through the SMTP transport
- AND the call MUST return the transport-acknowledged `messageId`

#### Scenario: Stub adapter records the message
- GIVEN a test retains or injects the active `StubEmailAdapter` instance as `stub`
- WHEN `send("ops@gorriti.com", "Drift detected", "5 records in CTACTE", { eventId: "..." })` is called
- THEN `stub.outbox` MUST contain an entry with `to`, `subject`, `body`, `context`, and `sentAt`
- AND no network call MUST be made

#### Scenario: Synthetic identifier is rejected
- GIVEN a transport implementation returns a locally fabricated pending identifier without SMTP acknowledgement
- WHEN contact delivery is attempted
- THEN the attempt SHALL be treated as failed and the caller SHALL not receive success
