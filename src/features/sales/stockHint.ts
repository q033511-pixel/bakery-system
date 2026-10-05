/**
 * أرصدة المخزون المحلية (للتلميح في شاشة البيع) — تُحسب من حركات المخزون المخزنة
 * عبر استعلام خادم v_stock؛ عند عدم الاتصال تعيد {} (تلميح فقط، الخادم هو المرجع).
 */
import { supabase } from '@/lib/supabase'

export async function stockHint(warehouseId: string): Promise<Record<string, number>> {
  try {
    const { data, error } = await supabase
      .from('v_stock')
      .select('item_id, qty')
      .eq('warehouse_id', warehouseId)
    if (error) return {}
    const map: Record<string, number> = {}
    for (const row of data ?? []) {
      map[(row as { item_id: string }).item_id] = Number((row as { qty: number }).qty)
    }
    return map
  } catch {
    return {}
  }
}
