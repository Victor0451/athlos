import { expect, test, type Route } from '@playwright/test'

// Both guards deliberately tolerate an unset variable. Playwright imports every spec under
// e2e/ when it lists or runs the suite, so a module-scope throw breaks the whole run for
// anyone who never asked for this QA harness. Unset means "skip this spec"; an explicit
// wrong value still fails closed. Matches the ATHLOS_CASH_QA_MODE guard in
// collections-cash-workflow.spec.ts.
const mode = process.env.ATHLOS_COMMUNITY_WORK_QA_MODE
if (mode !== undefined && mode !== 'manual' && mode !== 'smoke')
  throw new Error('ATHLOS_COMMUNITY_WORK_QA_MODE must be unset, manual, or smoke')
if (mode === 'manual' && process.env.CI)
  throw new Error('Manual Community Work QA cannot run in CI')
const role = process.env.ATHLOS_COMMUNITY_WORK_QA_ROLE
if (role !== undefined && role !== 'ADMIN' && role !== 'TESORERO')
  throw new Error('ATHLOS_COMMUNITY_WORK_QA_ROLE must be unset, ADMIN, or TESORERO')

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`
const member = { id: id('10'), nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
const obligationId = id('11')
const agreementId = id('12')
const communityWorkId = id('13')
const settlementId = id('14')
const allocationId = id('15')
const baseOutstandingCents = 10_000

// The simulator compares free-text fields case and whitespace insensitively: a human
// acceptance run must not fail because the operator typed a lowercase first letter.
const sameText = (actual: unknown, expected: string) =>
  typeof actual === 'string' && actual.trim().toLowerCase() === expected.trim().toLowerCase()

type Scenario = { amountInput: string; expectedDebt: string }
// Manual mode runs the documented runbook amount once. Smoke mode additionally proves the
// mock recomputes the debt from the submitted amount instead of hardcoding 10000 - 2500.
const scenarios: Scenario[] =
  mode === 'manual'
    ? [{ amountInput: '25', expectedDebt: '$ 75,00' }]
    : [
        { amountInput: '25', expectedDebt: '$ 75,00' },
        { amountInput: '40', expectedDebt: '$ 60,00' },
      ]

const agreement = {
  id: agreementId,
  socio_id: member.id,
  obligation_id: obligationId,
  kind: 'NEGOTIATED',
  status: 'ACTIVE',
  revision_number: 1,
  terms_version: 1,
  terms: { narrative: 'Trabajo acordado' },
  reason: 'Acuerdo vigente',
  revision_reason: null,
  agreement_date: '2026-01-03',
  revision_of_agreement_id: null,
  replayed: false,
}

for (const scenario of scenarios) {
  test(`Community Work ${mode ?? 'unset'} ${scenario.amountInput} ARS: local simulated acceptance, not production evidence`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(mode === 'manual' ? 30 * 60_000 : 90_000)
    test.skip(
      mode === undefined ||
        role === undefined ||
        process.env.NATIVE_COLLECTIONS_WEB_ENABLED !== 'true' ||
        process.env.DUES_AGREEMENTS_ENABLED !== 'true',
      'Requires ATHLOS_COMMUNITY_WORK_QA_MODE, ATHLOS_COMMUNITY_WORK_QA_ROLE and the local Collections and agreements feature flags.',
    )
    if (mode === 'manual' && test.info().project.use.headless !== false)
      throw new Error('Manual Community Work QA requires --headed')
    if (!baseURL) throw new Error('Local baseURL required')
    const origin = new URL(baseURL)
    if (
      origin.protocol !== 'http:' ||
      origin.hostname !== '127.0.0.1' ||
      origin.username ||
      origin.password
    )
      throw new Error('Community Work QA only permits loopback HTTP')

    const page = await browser.newPage({ baseURL: origin.origin })
    const unexpected: string[] = []
    let outstanding = baseOutstandingCents
    let communityWorkAmount = 0
    let agreementCreated = false
    let communityWorkCreated = false
    let agreements = 0
    let communityWorks = 0
    let cashMutations = 0
    let debtReads = 0

    const debt = () => ({
      status: 'ready',
      socio_id: member.id,
      currency: 'ARS',
      total_debt_cents: outstanding,
      obligations: [
        {
          id: obligationId,
          period_start: '2026-01-01',
          period_end: '2026-02-01',
          original_amount_cents: 10_000,
          outstanding_cents: outstanding,
          currency: 'ARS',
          status: outstanding ? 'OPEN' : 'PAID',
          components: [],
          benefits: [],
          allocations: communityWorkCreated
            ? [
                {
                  id: allocationId,
                  settlement_id: settlementId,
                  settlement_kind: 'NON_CASH',
                  settlement_amount_cents: communityWorkAmount,
                  currency: 'ARS',
                  amount_cents: communityWorkAmount,
                  kind: 'ALLOCATION',
                  compensates_allocation_id: null,
                  reversal_eligible: false,
                },
              ]
            : [],
        },
      ],
    })
    const send = (route: Route, status: number, body: unknown) =>
      route.fulfill({ status, json: body })
    const reject = (route: Route, message: string) =>
      send(route, 400, {
        error: 'VALIDATION_ERROR',
        message: `Community Work simulator: ${message}`,
        request_id: 'community-work-qa',
      })

    await page.context().route('**/*', (route) => {
      const url = new URL(route.request().url())
      return url.origin === origin.origin && !url.pathname.startsWith('/api/')
        ? route.continue()
        : route.abort('blockedbyclient')
    })
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.origin !== origin.origin) return route.abort('blockedbyclient')
      const path = url.pathname
      const method = request.method()
      if (method === 'GET') {
        if (path === '/api/v1/club-status')
          return send(route, 200, {
            period: 'current-month',
            generatedAt: new Date().toISOString(),
            membership: { active: 1 },
            freshness: [],
            unavailable: [],
            finance: { debits: '0', credits: '0', net: '0' },
          })
        if (path === '/api/v1/notifications/unread-count') return send(route, 200, { count: 0 })
        if (
          [
            '/api/v1/notifications',
            '/api/v1/dues/prices',
            '/api/v1/padrones/disciplinas',
            '/api/v1/treasury/shifts',
          ].includes(path)
        )
          return send(route, 200, { items: [] })
        if (path === '/api/v1/admin/operations/snapshot')
          return send(route, 200, {
            readiness: { overall: 'ready', db: 'ready', schema: 'ready' },
            freshness: { available: true, items: [] },
            jobs: { available: true, items: [] },
            attention: { available: true, items: [] },
          })
        if (path === '/api/v1/socios')
          return send(route, 200, {
            items: [member],
            page: 1,
            limit: 20,
            total: 1,
            has_more: false,
          })
        if (path === `/api/v1/socios/${member.id}`) return send(route, 200, member)
        if (path === `/api/v1/dues/debt/${member.id}`) {
          debtReads += 1
          return send(route, 200, debt())
        }
        if (path === `/api/v1/dues/obligations/${obligationId}/agreements`)
          return send(route, 200, {
            active: agreementCreated ? agreement : null,
            revisions: agreementCreated ? [agreement] : [],
          })
        if (path === `/api/v1/members/${member.id}/condonation-requests`)
          return send(route, 200, { items: [] })
      }
      if (method === 'POST' && path === '/api/v1/dues/agreements') {
        const input = request.postDataJSON()
        if (agreementCreated)
          return reject(route, 'a negotiated agreement was already created in this session.')
        if (!request.headers()['idempotency-key'])
          return reject(route, 'the idempotency-key header is missing.')
        if (input?.socio_id !== member.id)
          return reject(route, `socio_id must be ${member.id}, got ${String(input?.socio_id)}.`)
        if (input?.obligation_id !== obligationId)
          return reject(
            route,
            `obligation_id must be ${obligationId}, got ${String(input?.obligation_id)}.`,
          )
        if (input?.kind !== 'NEGOTIATED')
          return reject(route, `kind must be NEGOTIATED, got ${String(input?.kind)}.`)
        if (input?.terms_version !== 1)
          return reject(route, `terms_version must be 1, got ${String(input?.terms_version)}.`)
        if (!sameText(input?.terms?.narrative, agreement.terms.narrative))
          return reject(
            route,
            `terms.narrative must read "${agreement.terms.narrative}" (case and surrounding spaces are ignored), got ${JSON.stringify(input?.terms?.narrative)}.`,
          )
        if (!sameText(input?.reason, agreement.reason))
          return reject(
            route,
            `reason must read "${agreement.reason}" (case and surrounding spaces are ignored), got ${JSON.stringify(input?.reason)}.`,
          )
        agreementCreated = true
        agreements += 1
        return send(route, 201, agreement)
      }
      if (method === 'POST' && path === '/api/v1/dues/community-work') {
        const input = request.postDataJSON()
        if (!agreementCreated)
          return reject(route, 'an active negotiated agreement is required first.')
        if (communityWorkCreated)
          return reject(route, 'community work was already registered in this session.')
        if (!request.headers()['idempotency-key'])
          return reject(route, 'the idempotency-key header is missing.')
        if (input?.socio_id !== member.id)
          return reject(route, `socio_id must be ${member.id}, got ${String(input?.socio_id)}.`)
        if (input?.obligation_id !== obligationId)
          return reject(
            route,
            `obligation_id must be ${obligationId}, got ${String(input?.obligation_id)}.`,
          )
        if (input?.agreement_id !== agreementId)
          return reject(
            route,
            `agreement_id must be ${agreementId}, got ${String(input?.agreement_id)}.`,
          )
        const amount = input?.amount_cents
        if (!Number.isInteger(amount) || Number(amount) <= 0)
          return reject(
            route,
            `amount_cents must be a positive integer, got ${JSON.stringify(amount)}.`,
          )
        if (Number(amount) > outstanding)
          return reject(
            route,
            `amount_cents ${String(amount)} exceeds the outstanding balance ${outstanding}.`,
          )
        if (!sameText(input?.evidence?.description, 'Acta 12 aprobada'))
          return reject(
            route,
            `evidence.description must read "Acta 12 aprobada" (case and surrounding spaces are ignored), got ${JSON.stringify(input?.evidence?.description)}.`,
          )
        if (!sameText(input?.reason, 'Trabajo aceptado'))
          return reject(
            route,
            `reason must read "Trabajo aceptado" (case and surrounding spaces are ignored), got ${JSON.stringify(input?.reason)}.`,
          )
        communityWorkCreated = true
        communityWorkAmount = Number(amount)
        communityWorks += 1
        outstanding -= communityWorkAmount
        return send(route, 201, {
          community_work_id: communityWorkId,
          settlement_id: settlementId,
          allocation_id: allocationId,
          obligation_id: obligationId,
          agreement_id: agreementId,
          amount_cents: communityWorkAmount,
          currency: 'ARS',
          replayed: false,
        })
      }
      if (
        method !== 'GET' &&
        (path.includes('/treasury/') || path.includes('/cash') || path.includes('/cta'))
      )
        cashMutations += 1
      unexpected.push(`${method} ${path}`)
      return reject(route, 'This route is not enabled by the local scenario.')
    })

    await page.addInitScript(
      ({ currentUser }) => {
        localStorage.setItem(
          'athlos.auth',
          JSON.stringify({
            accessToken: 'community-work-qa-token',
            refreshToken: 'community-work-qa-refresh',
            currentUser,
          }),
        )
      },
      {
        currentUser: {
          operator_id: id('20'),
          role,
          username: 'qa.community',
          permissions: { can_reprint: false, can_anulate: false, data_steward: false },
        },
      },
    )
    await page.goto('/collections')
    await expect(page.getByRole('heading', { name: 'Cobranza' })).toBeVisible()
    await page.evaluate(() => {
      const badge = document.createElement('p')
      badge.setAttribute('role', 'alert')
      badge.textContent = 'SIMULADOR LOCAL · SIN DATOS REALES · Trabajo comunitario no genera caja.'
      badge.style.cssText =
        'box-sizing:border-box;max-width:100%;margin:0;padding:8px;background:#fff3cd;color:#332701;font:14px/1.4 sans-serif;overflow-wrap:anywhere;'
      document.body.prepend(badge)
    })

    if (mode === 'manual') {
      process.stdout.write(
        'COMMUNITY_WORK_QA_READY role=' + role + ' api=simulated; human acceptance is separate\n',
      )
      await page.pause()
      // The runbook quick path asks the human to create one agreement and one community
      // work, so a completed session must not be reported as a failure. What always holds
      // is that Community Work never produces a cash or Treasury mutation.
      expect(cashMutations).toBe(0)
      expect(agreements).toBeLessThanOrEqual(1)
      expect(communityWorks).toBeLessThanOrEqual(1)
      expect(unexpected).toEqual([])
      test.skip(true, 'Human session ended; not an automated acceptance verdict')
      return
    }

    await page.getByLabel('Buscar socio').fill('Ana')
    await page.getByRole('button', { name: 'Buscar socio' }).click()
    await page.getByRole('button', { name: /Gorriti, Ana/ }).click()
    await expect(page.getByText('Deuda total pendiente: $ 100,00')).toBeVisible()
    await page.getByRole('button', { name: 'Registrar acuerdo' }).click()
    const agreementDialog = page.getByRole('dialog', { name: 'Registrar acuerdo' })
    await agreementDialog.getByLabel('Narrativa del acuerdo').fill(agreement.terms.narrative)
    await agreementDialog.getByLabel('Motivo del acuerdo').fill(agreement.reason)
    await agreementDialog.getByRole('button', { name: 'Guardar acuerdo' }).click()
    await expect(
      page
        .getByRole('region', { name: 'Trabajo comunitario' })
        .getByText('Acuerdo activo · revisión 1'),
    ).toBeVisible()
    await expect(page.getByText('Deuda total pendiente: $ 100,00')).toBeVisible()
    await page.getByRole('button', { name: 'Registrar trabajo comunitario' }).click()
    const workDialog = page.getByRole('dialog', { name: 'Registrar trabajo comunitario' })
    await workDialog.getByLabel('Valor aprobado (ARS)').fill(scenario.amountInput)
    await workDialog.getByLabel('Evidencia del trabajo aceptado').fill('Acta 12 aprobada')
    await workDialog.getByLabel('Motivo de la aceptación').fill('Trabajo aceptado')
    await workDialog.getByRole('button', { name: 'Confirmar trabajo comunitario' }).click()
    await expect(
      page.getByRole('region', { name: 'Resultado del trabajo comunitario' }),
    ).toContainText('Trabajo comunitario registrado')
    await expect(page.getByText(`Deuda total pendiente: ${scenario.expectedDebt}`)).toBeVisible()
    expect({ agreements, communityWorks, cashMutations }).toEqual({
      agreements: 1,
      communityWorks: 1,
      cashMutations: 0,
    })
    expect(debtReads).toBeGreaterThanOrEqual(2)
    expect(unexpected).toEqual([])
  })
}

// Approvals-queue extension of the same local simulator: the decision never moves the
// debt; only the confirmed execution does. Automated in smoke mode (the manual runbook
// session above already pauses for a human).
test('Community Work approvals queue smoke: decision is financially inert, execution is not', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000)
  test.skip(mode !== 'smoke' || role === undefined, 'Automated only in smoke mode with a role')
  if (!baseURL) throw new Error('Local baseURL required')
  const origin = new URL(baseURL)
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1')
    throw new Error('Community Work QA only permits loopback HTTP')

  const approvalId = id('16')
  const executionId = id('17')
  const settlementApprovalId = id('18')
  const requesterId = id('21')
  const deciderId = id('20')
  let outstanding = baseOutstandingCents
  let decided = false
  let executed = false
  let decisions = 0
  let executions = 0
  let cashMutations = 0
  let debtReads = 0

  const approvalDebt = () => ({
    status: 'ready',
    socio_id: member.id,
    currency: 'ARS',
    total_debt_cents: outstanding,
    obligations: [
      {
        id: obligationId,
        period_start: '2026-01-01',
        period_end: '2026-02-01',
        original_amount_cents: 10_000,
        outstanding_cents: outstanding,
        currency: 'ARS',
        status: outstanding ? 'OPEN' : 'PAID',
        components: [],
        benefits: [],
        allocations: [],
      },
    ],
  })
  const lifecycleItem = () => ({
    id: approvalId,
    state: executed ? 'executed' : decided ? 'approved_awaiting_execution' : 'pending',
    expires_at: '2030-01-01T12:00:00.000Z',
    decided_at: decided ? '2026-09-02T13:00:00.000Z' : null,
    execution_id: decided ? executionId : null,
    execution_status: executed ? 'executed' : decided ? 'recoverable' : 'unavailable',
    snapshot: {
      member_id: member.id,
      obligations: [
        {
          obligation_id: obligationId,
          currency: 'ARS',
          outstanding_amount_cents: baseOutstandingCents,
        },
      ],
    },
  })
  const send = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, json: body })

  const page = await browser.newPage({ baseURL: origin.origin })
  await page.context().route('**/*', (route) => {
    const url = new URL(route.request().url())
    return url.origin === origin.origin && !url.pathname.startsWith('/api/')
      ? route.continue()
      : route.abort('blockedbyclient')
  })
  await page.addInitScript(
    ({ currentUser }) => {
      localStorage.setItem(
        'athlos.auth',
        JSON.stringify({
          accessToken: 'community-work-qa-token',
          refreshToken: 'community-work-qa-refresh',
          currentUser,
        }),
      )
    },
    {
      currentUser: {
        operator_id: deciderId,
        role,
        username: 'qa.community',
        permissions: { can_reprint: false, can_anulate: false, data_steward: false },
      },
    },
  )
  {
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.origin !== origin.origin) return route.abort('blockedbyclient')
      const path = url.pathname
      const method = request.method()
      if (method === 'GET') {
        if (path === '/api/v1/club-status')
          return send(route, 200, {
            period: 'current-month',
            generatedAt: new Date().toISOString(),
            membership: { active: 1 },
            freshness: [],
            unavailable: [],
            finance: { debits: '0', credits: '0', net: '0' },
          })
        if (path === '/api/v1/notifications/unread-count') return send(route, 200, { count: 0 })
        if (
          ['/api/v1/notifications', '/api/v1/dues/prices', '/api/v1/treasury/shifts'].includes(path)
        )
          return send(route, 200, { items: [] })
        if (path === '/api/v1/condonation-requests')
          return send(route, 200, { items: [], next_cursor: null })
        if (path === '/api/v1/community-work-requests')
          return send(route, 200, {
            items: [
              {
                ...lifecycleItem(),
                created_at: '2026-09-01T12:00:00.000Z',
                current_member: {
                  id: member.id,
                  numero_socio: member.numero_socio,
                  nombre: member.nombre,
                  apellido: member.apellido,
                },
                requester: { id: requesterId, username: 'qa.solicitante' },
                context: 'Trabajo comunitario con aprobación',
                reason: 'Plan comunitario QA',
                evidence: 'Acta QA 1',
              },
            ],
            next_cursor: null,
          })
        if (path === `/api/v1/members/${member.id}/community-work-requests`)
          return send(route, 200, { items: [lifecycleItem()] })
        if (path === `/api/v1/members/${member.id}/condonation-requests`)
          return send(route, 200, { items: [] })
        if (path === `/api/v1/dues/debt/${member.id}`) {
          debtReads += 1
          return send(route, 200, approvalDebt())
        }
      }
      if (method === 'POST' && path === `/api/v1/community-work-requests/${approvalId}/decision`) {
        const input = request.postDataJSON()
        if (decided)
          return send(route, 409, {
            error: 'CONFLICT',
            message: 'Community Work simulator: already decided.',
            request_id: 'community-work-qa',
          })
        if (!sameText(input?.reason, 'Aprobado en mesa QA'))
          return send(route, 400, {
            error: 'VALIDATION_ERROR',
            message: 'Community Work simulator: reason must read "Aprobado en mesa QA".',
            request_id: 'community-work-qa',
          })
        if (!input?.evidence)
          return send(route, 400, {
            error: 'VALIDATION_ERROR',
            message: 'Community Work simulator: evidence required.',
            request_id: 'community-work-qa',
          })
        decided = true
        decisions += 1
        return send(route, 200, {
          id: approvalId,
          status: 'approved',
          expires_at: '2030-01-01T12:00:00.000Z',
          decided_at: '2026-09-02T13:00:00.000Z',
        })
      }
      if (method === 'POST' && path === `/api/v1/community-work-requests/${approvalId}/execution`) {
        const input = request.postDataJSON()
        if (!decided || executed)
          return send(route, 409, {
            error: 'CONFLICT',
            message: 'Community Work simulator: execution requires a fresh approval.',
            request_id: 'community-work-qa',
          })
        if (input?.execution_id !== executionId)
          return send(route, 400, {
            error: 'VALIDATION_ERROR',
            message: 'Community Work simulator: execution_id must match the decision identity.',
            request_id: 'community-work-qa',
          })
        executed = true
        executions += 1
        outstanding = baseOutstandingCents - 2500
        return send(route, 200, {
          execution_id: executionId,
          approval_id: settlementApprovalId,
          request_id: approvalId,
          work_id: id('19'),
          settlement_id: settlementApprovalId,
          allocation_id: allocationId,
          socio_id: member.id,
          obligation_id: obligationId,
          amount_cents: 2500,
          currency: 'ARS',
          status: 'executed',
        })
      }
      if (
        method !== 'GET' &&
        (path.includes('/treasury/') || path.includes('/cash') || path.includes('/cta'))
      )
        cashMutations += 1
      return send(route, 400, {
        error: 'VALIDATION_ERROR',
        message: `Community Work approvals simulator: ${method} ${path} is not enabled.`,
        request_id: 'community-work-qa',
      })
    })

    await page.goto('/admin/approvals')
    const community = page.getByRole('region', { name: 'Bandeja de trabajo comunitario' })
    await expect(community.getByRole('heading', { name: /Gorriti, Ana/ })).toBeVisible()
    await expect(community.getByText('Pendiente')).toBeVisible()

    // The decision never moves the debt.
    await community.getByRole('button', { name: 'Revisar solicitud' }).click()
    const dialog = page.getByRole('dialog', { name: 'Decidir trabajo comunitario' })
    await dialog.getByLabel('Motivo de la decisión').fill('Aprobado en mesa QA')
    await dialog.getByLabel('Evidencia de la decisión').fill('Acta QA 2')
    await dialog.getByRole('button', { name: 'Aprobar y ejecutar trabajo comunitario' }).click()
    await expect(dialog.getByText('Ejecución confirmada.')).toBeVisible()

    await expect(community.getByText('Ejecutada')).toBeVisible()
    await expect(page.getByText('Deuda total pendiente: $ 75,00')).toBeVisible()
    expect({ decisions, executions, cashMutations }).toEqual({
      decisions: 1,
      executions: 1,
      cashMutations: 0,
    })
    expect(debtReads).toBeGreaterThanOrEqual(1)
  }
})
