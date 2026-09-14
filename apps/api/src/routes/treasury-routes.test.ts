import { BusinessError, ErrorCode } from '@athlos/errors'
// prettier-ignore
import Fastify,{type FastifyInstance} from 'fastify'
// prettier-ignore
import {signAccessToken,authPlugin} from '@athlos/auth'
// prettier-ignore
import {afterEach,describe,expect,it,vi} from 'vitest'
// prettier-ignore
import {mockEnv} from '../test-helpers/mock-env.ts'
// prettier-ignore
import type {AppContainer} from '../container.ts'
// prettier-ignore
import {errorHandler} from '../plugins/error-handler.ts'
// prettier-ignore
import {treasuryRoutes} from './treasury.ts'
// prettier-ignore
const actorId='00000000-0000-4000-8000-000000000001',apps:FastifyInstance[]=[]
// prettier-ignore
const auth=(role:'ADMIN'|'TESORERO'|'OPERADOR',key='cash-1')=>({authorization:`Bearer ${signAccessToken({sub:actorId,role,permissions:{can_reprint:false,can_anulate:false}},mockEnv() as never)}`,'idempotency-key':key})
// prettier-ignore
const app=async(service:Record<string,ReturnType<typeof vi.fn>>,enabled=true)=>{const env={...mockEnv(),DUES_CASH_ENABLED:enabled},fastify=Fastify({logger:false});fastify.decorate('container',{db:{},env} as unknown as AppContainer);await fastify.register(errorHandler);await fastify.register(authPlugin(()=>env as never));await fastify.register(treasuryRoutes,{service});apps.push(fastify);return fastify}
// prettier-ignore
afterEach(async()=>Promise.all(apps.splice(0).map(fastify=>fastify.close())))
describe('cash shift detail reads', () => {
  const shiftId = '00000000-0000-4000-8000-000000000002'
  const shift = {
    id: shiftId,
    deskId: 'front',
    status: 'CLOSED',
    assignedOperatorId: 'another-operator',
    businessDate: '2026-08-19',
    openedAt: '2026-08-19T10:00:00.000Z',
    closedAt: '2026-08-20T12:00:00.000Z',
    operatorId: 'private',
    authorizationEvidence: { secret: true },
  }

  it.each([
    ['TESORERO', false],
    ['ADMIN', true],
  ] as const)('returns saved snapshots for %s, forced=%s', async (role, forced) => {
    const detail = vi.fn().mockResolvedValue({
      shift,
      close: {
        id: 'close-1',
        shiftId,
        expectedTenders: { CASH: 1000 },
        countedTenders: { CASH: 990 },
        discrepancy: { CASH: -10 },
        reason: 'Counted short',
        closedAt: shift.closedAt,
        forceClose: forced,
        authorizationEvidence: { secret: true },
        operatorId: 'private',
        callerKey: 'private',
        requestFingerprint: 'private',
      },
    })
    const response = await (
      await app({ detail })
    ).inject({
      method: 'GET',
      url: `/api/v1/treasury/shifts/${shiftId}`,
      headers: { authorization: auth(role).authorization },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      shift: {
        id: shiftId,
        desk_id: 'front',
        status: 'CLOSED',
        assigned_operator_id: 'another-operator',
        business_date: shift.businessDate,
        opened_at: shift.openedAt,
        closed_at: shift.closedAt,
      },
      close: {
        id: 'close-1',
        shift_id: shiftId,
        expected_tenders: { CASH: 1000 },
        counted_tenders: { CASH: 990 },
        discrepancy: { CASH: -10 },
        reason: 'Counted short',
        closed_at: shift.closedAt,
        ...(forced ? { force_close: true } : {}),
      },
    })
    expect(detail).toHaveBeenCalledWith(expect.objectContaining({ actorId, role, shiftId }))
  })

  it.each(['OPEN', 'CLOSED'])(
    'does not invent reconciliation for a %s shift without a close',
    async (status) => {
      const detail = vi.fn().mockResolvedValue({ shift: { ...shift, status }, close: null })
      const response = await (
        await app({ detail })
      ).inject({
        method: 'GET',
        url: `/api/v1/treasury/shifts/${shiftId}`,
        headers: auth('TESORERO'),
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ shift: { id: shiftId, status }, close: null })
    },
  )

  it.each([
    ['OPERADOR', true, shiftId, 404, true],
    ['TESORERO', false, shiftId, 404, false],
    ['ADMIN', true, 'not-a-uuid', 400, false],
    ['ADMIN', true, shiftId, 404, true],
  ] as const)('enforces role=%s enabled=%s id=%s', async (role, enabled, id, status, called) => {
    const detail = vi
      .fn()
      .mockRejectedValue(BusinessError(ErrorCode.NOT_FOUND, 'Cash shift not found'))
    const response = await (
      await app({ detail }, enabled)
    ).inject({
      method: 'GET',
      url: `/api/v1/treasury/shifts/${id}`,
      headers: auth(role),
    })
    expect(response.statusCode).toBe(status)
    expect(detail).toHaveBeenCalledTimes(called ? 1 : 0)
  })

  it('requires authentication before reading a snapshot', async () => {
    const detail = vi.fn()
    const response = await (
      await app({ detail })
    ).inject({ method: 'GET', url: `/api/v1/treasury/shifts/${shiftId}` })
    expect(response.statusCode).toBe(401)
    expect(detail).not.toHaveBeenCalled()
  })
})

