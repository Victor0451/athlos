import type { FastifyPluginCallback, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requireRole } from '@athlos/auth'
import { BusinessError, ErrorCode, throwIfInvalid } from '@athlos/errors'
import { createIdempotencyFingerprint, validateIdempotencyKey } from '../lib/idempotency.ts'
import type { AppContainer } from '../container.ts'
// prettier-ignore
import { CashDeskService, type CloseCashCommand, type ExpenseCommand, type OpenCashCommand, type TenderCommand } from '../modules/dues/cash-desk.ts'
import type { AuditContext } from '../modules/dues/service.ts'

const FINANCE_GATE = { preHandler: requireRole('ADMIN', 'TESORERO') }
// prettier-ignore
const id=z.object({id:z.string().uuid()}),totals=z.record(z.string().min(1).max(20),z.number().int().nonnegative()),openBody=z.object({desk_id:z.string().trim().min(1).max(80),opening_tenders:totals.default({})}).strict(),tenderBody=z.object({direction:z.enum(['INCOME','EXPENSE']),tender:z.string().trim().min(1).max(20),amount_cents:z.number().int().positive(),source_type:z.enum(['SETTLEMENT','MANUAL']),source_id:z.string().uuid().optional(),reason:z.string().trim().min(1).max(500).optional()}).strict().superRefine((value,ctx)=>{if(value.source_type==='SETTLEMENT'&&!value.source_id)ctx.addIssue({code:z.ZodIssueCode.custom,path:['source_id'],message:'Settlement source is required'});if(value.source_type==='MANUAL'&&value.source_id)ctx.addIssue({code:z.ZodIssueCode.custom,path:['source_id'],message:'Manual tenders cannot have a source'});}),expenseBody=z.object({gasto_id:z.string().uuid(),tender:z.string().trim().min(1).max(20)}).strict(),closeBody=z.object({counted_tenders:totals,reason:z.string().trim().min(1).max(500).optional(),force_close:z.boolean().default(false)}).strict()
// prettier-ignore
export interface TreasuryRouteOptions { service?: Partial<Pick<CashDeskService, 'open'|'list'|'recordTender'|'includeExpense'|'close'>> }
// prettier-ignore
const gate=(container:AppContainer)=>{if(!container.env.DUES_CASH_ENABLED)throw BusinessError(ErrorCode.NOT_FOUND,'Resource not found')}
// prettier-ignore
function key(request:FastifyRequest,required=true){const value=request.headers['idempotency-key'];if(typeof value!=='string'){if(required)throw BusinessError(ErrorCode.VALIDATION_ERROR,'Idempotency-Key header is required');return ''}if(required&&!validateIdempotencyKey(value))throw BusinessError(ErrorCode.VALIDATION_ERROR,'Idempotency-Key header is required');return value}
// prettier-ignore
function context(request:FastifyRequest,callerKey:string,payload:unknown):AuditContext{const operator=request.operator;if(!operator)throw BusinessError(ErrorCode.TOKEN_INVALID,'Authentication required');const permissions=Object.entries(operator.permissions).filter(([,granted])=>granted).map(([name])=>name);return {actorId:operator.sub,role:operator.role,permissions,sourceIp:request.ip??null,callerKey,requestFingerprint:createIdempotencyFingerprint('dues-cash',request.url,payload),authorizationEvidence:{role:operator.role,permissions}}}
// prettier-ignore
// prettier-ignore
const dto=(row:any)=>({id:row.id,desk_id:row.deskId,status:row.status,...(row.assignedOperatorId?{assigned_operator_id:row.assignedOperatorId}:{}),...(row.businessDate?{business_date:row.businessDate}:{}),...(row.openedAt?{opened_at:row.openedAt}:{}),...(row.closedAt!==undefined?{closed_at:row.closedAt}: {})}) // eslint-disable-line @typescript-eslint/no-explicit-any

// prettier-ignore
export const treasuryRoutes:FastifyPluginCallback<TreasuryRouteOptions>=(fastify,options,done)=>{const container:AppContainer=fastify.container,service=options.service??new CashDeskService(container.db)
  // prettier-ignore
  fastify.get('/api/v1/treasury/shifts',FINANCE_GATE,async(request,reply)=>{gate(container);return reply.send({items:(await service.list!(context(request,key(request,false),{}))).map(dto)})})
  // prettier-ignore
  fastify.post('/api/v1/treasury/shifts',FINANCE_GATE,async(request,reply)=>{gate(container);const body=throwIfInvalid(openBody,request.body??{},'body'),callerKey=key(request),input={...context(request,callerKey,body),deskId:body.desk_id,openingTenders:body.opening_tenders} as OpenCashCommand;return reply.code(201).send(dto(await service.open!(input)))})
  // prettier-ignore
  fastify.post<{Params:{id:string}}>('/api/v1/treasury/shifts/:id/tenders',FINANCE_GATE,async(request,reply)=>{gate(container);const params=throwIfInvalid(id,request.params,'params'),body=throwIfInvalid(tenderBody,request.body??{},'body'),callerKey=key(request),input={...context(request,callerKey,body),shiftId:params.id,direction:body.direction,tender:body.tender,amountCents:body.amount_cents,sourceType:body.source_type,...(body.source_id?{sourceId:body.source_id}:{}),...(body.reason?{reason:body.reason}:{})} as TenderCommand;return reply.code(201).send(await service.recordTender!(input))})
  // prettier-ignore
  fastify.post<{Params:{id:string}}>('/api/v1/treasury/shifts/:id/expenses',FINANCE_GATE,async(request,reply)=>{gate(container);const params=throwIfInvalid(id,request.params,'params'),body=throwIfInvalid(expenseBody,request.body??{},'body'),callerKey=key(request),input={...context(request,callerKey,body),shiftId:params.id,gastoId:body.gasto_id,tender:body.tender} as ExpenseCommand;return reply.code(201).send(await service.includeExpense!(input))})
  // prettier-ignore
  fastify.post<{Params:{id:string}}>('/api/v1/treasury/shifts/:id/close',FINANCE_GATE,async(request,reply)=>{gate(container);const params=throwIfInvalid(id,request.params,'params'),body=throwIfInvalid(closeBody,request.body??{},'body'),callerKey=key(request),input={...context(request,callerKey,body),shiftId:params.id,countedTenders:body.counted_tenders,forceClose:body.force_close,...(body.reason?{reason:body.reason}:{})} as CloseCashCommand,result=await service.close!(input);return reply.code(200).send({id:result.id,shift_id:result.shiftId,expected_tenders:result.expectedTenders,counted_tenders:result.countedTenders,discrepancy:result.discrepancy,reason:result.reason,closed_at:result.closedAt,...(result.forceClose?{force_close:true}:{})})})
  done()
}
// prettier-ignore
declare module 'fastify'{interface FastifyInstance{container:AppContainer}}
