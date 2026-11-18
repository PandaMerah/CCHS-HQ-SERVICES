// Shared Admin Authentication & Access Control Module for Careclinics HQ Services

const AUTH_STORAGE_KEY = "cchs_hq_admin_auth_v1";
const CUSTOM_CREDS_KEY = "cchs_hq_admin_custom_creds_v1";

function getCustomCreds() {
  try {
    const raw = localStorage.getItem(CUSTOM_CREDS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // ignore
  }
  return { username: "admin", password: "cchs2026" };
}

function decodeSignedTokenPayload(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0]) return null;
  try {
    const b64 = parts[0].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const jsonStr = atob(padded);
    return JSON.parse(jsonStr);
  } catch (e) {
    return null;
  }
}

export function getAdminSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.role === "admin" && parsed.username) {
      const tokenPayload = decodeSignedTokenPayload(parsed.token);
      if (tokenPayload && typeof tokenPayload.exp === "number" && Date.now() > tokenPayload.exp) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        return null;
      }
      return parsed;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

export function getAdminToken() {
  const session = getAdminSession();
  if (session && typeof session.token === "string" && session.token.trim()) {
    return session.token.trim();
  }
  return null;
}

export function getAdminAuthHeaders() {
  const token = getAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function isAdminLoggedIn() {
  return Boolean(getAdminSession());
}

export async function loginAdmin(username, password) {
  const cleanUser = String(username || "").trim();
  const cleanPass = String(password || "");
  let allowOfflineFallback = false;

  // 1. Try Serverless /api/auth endpoint first
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: cleanUser, password: cleanPass })
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok && data.token) {
      const session = {
        username: data.username || cleanUser,
        role: "admin",
        token: data.token,
        loginAt: data.loginAt || Date.now()
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
      return { ok: true, session };
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { ok: false, error: (data && data.error) || "Invalid admin username or password." };
    }
    if (res.status === 404 || res.status === 405) {
      allowOfflineFallback = true;
    } else {
      return { ok: false, error: (data && data.error) || `Authentication failed (${res.status}).` };
    }
  } catch (e) {
    // Fallback to client-side verification only if offline / purely static hosting
    allowOfflineFallback = true;
  }

  // 2. Static/offline fallback verification against stored or default credentials (admin / cchs2026)
  if (allowOfflineFallback) {
    const localCreds = getCustomCreds();
    if (
      cleanUser.toLowerCase() === localCreds.username.toLowerCase() &&
      cleanPass === localCreds.password
    ) {
      const session = {
        username: localCreds.username,
        role: "admin",
        token: btoa(localCreds.username + ":" + Date.now()),
        loginAt: Date.now()
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
      return { ok: true, session };
    }
  }

  return { ok: false, error: "Invalid admin username or password." };
}

export async function updateAdminCredentials(currentPassword, newUsername, newPassword) {
  const session = getAdminSession();
  const localCreds = getCustomCreds();
  const curUser = session?.username || localCreds.username;
  const cleanNewUser = String(newUsername || "").trim();
  const cleanNewPass = String(newPassword || "");

  if (!cleanNewUser || !cleanNewPass) {
    return { ok: false, error: "New username and password are required." };
  }

  let allowOfflineFallback = false;

  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_credentials",
        username: curUser,
        password: currentPassword,
        newUsername: cleanNewUser,
        newPassword: cleanNewPass
      })
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok && data.token) {
      const nextCreds = {
        username: data.username || cleanNewUser,
        password: cleanNewPass
      };
      localStorage.setItem(CUSTOM_CREDS_KEY, JSON.stringify(nextCreds));

      const nextSession = {
        username: nextCreds.username,
        role: "admin",
        token: data.token,
        loginAt: data.loginAt || Date.now()
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextSession));
      return { ok: true, session: nextSession };
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { ok: false, error: (data && data.error) || "Current password does not match." };
    }
    if (res.status === 404 || res.status === 405) {
      allowOfflineFallback = true;
    } else {
      return { ok: false, error: (data && data.error) || `Credential update failed (${res.status}).` };
    }
  } catch (e) {
    allowOfflineFallback = true;
  }

  if (allowOfflineFallback) {
    if (currentPassword !== localCreds.password && currentPassword !== "cchs2026") {
      return { ok: false, error: "Current password does not match." };
    }

    const nextCreds = {
      username: cleanNewUser || "admin",
      password: cleanNewPass
    };
    localStorage.setItem(CUSTOM_CREDS_KEY, JSON.stringify(nextCreds));

    const nextSession = {
      username: nextCreds.username,
      role: "admin",
      token: btoa(nextCreds.username + ":" + Date.now()),
      loginAt: Date.now()
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextSession));
    return { ok: true, session: nextSession };
  }

  return { ok: false, error: "Unable to update credentials." };
}

export function logoutAdmin(redirectTo = "/") {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  if (redirectTo) {
    window.location.href = redirectTo;
  }
}

export function requireAdminAuth() {
  if (!isAdminLoggedIn()) {
    const currentPath = window.location.pathname + window.location.search;
    window.location.replace(`/login.html?redirect=${encodeURIComponent(currentPath)}`);
    return false;
  }
  return true;
}
