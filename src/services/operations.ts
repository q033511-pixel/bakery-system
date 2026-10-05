/**
 * Operations Registry — كل العمليات التشغيلية بنظام offline-first موحد.
 * كل عملية: operation_id ثابت + executeOperation (شبكة أو طابور) — بند 39/40/108.
 */
import { newOperationId } from '@/lib/operation'
import { executeOperation, registerOpType } from '@/services/sync/syncEngine'
import { rpc } from '@/services/rpc'
import type {
  CreateExpenseInput, CreateLoadInput, CreatePaymentInput, CreateProductionInput,
  CreatePurchaseInput, CreateSaleInput, CreateTransferInput,
} from '@/types'

function withOp<T extends object>(input: T): T & { operation_id: string } {
  return { ...input, operation_id: newOperationId() }
}

// ---------- تسجيل أنواع العمليات لإعادة المزامنة ----------
export function registerAllOps(): void {
  registerOpType('SALE', (p) => rpc<{ id: string; doc_number: string; duplicate: boolean }>('create_sale', { p_payload: p }))
  registerOpType('PURCHASE', (p) => rpc<{ id: string; doc_number: string; duplicate: boolean }>('create_purchase', { p_payload: p }))
  registerOpType('CUSTOMER_PAYMENT', (p) => rpc<{ id: string; doc_number: string; duplicate: boolean }>('create_customer_payment', { p_payload: p }))
  registerOpType('SUPPLIER_PAYMENT', (p) => rpc<{ id: string; doc_number: string; duplicate: boolean }>('create_supplier_payment', { p_payload: p }))
  registerOpType('PRODUCTION', (p) => rpc<{ id: string; doc_number: string; duplicate: boolean }>('create_production_batch', { p_payload: p }))
  registerOpType('EXPENSE', (p) => rpc<{ id: string; doc_number: string; duplicate: boolean }>('create_expense', { p_payload: p }))
  registerOpType('ADJUSTMENT', (p) => rpc<{ id: string; doc_number: string; duplicate: boolean }>('create_inventory_adjustment', { p_payload: p }))
  registerOpType('WASTE', (p) => rpc<{ id: string; doc_number: string; duplicate: boolean }>('create_waste', { p_payload: p }))
  registerOpType('TRANSFER', (p) => rpc<{ id: string; doc_number: string; duplicate: boolean }>('create_transfer', { p_payload: p }))
  registerOpType('DISTRIBUTION_LOAD', (p) => rpc<{ id: string; doc_number: string; duplicate: boolean }>('create_distribution_load', { p_payload: p }))
  registerOpType('DISTRIBUTION_DELIVERY', (p) => rpc<{ sale_id: string; doc_number: string; duplicate: boolean }>('record_distribution_delivery', { p_payload: p }))
  registerOpType('DISTRIBUTION_RETURN', (p) => rpc<{ id: string; duplicate: boolean }>('record_distribution_return', { p_payload: p }))
}

// ---------- واجهات الخدمات ----------

export interface OpResult {
  id: string | null
  doc_number: string | null
  offline: boolean
  duplicate?: boolean
}

async function run(type: string, summary: string, payload: Record<string, unknown>): Promise<OpResult> {
  const res = await executeOperation<{ id: string | null; doc_number: string | null; duplicate?: boolean }>(
    type, summary, payload,
  )
  return {
    id: res.data?.id ?? null,
    doc_number: res.data?.doc_number ?? null,
    offline: res.offline,
    duplicate: res.data?.duplicate,
  }
}

export const salesService = {
  async create(input: Omit<CreateSaleInput, 'operation_id'>): Promise<OpResult> {
    return run('SALE', `بيع — ${input.items.length} صنف`, withOp(input) as unknown as Record<string, unknown>)
  },
  async void(saleId: string, reason: string): Promise<void> {
    await rpc('void_sale', { p_sale_id: saleId, p_reason: reason })
  },
}

export const purchasesService = {
  async create(input: Omit<CreatePurchaseInput, 'operation_id'>): Promise<OpResult> {
    return run('PURCHASE', `شراء — ${input.items.length} صنف`, withOp(input) as unknown as Record<string, unknown>)
  },
  async void(purchaseId: string, reason: string): Promise<void> {
    await rpc('void_purchase', { p_purchase_id: purchaseId, p_reason: reason })
  },
}

export const paymentsService = {
  async customer(input: Omit<CreatePaymentInput, 'operation_id'>): Promise<OpResult> {
    return run('CUSTOMER_PAYMENT', `تحصيل من عميل — ${input.amount}`, withOp(input) as unknown as Record<string, unknown>)
  },
  async supplier(input: Omit<CreatePaymentInput, 'operation_id'>): Promise<OpResult> {
    return run('SUPPLIER_PAYMENT', `دفعة لمورد — ${input.amount}`, withOp(input) as unknown as Record<string, unknown>)
  },
}

export const productionService = {
  async create(input: Omit<CreateProductionInput, 'operation_id'>): Promise<OpResult> {
    return run('PRODUCTION', `إنتاج — ${input.quantity}`, withOp(input) as unknown as Record<string, unknown>)
  },
}

export const expensesService = {
  async create(input: Omit<CreateExpenseInput, 'operation_id'>): Promise<OpResult> {
    return run('EXPENSE', `مصروف — ${input.amount}`, withOp(input) as unknown as Record<string, unknown>)
  },
}

export const inventoryService = {
  async adjust(input: {
    product_id: string; warehouse_id: string; direction: 'IN' | 'OUT'
    quantity: number; unit_id: string; reason: string; adjusted_at?: string; notes?: string | null
  }): Promise<OpResult> {
    return run('ADJUSTMENT', `تسوية مخزون — ${input.quantity}`, withOp(input) as unknown as Record<string, unknown>)
  },
  async waste(input: {
    product_id: string; warehouse_id: string; quantity: number; unit_id: string
    reason: string; wasted_at?: string; notes?: string | null
  }): Promise<OpResult> {
    return run('WASTE', `هالك — ${input.quantity}`, withOp(input) as unknown as Record<string, unknown>)
  },
  async transfer(input: Omit<CreateTransferInput, 'operation_id'>): Promise<OpResult> {
    return run('TRANSFER', `مناقلة — ${input.items.length} صنف`, withOp(input) as unknown as Record<string, unknown>)
  },
}

export const distributionService = {
  async createLoad(input: Omit<CreateLoadInput, 'operation_id'>): Promise<OpResult> {
    return run('DISTRIBUTION_LOAD', `حمولة توزيع — ${input.items.length} صنف`, withOp(input) as unknown as Record<string, unknown>)
  },
  async deliver(input: {
    load_id: string; customer_id: string; product_id: string; quantity: number
    unit_id: string; unit_price?: number; payment_type: 'CASH' | 'CREDIT'; delivery_date?: string
  }): Promise<OpResult> {
    return run('DISTRIBUTION_DELIVERY', `بيع توزيع — ${input.quantity}`, withOp(input) as unknown as Record<string, unknown>)
  },
  async returnGoods(input: {
    load_id: string; product_id: string; quantity: number; unit_id: string
    reason?: string | null; return_date?: string
  }): Promise<OpResult> {
    return run('DISTRIBUTION_RETURN', `مرتجع توزيع — ${input.quantity}`, withOp(input) as unknown as Record<string, unknown>)
  },
  async settle(loadId: string, cashCollected: number, varianceNote: string | null): Promise<{ doc_number: string; unaccounted: number; cash_variance: number }> {
    return rpc('settle_distribution_load', { p_load_id: loadId, p_cash_collected: cashCollected, p_variance_note: varianceNote })
  },
}
