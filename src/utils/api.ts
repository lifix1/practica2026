import type { User } from '../types/index.ts';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

export function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    // Clean up any legacy persistent localStorage tokens for security
    if (localStorage.getItem(TOKEN_KEY)) localStorage.removeItem(TOKEN_KEY);
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getSessionUser(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    if (localStorage.getItem(USER_KEY)) localStorage.removeItem(USER_KEY);
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function setSessionAuth(accessToken?: string | null, user?: User | null) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    if (accessToken) {
      sessionStorage.setItem(TOKEN_KEY, accessToken);
    }
    if (user) {
      sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    }
  } catch {
    // Ignore storage quota/privacy mode errors
  }
}

export function clearSessionAuth() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  } catch {
    // Ignore
  }
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => null);
      if (data?.accessToken && data?.user) {
        setSessionAuth(data.accessToken, data.user);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Universal authenticated API fetch helper
 * Injects Bearer token from sessionStorage + HttpOnly cookies and automatically refreshes expired access tokens.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const urlStr = typeof input === 'string' ? input : input.toString();
  const buildInit = (): RequestInit => {
    const token = getSessionToken();
    const headers = new Headers(init?.headers);
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return {
      ...init,
      credentials: init?.credentials || 'include',
      headers,
    };
  };

  let res = await fetch(input, buildInit());

  const isAuthEndpoint =
    urlStr.includes('/api/auth/login') ||
    urlStr.includes('/api/auth/refresh') ||
    urlStr.includes('/api/auth/logout');

  if (res.status === 401 && !isAuthEndpoint) {
    const refreshed = await tryRefreshSession();
    if (refreshed) {
      // Retry original request with refreshed access token
      const retryHeaders = new Headers(init?.headers);
      const newToken = getSessionToken();
      if (newToken) {
        retryHeaders.set('Authorization', `Bearer ${newToken}`);
      }
      res = await fetch(input, {
        ...init,
        credentials: init?.credentials || 'include',
        headers: retryHeaders,
      });
    } else if (typeof window !== 'undefined') {
      clearSessionAuth();
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
  }

  return res;
}
