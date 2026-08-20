import { afterEach, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { signAccessToken, authPlugin } from '@athlos/auth'
import { BusinessError, ErrorCode } from '@athlos/errors'
import { mockEnv } from '../test-helpers/mock-env.ts'
import type { AppContainer } from '../container.ts'
import { errorHandler } from '../plugins/error-handler.ts'
import { duesRoutes, type DuesRouteOptions } from './dues.ts'

// prettier-ignore
const actorId='00000000-0000-4000-8000-000000000001',sourceId='00000000-0000-4000-8000-000000000010',apps:FastifyInstance[]=[]
// prettier-ignore
const auth=(role:'ADMIN'|'TESORERO'|'OPERADOR',key='projection-route-1')=>({authorization:`Bearer ${signAccessToken({sub:actorId,role,permissions:{can_reprint:false,can_anulate:false}},mockEnv() as never)}`,'idempotency-key':key})
// prettier-ignore
async function app(enabled:boolean,service:NonNullable<DuesRouteOptions['ctacteProjectionService']>){const env={...mockEnv(),DUES_CTACTE_PROJECTION_ENABLED:enabled},fastify=Fastify({logger:false});fastify.decorate('container',{db:{},env} as unknown as AppContainer);await fastify.register(errorHandler);await fastify.register(authPlugin(()=>env as never));await fastify.register(duesRoutes,{ctacteProjectionService:service});apps.push(fastify);return fastify}
afterEach(async () => Promise.all(apps.splice(0).map((item) => item.close())))

// prettier-ignore
it('has no projection route or service side effect while compatibility is disabled',async()=>{const service={project:vi.fn()},fastify=await app(false,service),response=await fastify.inject({method:'POST',url:'/api/v1/dues/ctacte/projections',headers:auth('ADMIN'),payload:{source_type:'OBLIGATION',source_id:sourceId}}); expect(response.statusCode).toBe(404); expect(service.project).not.toHaveBeenCalled()})

// prettier-ignore
it('authorizes and maps the minimized reconciled projection result',async()=>{const service={project:vi.fn().mockResolvedValue({sourceType:'OBLIGATION',sourceId,status:'PROJECTED',ctacteId:'00000000-0000-4000-8000-000000000020',missing:false,divergent:false,retryCount:0})},fastify=await app(true,service),response=await fastify.inject({method:'POST',url:'/api/v1/dues/ctacte/projections',headers:auth('TESORERO'),payload:{source_type:'OBLIGATION',source_id:sourceId}}); expect(response.statusCode).toBe(200); expect(response.json()).toEqual({source_type:'OBLIGATION',source_id:sourceId,status:'PROJECTED',ctacte_id:'00000000-0000-4000-8000-000000000020',missing:false,divergent:false,retry_count:0}); expect(response.body).not.toContain('socio'); expect(service.project).toHaveBeenCalledWith(expect.objectContaining({sourceType:'OBLIGATION',sourceId}))})

// prettier-ignore
it('denies non-finance projection commands before invoking the service',async()=>{const service={project:vi.fn()},fastify=await app(true,service),response=await fastify.inject({method:'POST',url:'/api/v1/dues/ctacte/projections',headers:auth('OPERADOR'),payload:{source_type:'OBLIGATION',source_id:sourceId}}); expect(response.statusCode).toBe(403); expect(service.project).not.toHaveBeenCalled()})

// prettier-ignore
it.each([[ErrorCode.CONFLICT,409],[ErrorCode.NOT_FOUND,404]] as const)('exposes projection failure %s without fabricating a success result',(code,status)=>{const service={project:vi.fn().mockRejectedValue(BusinessError(code,'projection failure'))}; return app(true,service).then(async(fastify)=>{const response=await fastify.inject({method:'POST',url:'/api/v1/dues/ctacte/projections',headers:auth('TESORERO','failure-'+code),payload:{source_type:'OBLIGATION',source_id:sourceId}}); expect(response.statusCode).toBe(status); expect(response.json().error).toBe(code)})})
