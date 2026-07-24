# Delta for Error Handling

## ADDED Requirements

### Requirement: Proxy Failure Boundary

The proxy SHALL fail closed with redacted upstream diagnostics. It MUST preserve upstream invalid-login `401`, not translate it to proxy failure.

#### Scenario: Upstream rejects invalid credentials
- GIVEN `API_INTERNAL_URL` reaches API
- WHEN the API returns `401` for invalid login
- THEN the web proxy MUST return `401`

#### Scenario: Upstream is unavailable
- GIVEN the configured upstream cannot be reached
- WHEN the web proxy receives a request
- THEN it MUST return a bounded technical failure without credentials or inferred fallback
