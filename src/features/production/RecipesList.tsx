/** الوصفات — قائمة الوصفات ونسخها الإنتاجية (بند 24/25) */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChefHat } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/app/authStore'
import { formatQty } from '@/lib/money'
import { PageHeader, AddButton } from '@/components/ui/navigation'
import { Card, Badge } from '@/components/ui/primitives'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states'
import type { Recipe } from '@/types'

interface RecipeListRow extends Recipe {
  products: { name: string } | null
  recipe_versions: { version_no: number; output_quantity: number }[]
}

export default function RecipesList() {
  const has = useAuthStore((s) => s.has)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['recipes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recipes')
        .select('*, products(name), recipe_versions(version_no, output_quantity)')
        .order('created_at')
      if (error) throw new Error(error.message)
      return data as unknown as RecipeListRow[]
    },
  })

  const rows = data ?? []

  return (
    <div className="pb-4">
      <PageHeader
        title="الوصفات"
        subtitle="مكونات كل منتج ونسخها — كل دفعة تحتفظ بنسختها"
        backTo="/"
        action={has('recipes.manage') ? <AddButton to="/recipes/new" label="وصفة جديدة" /> : undefined}
      />

      {isLoading ? (
        <Card><LoadingState /></Card>
      ) : isError ? (
        <Card>
          <ErrorState message={error instanceof Error ? error.message : 'تعذر تحميل الوصفات.'} onRetry={() => void refetch()} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title="لا توجد وصفات بعد"
            message="أنشئ وصفة لكل منتج نهائي ليعمل الاستهلاك التلقائي عند الإنتاج."
            action={has('recipes.manage') ? <AddButton to="/recipes/new" label="وصفة جديدة" /> : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const versions = [...r.recipe_versions].sort((a, b) => b.version_no - a.version_no)
            const latest = versions[0]
            return (
              <Link key={r.id} to={`/recipes/${r.id}`} className="block">
                <Card className="flex items-center justify-between gap-3 p-4 transition hover:border-primary-300">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
                      <ChefHat className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-extrabold text-stone-900">{r.name}</p>
                      <p className="mt-0.5 truncate text-xs text-stone-500">{r.products?.name ?? '—'}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-end">
                    <Badge tone="primary">{r.recipe_versions.length} نسخة</Badge>
                    <p className="mt-1 text-2xs tabular-nums text-stone-400">
                      {latest ? `آخر نسخة: v${latest.version_no} — ${formatQty(latest.output_quantity)}` : 'بلا نسخ'}
                    </p>
                  </div>
                  <ChevronLeft className="size-4 shrink-0 text-stone-300" />
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
