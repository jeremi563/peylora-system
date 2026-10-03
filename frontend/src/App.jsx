import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./state/auth.jsx";
import AppShell from "./components/AppShell.jsx";

const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage.jsx"));
const AuthPage = lazy(() => import("./pages/AuthPage.jsx"));
const DashboardPage = lazy(() => import("./pages/DashboardPage.jsx"));
const InvoicesPage = lazy(() => import("./pages/InvoicesPage.jsx"));
const LinksPage = lazy(() => import("./pages/LinksPage.jsx"));
const PaymentsPage = lazy(() => import("./pages/PaymentsPage.jsx"));
const PublicPaymentPage = lazy(() => import("./pages/PublicPaymentPage.jsx"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.jsx"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage.jsx"));

function RouteLoading() {
  return <div className="app-loading">Opening workspace</div>;
}

function PrivateRoute({ children }) {
  const { ready, user } = useAuth();
  if (!ready) return <div className="app-loading">Loading workspace</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <AuthPage mode="login" />} />
        <Route path="/register" element={user ? <Navigate to="/" replace /> : <AuthPage mode="register" />} />
        <Route path="/pay/:reference" element={<PublicPaymentPage />} />
        <Route path="/" element={<PrivateRoute><AppShell /></PrivateRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="payment-links" element={<LinksPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}