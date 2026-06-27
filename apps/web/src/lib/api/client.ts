const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly error?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Returns a safe, user-facing error message.
 * Never exposes raw backend text — internal error details must never reach the UI.
 */
export function toUserMessage(_err: unknown): string {
  return 'Ha ocurrido un error. Inténtalo de nuevo.';
}

/**
 * True when the error signals a stale/missing JWT (HTTP 401).
 * Client components should call signOut() and redirect to /login when this is true.
 * 403 is intentionally excluded — it means "authenticated but not allowed" (business rule)
 * and must be handled by the component with a domain-specific message.
 */
export function isAuthError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.statusCode === 401;
}

interface FetchOptions extends RequestInit {
  token?: string;
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { token, ...init } = options;

  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new ApiError(
      response.status,
      String(body.message ?? response.statusText),
      body.error ? String(body.error) : undefined,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
