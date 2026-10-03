import { createContext, useContext, useEffect, useState } from "react";

import { apiRequest, clearSession, setSession } from "../api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem("user")); } catch { return null; }
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  function applyLogin(data) {
    setSession(data);
    setUser(data.user);
    sessionStorage.setItem("user", JSON.stringify(data.user));
  }

  async function logout() {
    const token = sessionStorage.getItem("refreshToken");
    try {
      if (token) await apiRequest("/api/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: token }) }, false);
    } finally {
      clearSession();
      sessionStorage.removeItem("user");
      setUser(null);
    }
  }

  return (
    <AuthContext.Provider value={{ user, ready, applyLogin, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}