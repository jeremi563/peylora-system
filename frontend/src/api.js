const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

let accessToken = sessionStorage.getItem("accessToken");
let refreshToken = sessionStorage.getItem("refreshToken");
let refreshPromise;

export function setSession(tokens) {
  accessToken = tokens?.accessToken || null;
  refreshToken = tokens?.refreshToken || null;
  if (accessToken) sessionStorage.setItem("accessToken", accessToken);
  else sessionStorage.removeItem("accessToken");
  if (refreshToken) sessionStorage.setItem("refreshToken", refreshToken);
  else sessionStorage.removeItem("refreshToken");
}

export function clearSession() {
  setSession(null);
}

async function refreshSession() {
  if (!refreshToken) return false;
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    }).then(async (response) => {
      if (!response.ok) return false;
      const data = await response.json();
      setSession(data);
      return true;
    }).catch(() => false).finally(() => {
      refreshPromise = undefined;
    });
  }
  return refreshPromise;
}

export async function apiRequest(path, options = {}, allowRefresh = true) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError("Could not connect to the API. Check the server and try again.", 0);
  }

  if (response.status === 401 && allowRefresh && refreshToken && !path.startsWith("/api/auth/")) {
    if (await refreshSession()) return apiRequest(path, options, false);
    clearSession();
  }

  if (!response.ok) {
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    throw new ApiError(body?.message || `Request failed (${response.status})`, response.status, body);
  }

  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json") ? response.json() : response;
}

export async function downloadReport(path, filename) {
  const headers = new Headers();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${API_BASE}${path}`, { headers });
  if (!response.ok) {
    let body;
    try { body = await response.json(); } catch { body = null; }
    throw new ApiError(body?.message || "Could not download report", response.status, body);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function apiBaseUrl() {
  return API_BASE;
}