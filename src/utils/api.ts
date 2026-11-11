/**
 * Universal authenticated API fetch helper
 * Automatically injects JWT Bearer token from localStorage and credentials
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers = new Headers(init?.headers);

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const modifiedInit: RequestInit = {
    ...init,
    credentials: init?.credentials || 'include',
    headers,
  };

  return fetch(input, modifiedInit);
}
