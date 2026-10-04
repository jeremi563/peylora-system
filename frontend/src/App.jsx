import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./state/auth.jsx";
import AppShell from "./components/AppShell.jsx";

const AdminPage = lazy(() => import("./pages/AdminPage.jsx"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage.jsx"));
const AuthPage = lazy(() => import("./pages/AuthPage.jsx"));
const CustomersPage = lazy(() => import("./pages/CustomersPage.jsx"));
const DashboardPage = lazy(() => import("./pages/DashboardPage.jsx"));
const DeveloperPage = lazy(() => import("./pages/DeveloperPage.jsx"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage.jsx"));
const InvoicesPage = lazy(() => import("./pages/InvoicesPage.jsx"));
const LandingPage = lazy(() => import("./pages/LandingPage.jsx"));
const LinksPage = lazy(() => import("./pages/LinksPage.jsx"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage.jsx"));
const PaymentsPage = lazy(() => import("./pages/PaymentsPage.jsx"));
const PublicPaymentPage = lazy(() => import("./pages/PublicPaymentPage.jsx"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage.jsx"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.jsx"));
const SubscriptionPage = lazy(() => import("./pages/SubscriptionPage.jsx"));
const SwaggerPage = lazy(() => import("./pages/SwaggerPage.jsx"));
const TransactionsPage = lazy(() => import("./pages/TransactionsPage.jsx"));
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
        <Route path="/home" element={<LandingPage />} />
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <AuthPage mode="login" />} />
        <Route path="/register" element={user ? <Navigate to="/" replace /> : <AuthPage mode="register" />} />
        <Route path="/forgot-password" element={user ? <Navigate to="/" replace /> : <ForgotPasswordPage />} />
        <Route path="/reset-password" element={user ? <Navigate to="/" replace /> : <ResetPasswordPage />} />
        <Route path="/developers" element={<DeveloperPage />} />
        <Route path="/docs" element={<DeveloperPage />} />
        <Route path="/swagger" element={<SwaggerPage />} />
        <Route path="/pay/:reference" element={<PublicPaymentPage />} />
        <Route path="/" element={<PrivateRoute><AppShell /></PrivateRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="payment-links" element={<LinksPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="subscription" element={<SubscriptionPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin" element={<AdminPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}