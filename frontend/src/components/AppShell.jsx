import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  Bell,
  ChevronDown,
  CircleHelp,
  FileText,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  ReceiptText,
  Settings,
  ShieldCheck,
  Users,
  X
} from "lucide-react";

import { apiRequest } from "../api.js";
import { useAuth } from "../state/auth.jsx";

const navigation = [
  { label: "Overview", to: "/", icon: LayoutDashboard, end: true },
  { label: "Payments", to: "/payments", icon: ReceiptText },
  { label: "Transactions", to: "/transactions", icon: Activity },
  { label: "Invoices", to: "/invoices", icon: FileText },
  { label: "Payment links", to: "/payment-links", icon: Link2 },
  { label: "Customers", to: "/customers", icon: Users },
  { label: "Analytics", to: "/analytics", icon: Activity },
  { label: "Notifications", to: "/notifications", icon: Bell }
];

const pageNames = {
  "/": "Overview",
  "/payments": "Payments",
  "/transactions": "Transactions",
  "/invoices": "Invoices",
  "/payment-links": "Payment links",
  "/customers": "Customers",
  "/analytics": "Analytics",
  "/notifications": "Notifications",
  "/subscription": "Subscription",
  "/settings": "Settings",
  "/admin": "Admin",
  "/swagger": "API docs",
  "/developers": "Developer portal"
};

function NotificationMenu() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState("");

  async function load() {
    try {
      const data = await apiRequest("/api/notifications?limit=8&unreadOnly=false");
      setNotifications(data.notifications || []);
      setUnread(data.unreadCount || 0);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function readAll() {
    await apiRequest("/api/notifications/read-all", { method: "PATCH" });
    await load();
  }

  async function markRead(id) {
    await apiRequest(`/api/notifications/${id}/read`, { method: "PATCH" });
    await load();
  }

  return (
    <div className="notification-wrap">
      <button className="icon-button notification-trigger" type="button" aria-label="Notifications" onClick={() => setOpen((value) => !value)}>
        <Bell size={18} />
        {unread > 0 && <span className="notification-count">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="notification-popover">
          <div className="popover-heading">
            <div><strong>Notifications</strong><span>{unread} unread</span></div>
            <button className="text-button" type="button" onClick={readAll} disabled={!unread}>Mark all read</button>
          </div>
          {error && <p className="inline-error">{error}</p>}
          {notifications.length ? notifications.map((item) => (
            <button className={`notification-row ${item.read_at ? "is-read" : ""}`} key={item.id} type="button" onClick={() => !item.read_at && markRead(item.id)}>
              <span className={`notification-dot ${item.payload?.status === "SUCCESS" ? "is-success" : ""}`} />
              <span className="notification-copy">
                <strong>{item.payload?.title || item.type}</strong>
                <small>{item.payload?.reference || item.payload?.status || "Account update"} · {new Date(item.created_at).toLocaleString()}</small>
              </span>
            </button>
          )) : <p className="empty-inline">You’re all caught up.</p>}
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [apiHealthy, setApiHealthy] = useState(true);
  const title = pageNames[location.pathname] || "Merchant workspace";
  const initials = (user?.name || user?.email || "M").split(/[\s@]/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
  const adminNavigation = user?.role === "ADMIN" ? [{ label: "Admin", to: "/admin", icon: ShieldCheck }] : [];

  useEffect(() => {
    let active = true;
    apiRequest("/health", {}, false)
      .then((res) => { if (active) setApiHealthy(res?.status === "healthy" || res?.status === "ok"); })
      .catch(() => { if (active) setApiHealthy(false); });
    return () => { active = false; };
  }, [location.pathname]);

  useEffect(() => {
    setMobileOpen(false);
    setProfileOpen(false);
  }, [location.pathname]);

  const sidebar = (
    <aside className="sidebar">
      <div className="brand-lockup">
        <span className="brand-mark"><span /></span>
        <span><strong>peyflow</strong><small>MERCHANT WORKSPACE</small></span>
      </div>
      <div className="workspace-label">WORKSPACE <ChevronDown size={13} /></div>
      <div className="workspace-name"><span className="workspace-avatar">{initials || "M"}</span><span><strong>{user?.name || "Merchant account"}</strong><small>Merchant workspace</small></span></div>
      <nav className="primary-nav" aria-label="Main navigation">
        <span className="nav-caption">MANAGE</span>
        {[...navigation, ...adminNavigation].map(({ label, to, icon: Icon, end }) => (
          <NavLink className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} end={end} key={to} to={to}>
            <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <NavLink className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} to="/subscription"><ReceiptText size={17} /><span>Subscription</span></NavLink>
        <NavLink className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} to="/developers"><CircleHelp size={17} /><span>Developer</span></NavLink>
        <NavLink className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} to="/swagger"><Activity size={17} /><span>API docs</span></NavLink>
        <NavLink className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} to="/settings"><Settings size={17} /><span>Settings</span></NavLink>
        <div className="sandbox-status"><span className="status-pulse" /><span><strong>Sandbox mode</strong><small>Daraja test environment</small></span></div>
      </div>
    </aside>
  );

  return (
    <div className="app-frame">
      {mobileOpen && <button className="mobile-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <div className={`sidebar-host ${mobileOpen ? "open" : ""}`}>
        {sidebar}
        <button className="mobile-close icon-button" type="button" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={18} /></button>
      </div>
      <div className="main-column">
        <header className="topbar">
          <div className="topbar-title">
            <button className="mobile-menu icon-button" type="button" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={19} /></button>
            <div><span className="breadcrumb">Merchant workspace <span>/</span></span><h1>{title}</h1></div>
          </div>
          <div className="topbar-actions">
            <span className={`environment-tag ${apiHealthy ? "" : "is-offline"}`} title={apiHealthy ? "Backend connected" : "Connecting to backend..."}><i /> {apiHealthy ? "SANDBOX" : "CONNECTING"}</span>
            <NotificationMenu />
            <div className="profile-wrap">
              <button className="profile-trigger" type="button" onClick={() => setProfileOpen((value) => !value)}>
                <span className="profile-avatar">{initials || "M"}</span><span className="profile-name">{user?.name || user?.email}</span><ChevronDown size={14} />
              </button>
              {profileOpen && <div className="profile-menu"><NavLink to="/settings"><Settings size={15} /> Account settings</NavLink><button type="button" onClick={logout}><LogOut size={15} /> Sign out</button></div>}
            </div>
          </div>
        </header>
        <main className="page-content"><Outlet /></main>
        <footer className="app-footer"><span>peyflow</span><span>Daraja sandbox · KES</span></footer>
      </div>
    </div>
  );
}