export type ImplementationInquiry = {
  name: string
  organization: string
  role: string
  email: string
  primaryProblem: string
  phone?: string
  message?: string
  website?: string
}

export async function submitImplementationInquiry(input: ImplementationInquiry) {
  const response = await fetch('/api/v1/implementation-contact', {
    method: 'POST',
    credentials: 'omit',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.status !== 'sent')
    throw Object.assign(new Error('Inquiry unavailable'), {
      status: response.status,
      details: body,
    })
  return body as { status: 'sent' }
}
