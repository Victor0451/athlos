# Delta for `api-design`

This delta extends the API Design Specification with the new PDF endpoint contract for `athlos-socio-form-emit`. The endpoint returns binary PDF content rather than JSON, and the `Content-Type` + `Content-Disposition` headers carry the file identity. No new status code is added — the route reuses the existing `200`, `401`, `404` codes — but a new exception to the JSON-only content-type rule is documented for the PDF response shape.

## ADDED Requirements

### Requirement: PDF Endpoint Contract — `GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf`

The API SHALL expose `GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf` with the following contract:

| Aspect | Value |
|---|---|
| Method | `GET` |
| Path | `/api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf` |
| Auth | JWT (any authenticated operator, no role gate) |
| Success status | `200 OK` |
| Success `Content-Type` | `application/pdf` |
| Success `Content-Disposition` | `inline; filename="<sanitized>"` |
| Not-found status | `404 NOT_FOUND` (envelope: `error: "SOCIO_NOT_FOUND"`) |
| Unauthorized | `401 UNAUTHORIZED` |

The `filename` portion of `Content-Disposition` SHALL follow the pattern `solicitud-inscripcion-socio-{N}-{Apellido}.pdf` where `{N}` is the socio's `numero_socio` and `{Apellido}` is the socio's `apellido` passed through a sanitization function that strips diacritics (NFD normalize + remove combining marks) and replaces any non-alphanumeric character with `_` (collapsing runs). The header value SHALL be ASCII-only and SHALL be double-quoted.

The response body SHALL be the PDF bytes (not JSON-wrapped). The route SHALL be classified as a "PDF download endpoint" for the purposes of the existing content-type rule — the JSON-only contract does not apply to responses where the body is the PDF itself.

#### Scenario: Happy path returns 200 with PDF headers and a valid PDF body

- **WHEN** an authenticated operator calls `GET /api/v1/socios/<socioId>/forms/solicitud-inscripcion.pdf` for a socio that exists
- **THEN** the response status SHALL be `200 OK`
- **AND** the `Content-Type` header SHALL equal `application/pdf`
- **AND** the `Content-Disposition` header SHALL start with `inline; filename="`
- **AND** the filename SHALL match the pattern `solicitud-inscripcion-socio-<N>-<Apellido>.pdf`
- **AND** the response body SHALL begin with the bytes `%PDF-`

#### Scenario: Missing JWT returns 401

- **WHEN** the endpoint is called without an `Authorization` header
- **THEN** the response status SHALL be `401 UNAUTHORIZED`
- **AND** the `Content-Type` SHALL be `application/json` (the `ApiError` envelope is JSON)

#### Scenario: Unknown socioId returns 404 with the standard envelope

- **WHEN** the endpoint is called with a `:socioId` that does not exist
- **THEN** the response status SHALL be `404 NOT_FOUND`
- **AND** the body SHALL conform to the `ApiError` envelope with `error: "SOCIO_NOT_FOUND"`
- **AND** the `Content-Type` SHALL be `application/json`

#### Scenario: Filename is sanitized for diacritics and punctuation

- **WHEN** the endpoint is called for a socio with `apellido = "Pérez"`
- **THEN** the `Content-Disposition` filename SHALL contain `Perez` (no diacritic)
- **AND** the header value SHALL be valid ASCII

#### Scenario: Content-Disposition uses `inline`, not `attachment`

- **WHEN** the response is sent
- **THEN** the `Content-Disposition` disposition type SHALL be `inline` (NOT `attachment`)
- **AND** the PDF SHALL render in the browser tab when opened via `window.open(url)`
