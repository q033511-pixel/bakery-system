/**
 * Router — HashRouter (بند 3/115/137): deep links وrefresh تعمل على GitHub Pages
 * بلا أي server rewrites. القرار مسجل في PROJECT_DECISIONS.md.
 *
 * البوابة (وضع محلي أحادي المستخدم):
 *   لا نشاط تجاري → معالج الإعداد /setup
 *   نشاط بلا رمز   → تعيين رمز للمرة الأولى /set-pin
 *   رمز وجلسة مقفلة → شاشة القفل /lock
 *   وإلا           → النظام مفتوح لهذه الجلسة
 */
import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { HashRouter } from 'react-router-dom'
import AppShell from './AppShell'
import { useAuthStore, loadAuthState } from './authStore'
import { hasPin, isUnlocked } from '@/lib/pin'
import { LoadingState } from '@/components/ui/states'

// Auth
const SetupPage = lazy(() => import('@/features/auth/SetupPage'))
const PinLock = lazy(() => import('@/features/auth/PinLock'))
const SetPinOnce = lazy(() => import('@/features/auth/SetPinOnce'))

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
const ImportDebtsPage = lazy(() => import('@/features/customers/ImportDebtsPage'))
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
const BackupCenter = lazy(() => import('@/features/settings/BackupCenter'))
const DataBridgePage = lazy(() => import('@/features/databridge/DataBridgePage'))
const MorePage = lazy(() => import('@/app/MorePage'))

function Guard({ children }: { children: React.ReactNode }) {
  const { profile, loaded, hasBusiness } = useAuthStore()

  if (!loaded) return <div className="flex min-h-screen items-center justify-center"><LoadingState label="جارٍ تجهيز النظام..." /></div>
  if (!hasBusiness) return <Navigate to="/setup" replace />
  if (!hasPin()) return <Navigate to="/set-pin" replace />
  if (!profile || !isUnlocked()) return <Navigate to="/lock" replace />
  return <>{children}</>
}

export default function App() {
  useEffect(() => {
    void loadAuthState()
  }, [])

  // الوضع المحلي: البيانات على هذا الجهاز — لا بوابة إعداد خارجية
  return (
    <HashRouter>
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><LoadingState /></div>}>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/lock" element={<PinLock />} />
          <Route path="/set-pin" element={<SetPinOnce />} />

          <Route element={<Guard><AppShell /></Guard>}>
            <Route index element={<Dashboard />} />
            <Route path="sale/new" element={<QuickSale />} />

            <Route path="sales" element={<SalesList />} />
            <Route path="sales/:id" element={<SaleDetail />} />

            <Route path="purchases" element={<PurchasesList />} />
            <Route path="purchases/new" element={<PurchaseForm />} />
            <Route path="purchases/:id" element={<PurchaseDetail />} />

            <Route path="customers" element={<CustomersList />} />
            <Route path="customers/import" element={<ImportDebtsPage />} />
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
            <Route path="settings/backup" element={<BackupCenter />} />
            <Route path="databridge" element={<DataBridgePage />} />
            <Route path="more" element={<MorePage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  )
}
