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

export function getAdminSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.role === "admin" && parsed.username) {
      return parsed;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

export function isAdminLoggedIn() {
  return Boolean(getAdminSession());
}

export async function loginAdmin(username, password) {
  const cleanUser = String(username || "").trim();
  const cleanPass = String(password || "");

  // 1. Try Serverless /api/auth endpoint first
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: cleanUser, password: cleanPass })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok) {
        const session = {
          username: data.username || cleanUser,
          role: "admin",
          token: data.token,
          loginAt: Date.now()
        };
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
        return { ok: true, session };
      }
    }
  } catch (e) {
    // Fallback to client-side verification if offline
  }

  // 2. Fallback / Local verification against stored or default credentials (admin / cchs2026)
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

  return { ok: false, error: "Invalid admin username or password." };
}

export async function updateAdminCredentials(currentPassword, newUsername, newPassword) {
  const session = getAdminSession();
  const localCreds = getCustomCreds();
  const curUser = session?.username || localCreds.username;

  try {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_credentials",
        username: curUser,
        password: currentPassword,
        newUsername,
        newPassword
      })
    });
  } catch (e) {
    // non-fatal
  }

  if (currentPassword !== localCreds.password && currentPassword !== "cchs2026") {
    return { ok: false, error: "Current password does not match." };
  }

  const nextCreds = {
    username: String(newUsername || "admin").trim(),
    password: String(newPassword)
  };
  localStorage.setItem(CUSTOM_CREDS_KEY, JSON.stringify(nextCreds));

  const nextSession = {
    username: nextCreds.username,
    role: "admin",
    token: btoa(nextCreds.username + ":" + Date.now()),
    loginAt: Date.now()
  };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextSession));
  return { ok: true };
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