// prettier-ignore
describe('treasury routes',()=>{
  // prettier-ignore
  it('opens a shift for finance and returns a privacy-safe close DTO',async()=>{const service={open:vi.fn().mockResolvedValue({id:'shift-1',deskId:'front',status:'OPEN'}),close:vi.fn()},fastify=await app(service),opened=await fastify.inject({method:'POST',url:'/api/v1/treasury/shifts',headers:auth('TESORERO'),payload:{desk_id:'front',opening_tenders:{CASH:100}}});expect(opened.statusCode).toBe(201);expect(opened.json()).toEqual({id:'shift-1',desk_id:'front',status:'OPEN'});expect(service.open).toHaveBeenCalledWith(expect.objectContaining({deskId:'front',openingTenders:{CASH:100}}))})
  // prettier-ignore
   it('remains disabled behind the cash gate',async()=>{const service={open:vi.fn()};expect((await(await app(service,false)).inject({method:'POST',url:'/api/v1/treasury/shifts',headers:auth('TESORERO'),payload:{}})).statusCode).toBe(404);expect(service.open).not.toHaveBeenCalled()})
   it('requires an explicit idempotency key for every financial command',async()=>{const service={open:vi.fn()};const response=await(await app(service)).inject({method:'POST',url:'/api/v1/treasury/shifts',headers:auth('TESORERO',''),payload:{desk_id:'front',opening_tenders:{}}});expect(response.statusCode).toBe(400);expect(service.open).not.toHaveBeenCalled()})
  // prettier-ignore
   it('maps an authorized discrepancy close and never returns authorization evidence',async()=>{const service={close:vi.fn().mockResolvedValue({id:'close-1',shiftId:'shift-1',expectedTenders:{CASH:100},countedTenders:{CASH:90},discrepancy:{CASH:-10},reason:'Counted short',closedAt:'2026-08-19T10:00:00.000Z'})},fastify=await app(service),response=await fastify.inject({method:'POST',url:'/api/v1/treasury/shifts/00000000-0000-4000-8000-000000000002/close',headers:auth('TESORERO','close-1'),payload:{counted_tenders:{CASH:90},reason:'Counted short'}});expect(response.statusCode).toBe(200);expect(response.json()).toEqual({id:'close-1',shift_id:'shift-1',expected_tenders:{CASH:100},counted_tenders:{CASH:90},discrepancy:{CASH:-10},reason:'Counted short',closed_at:'2026-08-19T10:00:00.000Z'});expect(response.body).not.toContain('authorizationEvidence')})
   it('passes force-close intent and reason only to an authorized finance operator',async()=>{const service={close:vi.fn().mockResolvedValue({id:'close-force',shiftId:'shift-1',expectedTenders:{},countedTenders:{},discrepancy:{},reason:'Recovery',closedAt:'2026-08-20T10:00:00.000Z',forceClose:true})},fastify=await app(service),response=await fastify.inject({method:'POST',url:'/api/v1/treasury/shifts/00000000-0000-4000-8000-000000000002/close',headers:auth('TESORERO','force-close-1'),payload:{counted_tenders:{},force_close:true,reason:'Recovery'}});expect(response.statusCode).toBe(200);expect(service.close).toHaveBeenCalledWith(expect.objectContaining({forceClose:true,reason:'Recovery'}));expect(response.json()).toMatchObject({force_close:true,reason:'Recovery'});expect(response.body).not.toContain('authorizationEvidence')})
   it('rejects force-close for an ordinary operator',async()=>{const service={close:vi.fn()};const response=await(await app(service)).inject({method:'POST',url:'/api/v1/treasury/shifts/00000000-0000-4000-8000-000000000002/close',headers:auth('OPERADOR','force-close-operator'),payload:{counted_tenders:{},force_close:true,reason:'Recovery'}});expect(response.statusCode).toBe(403);expect(service.close).not.toHaveBeenCalled()})

  it('permits an operator through only the Caja open and read routes', async () => {
    const shiftId = '00000000-0000-4000-8000-000000000002'
    const ownShift = {
      id: shiftId,
      deskId: 'front',
      status: 'OPEN',
      assignedOperatorId: actorId,
      businessDate: '2026-08-19',
      openedAt: '2026-08-19T10:00:00.000Z',
      closedAt: null,
    }
    const service = {
      open: vi.fn().mockResolvedValue(ownShift),
      list: vi.fn().mockResolvedValue([ownShift]),
      detail: vi.fn().mockResolvedValue({ shift: ownShift, close: null }),
    }
    const fastify = await app(service)

    const opened = await fastify.inject({
      method: 'POST',
      url: '/api/v1/treasury/shifts',
      headers: auth('OPERADOR', 'operator-open'),
      payload: { desk_id: 'front', opening_tenders: {} },
    })
    const listed = await fastify.inject({
      method: 'GET',
      url: '/api/v1/treasury/shifts',
      headers: { authorization: auth('OPERADOR').authorization },
    })
    const detail = await fastify.inject({
      method: 'GET',
      url: `/api/v1/treasury/shifts/${shiftId}`,
      headers: { authorization: auth('OPERADOR').authorization },
    })

    expect(opened.statusCode).toBe(201)
    expect(listed.json()).toEqual({ items: [expect.objectContaining({ id: shiftId })] })
    expect(detail.json()).toMatchObject({ shift: { id: shiftId, assigned_operator_id: actorId } })
    expect(service.open).toHaveBeenCalledWith(expect.objectContaining({ actorId }))
    expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ actorId, role: 'OPERADOR' }))
    expect(service.detail).toHaveBeenCalledWith(
      expect.objectContaining({ actorId, role: 'OPERADOR', shiftId }),
    )
  })

  it('rejects an owner-spoofing opening payload before calling the service', async () => {
    const service = { open: vi.fn() }
    const response = await (
      await app(service)
    ).inject({
      method: 'POST',
      url: '/api/v1/treasury/shifts',
      headers: auth('OPERADOR', 'operator-spoof'),
      payload: {
        desk_id: 'front',
        opening_tenders: {},
        assigned_operator_id: '00000000-0000-4000-8000-000000000099',
      },
    })

    expect(response.statusCode).toBe(400)
    expect(service.open).not.toHaveBeenCalled()
  })
 })
