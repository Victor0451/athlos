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
// prettier-ignore
describe('treasury routes',()=>{
  // prettier-ignore
  it('opens a shift for finance and returns a privacy-safe close DTO',async()=>{const service={open:vi.fn().mockResolvedValue({id:'shift-1',deskId:'front',status:'OPEN'}),close:vi.fn()},fastify=await app(service),opened=await fastify.inject({method:'POST',url:'/api/v1/treasury/shifts',headers:auth('TESORERO'),payload:{desk_id:'front',opening_tenders:{CASH:100}}});expect(opened.statusCode).toBe(201);expect(opened.json()).toEqual({id:'shift-1',desk_id:'front',status:'OPEN'});expect(service.open).toHaveBeenCalledWith(expect.objectContaining({deskId:'front',openingTenders:{CASH:100}}))})
  // prettier-ignore
   it('rejects operators and remains disabled behind the cash gate',async()=>{const service={open:vi.fn()};expect((await(await app(service)).inject({method:'POST',url:'/api/v1/treasury/shifts',headers:auth('OPERADOR'),payload:{}})).statusCode).toBe(403);expect((await(await app(service,false)).inject({method:'POST',url:'/api/v1/treasury/shifts',headers:auth('TESORERO'),payload:{}})).statusCode).toBe(404)})
   it('requires an explicit idempotency key for every financial command',async()=>{const service={open:vi.fn()};const response=await(await app(service)).inject({method:'POST',url:'/api/v1/treasury/shifts',headers:auth('TESORERO',''),payload:{desk_id:'front',opening_tenders:{}}});expect(response.statusCode).toBe(400);expect(service.open).not.toHaveBeenCalled()})
  // prettier-ignore
   it('maps an authorized discrepancy close and never returns authorization evidence',async()=>{const service={close:vi.fn().mockResolvedValue({id:'close-1',shiftId:'shift-1',expectedTenders:{CASH:100},countedTenders:{CASH:90},discrepancy:{CASH:-10},reason:'Counted short',closedAt:'2026-08-19T10:00:00.000Z'})},fastify=await app(service),response=await fastify.inject({method:'POST',url:'/api/v1/treasury/shifts/00000000-0000-4000-8000-000000000002/close',headers:auth('TESORERO','close-1'),payload:{counted_tenders:{CASH:90},reason:'Counted short'}});expect(response.statusCode).toBe(200);expect(response.json()).toEqual({id:'close-1',shift_id:'shift-1',expected_tenders:{CASH:100},counted_tenders:{CASH:90},discrepancy:{CASH:-10},reason:'Counted short',closed_at:'2026-08-19T10:00:00.000Z'});expect(response.body).not.toContain('authorizationEvidence')})
   it('passes force-close intent and reason only to an authorized finance operator',async()=>{const service={close:vi.fn().mockResolvedValue({id:'close-force',shiftId:'shift-1',expectedTenders:{},countedTenders:{},discrepancy:{},reason:'Recovery',closedAt:'2026-08-20T10:00:00.000Z',forceClose:true})},fastify=await app(service),response=await fastify.inject({method:'POST',url:'/api/v1/treasury/shifts/00000000-0000-4000-8000-000000000002/close',headers:auth('TESORERO','force-close-1'),payload:{counted_tenders:{},force_close:true,reason:'Recovery'}});expect(response.statusCode).toBe(200);expect(service.close).toHaveBeenCalledWith(expect.objectContaining({forceClose:true,reason:'Recovery'}));expect(response.json()).toMatchObject({force_close:true,reason:'Recovery'});expect(response.body).not.toContain('authorizationEvidence')})
   it('rejects force-close for an ordinary operator',async()=>{const service={close:vi.fn()};const response=await(await app(service)).inject({method:'POST',url:'/api/v1/treasury/shifts/00000000-0000-4000-8000-000000000002/close',headers:auth('OPERADOR','force-close-operator'),payload:{counted_tenders:{},force_close:true,reason:'Recovery'}});expect(response.statusCode).toBe(403);expect(service.close).not.toHaveBeenCalled()})
 })
