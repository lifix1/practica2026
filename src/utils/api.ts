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

function isHtmlContentType(res: Response): boolean {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  return ct.includes('text/html');
}

function isApiUrl(urlStr: string): boolean {
  return urlStr.startsWith('/api/') || urlStr.includes('/api/');
}

function buildSyntheticServiceUnavailableResponse(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function safeReadJson<T>(res: Response, fallback: T): Promise<T> {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct && !ct.includes('application/json') && !ct.includes('+json')) {
    return fallback;
  }
  try {
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resilientFetch(
  input: RequestInfo | URL,
  makeInit: () => RequestInit
): Promise<Response> {
  const urlStr = typeof input === 'string' ? input : input.toString();
  const initial = makeInit();
  const method = (initial.method || 'GET').toUpperCase();
  const isSafeMethod = method === 'GET' || method === 'HEAD';
  const expectingApiJson = isApiUrl(urlStr);
  const maxAttempts = isSafeMethod ? 4 : 1;
  const retryDelaysMs = [500, 1200, 2000];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (initial.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      const res = await fetch(input, attempt === 1 ? initial : makeInit());
      const transientGateway = res.status === 502 || res.status === 503 || res.status === 504;
      const unexpectedHtml = expectingApiJson && isHtmlContentType(res);

      if ((transientGateway || unexpectedHtml) && isSafeMethod && attempt < maxAttempts) {
        await sleep(retryDelaysMs[attempt - 1] ?? 1500);
        continue;
      }

      if (unexpectedHtml) {
        return buildSyntheticServiceUnavailableResponse(
          'Сервер временно недоступен или перезапускается. Повторите попытку.'
        );
      }

      return res;
    } catch (err: any) {
      if (err?.name === 'AbortError' || initial.signal?.aborted) {
        throw err;
      }
      if (isSafeMethod && attempt < maxAttempts) {
        await sleep(retryDelaysMs[attempt - 1] ?? 1500);
        continue;
      }
      return buildSyntheticServiceUnavailableResponse(
        'Не удалось подключиться к серверу. Проверьте соединение и повторите попытку.'
      );
    }
  }

  return buildSyntheticServiceUnavailableResponse(
    'Сервер временно недоступен. Повторите попытку.'
  );
}

async function tryRefreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok || isHtmlContentType(res)) return false;
      const data = await safeReadJson<{ accessToken?: string; user?: User } | null>(res, null);
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

  let res = await resilientFetch(input, buildInit);

  const isAuthEndpoint =
    urlStr.includes('/api/auth/login') ||
    urlStr.includes('/api/auth/refresh') ||
    urlStr.includes('/api/auth/logout');

  if (res.status === 401 && !isAuthEndpoint) {
    const refreshed = await tryRefreshSession();
    if (refreshed) {
      // Retry original request with refreshed access token
      res = await resilientFetch(input, buildInit);
    } else if (typeof window !== 'undefined') {
      clearSessionAuth();
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
  }

  return res;
}
