/**
 * Router — HashRouter (بند 3/115/137): deep links وrefresh تعمل على GitHub Pages
 * بلا أي server rewrites. القرار مسجل في PROJECT_DECISIONS.md.
 */
import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { HashRouter } from 'react-router-dom'
import AppShell from './AppShell'
import { useAuthStore, loadAuthState } from './authStore'
import { LoadingState } from '@/components/ui/states'
import { isSupabaseConfigured } from '@/lib/env'
import { EnvError } from '@/app/EnvError'

// Auth
const LoginPage = lazy(() => import('@/features/auth/LoginPage'))
const BootstrapPage = lazy(() => import('@/features/auth/BootstrapPage'))

// Core pages (heavy routes are code-split — بند 145/146)
const Dashboard = lazy(() => import('@/features/dashboard/Dashboard'))
const QuickSale = lazy(() => import('@/features/sales/QuickSale'))
const SalesList = lazy(() => import('@/features/sales/SalesList'))
const SaleDetail = lazy(() => import('@/features/sales/SaleDetail'))
const PurchasesList = lazy(() => import('@/features/purchases/PurchasesList'))
const PurchaseForm = lazy(() => import('@/features/purchases/PurchaseForm'))
const PurchaseDetail = lazy(() => import('@/features/purchases/PurchaseDetail'))
const CustomersList = lazy(() => import('@/features/customers/CustomersList'))
const CustomerDetail = lazy(() => import('@/features/customers/CustomerDetail'))
const SuppliersList = lazy(() => import('@/features/suppliers/SuppliersList'))
const SupplierDetail = lazy(() => import('@/features/suppliers/SupplierDetail'))
const ProductsList = lazy(() => import('@/features/products/ProductsList'))
const ProductForm = lazy(() => import('@/features/products/ProductForm'))
const InventoryHome = lazy(() => import('@/features/inventory/InventoryHome'))
const InventoryMovements = lazy(() => import('@/features/inventory/InventoryMovements'))
const InventoryAdjust = lazy(() => import('@/features/inventory/InventoryAdjust'))
const WasteForm = lazy(() => import('@/features/inventory/WasteForm'))
const TransferForm = lazy(() => import('@/features/inventory/TransferForm'))
const ProductionList = lazy(() => import('@/features/production/ProductionList'))
const ProductionForm = lazy(() => import('@/features/production/ProductionForm'))
const RecipesList = lazy(() => import('@/features/production/RecipesList'))
const RecipeDetail = lazy(() => import('@/features/production/RecipeDetail'))
const ExpensesList = lazy(() => import('@/features/expenses/ExpensesList'))
const ExpenseForm = lazy(() => import('@/features/expenses/ExpenseForm'))
const CashHome = lazy(() => import('@/features/expenses/CashHome'))
const DistributionList = lazy(() => import('@/features/distribution/DistributionList'))
const LoadForm = lazy(() => import('@/features/distribution/LoadForm'))
const LoadDetail = lazy(() => import('@/features/distribution/LoadDetail'))
const VehiclesPage = lazy(() => import('@/features/distribution/VehiclesPage'))
const ReportsHub = lazy(() => import('@/features/reports/ReportsHub'))
const ReportView = lazy(() => import('@/features/reports/ReportView'))
const AuditLogPage = lazy(() => import('@/features/audit/AuditLogPage'))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'))
const UsersSettings = lazy(() => import('@/features/settings/UsersSettings'))
const SyncCenter = lazy(() => import('@/features/sync/SyncCenter'))
const MorePage = lazy(() => import('@/app/MorePage'))

function Guard({ children }: { children: React.ReactNode }) {
  const { profile, loaded } = useAuthStore()

  if (!loaded) return <div className="flex min-h-screen items-center justify-center"><LoadingState label="جارٍ التحقق من الجلسة..." /></div>
  if (!profile) return <Navigate to="/login" replace />
  if (profile.role === 'PENDING' || !profile.business_id) {
    return <Navigate to="/login" replace state={{ pending: true }} />
  }
  return <>{children}</>
}

export default function App() {
  useEffect(() => {
    void loadAuthState()
  }, [])

  if (!isSupabaseConfigured()) {
    return <EnvError />
  }

  return (
    <HashRouter>
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><LoadingState /></div>}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/bootstrap" element={<BootstrapPage />} />

          <Route element={<Guard><AppShell /></Guard>}>
            <Route index element={<Dashboard />} />
            <Route path="sale/new" element={<QuickSale />} />

            <Route path="sales" element={<SalesList />} />
            <Route path="sales/:id" element={<SaleDetail />} />

            <Route path="purchases" element={<PurchasesList />} />
            <Route path="purchases/new" element={<PurchaseForm />} />
            <Route path="purchases/:id" element={<PurchaseDetail />} />

            <Route path="customers" element={<CustomersList />} />
            <Route path="customers/:id" element={<CustomerDetail />} />
            <Route path="suppliers" element={<SuppliersList />} />
            <Route path="suppliers/:id" element={<SupplierDetail />} />

            <Route path="products" element={<ProductsList />} />
            <Route path="products/new" element={<ProductForm />} />
            <Route path="products/:id" element={<ProductForm />} />

            <Route path="inventory" element={<InventoryHome />} />
            <Route path="inventory/movements" element={<InventoryMovements />} />
            <Route path="inventory/adjust" element={<InventoryAdjust />} />
            <Route path="inventory/waste" element={<WasteForm />} />
            <Route path="inventory/transfer" element={<TransferForm />} />

            <Route path="production" element={<ProductionList />} />
            <Route path="production/new" element={<ProductionForm />} />
            <Route path="recipes" element={<RecipesList />} />
            <Route path="recipes/new" element={<RecipeDetail />} />
            <Route path="recipes/:id" element={<RecipeDetail />} />

            <Route path="expenses" element={<ExpensesList />} />
            <Route path="expenses/new" element={<ExpenseForm />} />
            <Route path="cash" element={<CashHome />} />

            <Route path="distribution" element={<DistributionList />} />
            <Route path="distribution/new" element={<LoadForm />} />
            <Route path="distribution/:id" element={<LoadDetail />} />
            <Route path="vehicles" element={<VehiclesPage />} />

            <Route path="reports" element={<ReportsHub />} />
            <Route path="reports/:reportId" element={<ReportView />} />
            <Route path="audit" element={<AuditLogPage />} />

            <Route path="settings" element={<SettingsPage />} />
            <Route path="settings/users" element={<UsersSettings />} />
            <Route path="sync" element={<SyncCenter />} />
            <Route path="more" element={<MorePage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  )
}
