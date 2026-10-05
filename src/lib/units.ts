/**
 * تحويل الوحدات (بند 11) — سلسلة تحويل عبر الوحدة الأساسية.
 * conversions: from_unit_id → to_unit_id بمعامل factor (from qty × factor = to qty)
 */
export interface ConversionEdge {
  from_unit_id: string
  to_unit_id: string
  factor: number
}

/** بناء خريطة تحويل ثنائية الاتجاه */
export function buildConversionMap(edges: ConversionEdge[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const e of edges) {
    const k1 = `${e.from_unit_id}->${e.to_unit_id}`
    if (!map.has(k1)) map.set(k1, e.factor)
    const k2 = `${e.to_unit_id}->${e.from_unit_id}`
    if (!map.has(k2)) map.set(k2, 1 / e.factor)
  }
  return map
}

/**
 * تحويل كمية من وحدة إلى أخرى عبر BFS (يدعم سلاسل: كيس→كغ، ربطة→قطعة).
 * يعيد null إذا لا يوجد مسار.
 */
export function convertQuantity(
  qty: number,
  fromUnit: string,
  toUnit: string,
  map: Map<string, number>,
): number | null {
  if (fromUnit === toUnit) return qty
  if (map.has(`${fromUnit}->${toUnit}`)) {
    return qty * (map.get(`${fromUnit}->${toUnit}`) as number)
  }
  // BFS عبر الوحدات
  const visited = new Set([fromUnit])
  let queue: { unit: string; rate: number }[] = [{ unit: fromUnit, rate: 1 }]
  while (queue.length > 0) {
    const next: { unit: string; rate: number }[] = []
    for (const cur of queue) {
      for (const [key, factor] of map.entries()) {
        const parts = key.split('->')
        const from = parts[0]
        const to = parts[1]
        if (!from || !to) continue
        if (from === cur.unit && !visited.has(to)) {
          const rate = cur.rate * factor
          if (to === toUnit) return qty * rate
          visited.add(to)
          next.push({ unit: to, rate })
        }
      }
    }
    queue = next
  }
  return null
}

/** تحويل إلى وحدة أساسية الصنف — أو إرجاع الكمية كما هي */
export function toBaseQty(
  qty: number,
  fromUnit: string,
  baseUnit: string,
  map: Map<string, number>,
): number {
  const converted = convertQuantity(qty, fromUnit, baseUnit, map)
  return converted === null ? qty : converted
}
