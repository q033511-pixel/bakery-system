/* ============================================================================
 * اختبارات محرك المزامنة — منطق نقي بلا قاعدة بيانات (تعمل في كل بيئة)
 * تغطي: ترتيب التبعيات، الحالات السبع، إعادة المحاولة، التعويض عند الرفض،
 * منع last-write-wins على المال، ديمومة الطابور عبر OpStore.
 * ========================================================================== */
import { describe, expect, it } from 'vitest'
import {
  applyPulled, createMemoryStore, isFinancialOp, orderForUpload,
  syncOnce, uploadPending,
} from '@/lib/sync/engine'
import type { PendingOp, ServerOp, SyncTransport } from '@/lib/sync/engine'

function op(partial: Partial<PendingOp> & { op_type: string; operation_id?: string }): PendingOp {
  return {
    operation_id: partial.operation_id ?? crypto.randomUUID(),
    op_type: partial.op_type,
    payload: partial.payload ?? {},
    state: partial.state ?? 'PENDING_SYNC',
    created_at: partial.created_at ?? new Date().toISOString(),
    attempts: partial.attempts ?? 0,
    device_id: 'dev-test',
    schema_version: 1,
  }
}

function transportOf(
  submitImpl: (op: PendingOp) => Promise<{ status: string; rejection_reason?: string }>,
  pullImpl: (sinceSeq: number) => Promise<ServerOp[]> = async () => [],
): SyncTransport {
  return {
    submit: submitImpl as SyncTransport['submit'],
    pull: async (s: number) => pullImpl(s),
  }
}

describe('ترتيب الرفع بتبعيات الوالد قبل الابن', () => {
  it('العميل والصنف قبل سعر العميل، والسعر قبل فاتورة آجل تستخدمه', () => {
    const ops = [
      op({ op_type: 'SALE', created_at: '2026-01-01T10:00:00Z' }),
      op({ op_type: 'CUSTOMER_PRICE_UPSERT', created_at: '2026-01-01T09:00:00Z' }),
      op({ op_type: 'CUSTOMER_UPSERT', created_at: '2026-01-01T08:00:00Z' }),
      op({ op_type: 'PRODUCT_UPSERT', created_at: '2026-01-01T07:00:00Z' }),
    ]
    const order = orderForUpload(ops).map((o) => o.op_type)
    expect(order).toEqual(['PRODUCT_UPSERT', 'CUSTOMER_UPSERT', 'CUSTOMER_PRICE_UPSERT', 'SALE'])
  })

  it('داخل نفس الرتبة: FIFO بحسب وقت التسجيل المحلي (لا إعادة ترتيب عشوائية)', () => {
    const a = op({ op_type: 'SALE', created_at: '2026-01-01T10:00:00Z', operation_id: 'a' })
    const b = op({ op_type: 'SALE', created_at: '2026-01-01T09:00:00Z', operation_id: 'b' })
    expect(orderForUpload([a, b]).map((o) => o.operation_id)).toEqual(['b', 'a'])
  })
})

describe('الحالات السبع عبر uploadPending', () => {
  it('APPROVED وDUPLICATE كلاهما → SYNCED (التكرار مقصود وآمن مالياً)', async () => {
    const ops = [op({ op_type: 'SALE' }), op({ op_type: 'EXPENSE' })]
    let i = 0
    const t = transportOf(async () => ({ status: i++ === 0 ? 'APPROVED' : 'DUPLICATE' }))
    const s = await uploadPending(ops, t)
    expect(s.synced).toHaveLength(2)
    expect(s.ops.every((o) => o.state === 'SYNCED')).toBe(true)
  })

  it('REJECTED → يُسجل سبب الخادم ويُستدعى تعويض محلي، ولا يُحذف من الطابور', async () => {
    const compensated: string[] = []
    const target = op({ op_type: 'SALE' })
    const t = transportOf(async () => ({ status: 'REJECTED', rejection_reason: 'الكمية نفدت عند الاعتماد' }))
    const s = await uploadPending([target], t, {
      onRejected: async (o, reason) => { compensated.push(`${o.operation_id}:${reason}`) },
    })
    expect(s.rejected[0].reason).toContain('نفدت')
    expect(compensated).toHaveLength(1)
    const after = s.ops.find((o) => o.operation_id === target.operation_id)!
    expect(after.state).toBe('REJECTED')
    expect(after.rejection_reason).toContain('نفدت')
  })

  it('خطأ شبكة → FAILED مع عدّاد محاولات، ثم نجاح في الدورة التالية', async () => {
    let fail = true
    const target = op({ op_type: 'SALE' })
    const t = transportOf(async () => {
      if (fail) throw new Error('network down')
      return { status: 'APPROVED' }
    })
    const first = await uploadPending([target], t)
    expect(first.failed).toHaveLength(1)
    const failedOp = first.ops[0]
    expect(failedOp.state).toBe('FAILED')
    expect(failedOp.attempts).toBe(1)
    expect(failedOp.last_error).toContain('network down')
    fail = false
    const second = await uploadPending([failedOp], t)
    expect(second.synced).toHaveLength(1)
    expect(second.ops[0].state).toBe('SYNCED')
  })

  it('العمليات المحلية (LOCAL_ONLY) والمنتظرة تُرفع، والمؤكدة (SYNCED) لا تُلمس', async () => {
    const sent: string[] = []
    const synced = op({ op_type: 'SALE', state: 'SYNCED' })
    const localOnly = op({ op_type: 'SALE', state: 'LOCAL_ONLY' })
    const t = transportOf(async (o) => { sent.push(o.operation_id); return { status: 'APPROVED' } })
    const s = await uploadPending([synced, localOnly], t)
    expect(sent).toEqual([localOnly.operation_id])
    expect(s.ops.find((o) => o.operation_id === synced.operation_id)!.state).toBe('SYNCED')
  })
})

