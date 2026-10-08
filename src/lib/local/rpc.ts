/**
 * مُوزّع RPC المحلي — يستبدل استدعاءات دوال Postgres بتنفيذ محلي على IndexedDB.
 * نفس أسماء الدوال في SQL: create_sale، void_sale، get_sales_report... إلخ.
 */
import { opsCore } from './opsCore'
import { opsExtra } from './opsExtra'
import { LocalDbError } from './context'

export type RpcHandler = (params: Record<string, unknown>) => Promise<unknown>

const handlers: Record<string, RpcHandler> = { ...opsCore, ...opsExtra }

export async function callRpc(fnName: string, params: Record<string, unknown>): Promise<unknown> {
  const fn = handlers[fnName]
  if (!fn) {
    throw new LocalDbError(`الدالة غير مدعومة في الوضع المحلي: ${fnName}`)
  }
  return fn(params)
}

/** للاختبار والتسجيل — قائمة الدوال المدعومة */
export function supportedRpcs(): string[] {
  return Object.keys(handlers)
}
