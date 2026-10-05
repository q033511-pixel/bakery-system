/**
 * مصفوفة الصلاحيات (بند 34/149) — تُستخدم في الواجهة للإظهار/الإخفاء،
 * والحماية الفعلية في قاعدة البيانات عبر RLS + فحص داخل RPC (بند 35).
 */
import type { UserRole } from '@/types'

export type Permission =
  | 'sales.view'
  | 'sales.manage'
  | 'sales.void'
  | 'purchases.view'
  | 'purchases.manage'
  | 'purchases.void'
  | 'customers.view'
  | 'customers.manage'
  | 'suppliers.view'
  | 'suppliers.manage'
  | 'payments.manage'
  | 'payments.view'
  | 'inventory.view'
  | 'inventory.adjust'
  | 'inventory.transfer'
  | 'inventory.waste'
  | 'production.view'
  | 'production.manage'
  | 'recipes.manage'
  | 'products.manage'
  | 'expenses.view'
  | 'expenses.manage'
  | 'cash.view'
  | 'distribution.view'
  | 'distribution.manage'
  | 'distribution.settle'
  | 'reports.view'
  | 'audit.view'
  | 'settings.manage'
  | 'users.manage'

const ALL: Permission[] = [
  'sales.view', 'sales.manage', 'sales.void',
  'purchases.view', 'purchases.manage', 'purchases.void',
  'customers.view', 'customers.manage',
  'suppliers.view', 'suppliers.manage',
  'payments.manage', 'payments.view',
  'inventory.view', 'inventory.adjust', 'inventory.transfer', 'inventory.waste',
  'production.view', 'production.manage', 'recipes.manage',
  'products.manage',
  'expenses.view', 'expenses.manage',
  'cash.view',
  'distribution.view', 'distribution.manage', 'distribution.settle',
  'reports.view', 'audit.view', 'settings.manage', 'users.manage',
]

const READ_ONLY: Permission[] = [
  'sales.view', 'purchases.view', 'customers.view', 'suppliers.view',
  'payments.view', 'inventory.view', 'production.view',
  'expenses.view', 'cash.view', 'distribution.view', 'reports.view',
]

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  OWNER: ALL,
  ADMIN: ALL,
  ACCOUNTANT: [
    ...READ_ONLY,
    'payments.manage', 'expenses.manage', 'audit.view', 'inventory.adjust',
    'settings.manage',
  ],
  SALES: [
    'sales.view', 'sales.manage',
    'customers.view', 'customers.manage',
    'payments.manage', 'payments.view',
    'inventory.view', 'production.view', 'reports.view',
    'distribution.view', 'products.manage',
  ],
  WAREHOUSE: [
    'inventory.view', 'inventory.adjust', 'inventory.transfer', 'inventory.waste',
    'purchases.view', 'purchases.manage', 'products.manage',
    'customers.view', 'suppliers.view', 'production.view', 'reports.view',
    'distribution.view',
  ],
  PRODUCTION: [
    'production.view', 'production.manage', 'recipes.manage',
    'inventory.view', 'products.manage', 'inventory.waste', 'reports.view',
  ],
  DISTRIBUTOR: [
    'distribution.view', 'distribution.manage',
    'customers.view', 'customers.manage', 'payments.manage', 'payments.view',
    'sales.view', 'inventory.view', 'reports.view',
  ],
  VIEWER: READ_ONLY,
  PENDING: [],
}

export function can(role: UserRole | null | undefined, perm: Permission): boolean {
  if (!role) return false
  return (ROLE_PERMISSIONS[role] ?? []).includes(perm)
}

export function canAny(role: UserRole | null | undefined, perms: Permission[]): boolean {
  return perms.some((p) => can(role, p))
}

export const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: 'المالك',
  ADMIN: 'مدير النظام',
  ACCOUNTANT: 'المحاسب',
  SALES: 'المبيعات',
  WAREHOUSE: 'المخزن',
  PRODUCTION: 'الإنتاج',
  DISTRIBUTOR: 'الموزع',
  VIEWER: 'مشاهد',
  PENDING: 'بانتظار التفعيل',
}

export const ASSIGNABLE_ROLES: UserRole[] = [
  'ADMIN', 'ACCOUNTANT', 'SALES', 'WAREHOUSE', 'PRODUCTION', 'DISTRIBUTOR', 'VIEWER',
]