describe('سياسة لا-آخر-تعديل-يفوز على المال', () => {
  it('كل أنواع المال ضمن isFinancialOp — لا دمج آلي أبداً (اعتماد أو رفض فقط)', () => {
    for (const t of ['SALE', 'PURCHASE', 'CUSTOMER_PAYMENT', 'SUPPLIER_PAYMENT', 'EXPENSE',
      'PRODUCTION_BATCH', 'INVENTORY_ADJUSTMENT', 'WASTE', 'TRANSFER', 'SALE_VOID', 'PURCHASE_VOID']) {
      expect(isFinancialOp(t)).toBe(true)
    }
    // الكيانات الوصفية: آخر إرسال معتمد يفوز مع تدقيق — سياسة موثقة وليست دمجاً للمال
    for (const t of ['CUSTOMER_UPSERT', 'PRODUCT_UPSERT', 'SUPPLIER_UPSERT', 'CUSTOMER_PRICE_UPSERT']) {
      expect(isFinancialOp(t)).toBe(false)
    }
  })
})

describe('السحب وتطبيق عمليات الأجهزة الأخرى', () => {
  it('يطبق المعتمدة ويتخطى المرفوضة دون إفساد البقية', async () => {
    const applied: string[] = []
    const rows: ServerOp[] = [
      { seq: 1, operation_id: 'x1', op_type: 'CUSTOMER_UPSERT', payload: {}, status: 'APPROVED' },
      { seq: 2, operation_id: 'x2', op_type: 'SALE', payload: {}, status: 'REJECTED', rejection_reason: 'نفدت' },
      { seq: 3, operation_id: 'x3', op_type: 'SALE', payload: {}, status: 'APPROVED' },
    ]
    const r = await applyPulled(rows, async (row) => {
      if (row.status === 'REJECTED') throw new Error('skip rejected')
      applied.push(row.operation_id)
    })
    expect(applied).toEqual(['x1', 'x3'])
    expect(r).toEqual({ applied: 2, skipped: 1 })
  })
})

describe('syncOnce: دورة كاملة مع طابور دائم', () => {
  it('يرفع ثم يسحب ويحفظ الحالة — الطابور يبقى بعد «إعادة تشغيل» المحرك', async () => {
    const store = createMemoryStore([
      op({ op_type: 'CUSTOMER_UPSERT', operation_id: 'c1' }),
      op({ op_type: 'SALE', operation_id: 's1' }),
    ])
    const serverOps: ServerOp[] = [
      { seq: 11, operation_id: 'other-1', op_type: 'SALE', payload: {}, status: 'APPROVED' },
    ]
    const t: SyncTransport = {
      submit: async () => ({ status: 'APPROVED' }),
      pull: async (since: number) => serverOps.filter((r) => r.seq > since),
    }
    const applied: string[] = []
    const r1 = await syncOnce(store, t, 0, async (row) => { applied.push(row.operation_id) })
    expect(r1.summary.synced).toEqual(['c1', 's1']) // العميل قبل الفاتورة
    expect(applied).toEqual(['other-1'])
    expect(r1.lastSeq).toBe(11)
    // «إعادة تشغيل»: متجر جديد يُحمَّل من التخزين نفسه
    const reloaded = await store.load()
    expect(reloaded.every((o) => o.state === 'SYNCED')).toBe(true)
    // دورة ثانية: لا شيء للرفع، ولا صفوف جديدة
    const r2 = await syncOnce(store, t, r1.lastSeq, async () => {})
    expect(r2.summary.synced).toHaveLength(0)
    expect(r2.applied).toBe(0)
  })

  it('انقطاع أثناء الرفع: الطابور المحفوظ يبقى ويعاد المحاولة في دورة لاحقة', async () => {
    const store = createMemoryStore([op({ op_type: 'SALE', operation_id: 'keep-me' })])
    let down = true
    const t: SyncTransport = {
      submit: async () => { if (down) throw new Error('ECONNREFUSED'); return { status: 'APPROVED' } },
      pull: async () => [],
    }
    await syncOnce(store, t, 0, async () => {})
    let pending = await store.load()
    expect(pending[0].state).toBe('FAILED')
    expect(pending[0].operation_id).toBe('keep-me')
    down = false
    await syncOnce(store, t, 0, async () => {})
    pending = await store.load()
    expect(pending[0].state).toBe('SYNCED')
  })
})
