/**
 * Email integration contract. Used by the notifications dispatcher
 * (PR 6b) for drift alerts, approval-needed pings, and password resets.
 *
 * `to` is a string for v1; if a test needs multiple recipients,
 * the caller composes them. `subject` is plain ASCII; `html` and
 * `text` are the two body variants — senders send BOTH; clients
 * pick based on `text/html` capability.
 */
export interface Email {
  send(input: {
    to: string
    subject: string
    html: string
    text: string
    context?: Record<string, string>
  }): Promise<{ messageId: string }>
}
