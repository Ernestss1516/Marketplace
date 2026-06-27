const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly error?: string,
    public readonly retryAfter?: number,
    public readonly code?: string,
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

/**
 * True when the error signals insufficient wallet balance (HTTP 402).
 * Components must show a domain-specific message ("buy credits"), never the generic fallback.
 */
export function isCreditError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.statusCode === 402;
}

/**
 * True when the error signals a bump cooldown (HTTP 429).
 * The narrowed type guarantees err.retryAfter is a number — use formatRetryAfter() to display it.
 */
export function isCooldownError(err: unknown): err is ApiError & { retryAfter: number } {
  return err instanceof ApiError && err.statusCode === 429 && err.retryAfter != null;
}

/** Converts a retryAfter value (seconds) to a human-readable Spanish duration string. */
export function formatRetryAfter(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return `${hours} hora${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
}

/**
 * Maps bump-specific API errors to user-facing strings.
 * Callers must check isCreditError (402) and isCooldownError (429) BEFORE calling this.
 */
export function toBumpMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.statusCode) {
      case 400: return 'Solo se pueden subir anuncios activos.';
      case 403: return 'Este anuncio no te pertenece.';
      case 404: return 'Anuncio no encontrado.';
    }
  }
  return toUserMessage(err);
}

/**
 * Maps featured-by-credits errors to user-facing strings.
 * Callers must check isCreditError (402) BEFORE calling this.
 * Distinguishes "already featured" vs "not ACTIVE" by inspecting the backend message.
 */
export function toFeaturedByCreditsMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.statusCode) {
      case 400:
        return err.code === 'ALREADY_FEATURED'
          ? 'Este anuncio ya está destacado.'
          : 'Solo se pueden destacar anuncios activos.';
      case 403: return 'Este anuncio no te pertenece.';
      case 404: return 'El precio ya no está disponible. Actualiza la página.';
    }
  }
  return toUserMessage(err);
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
      response.status === 429 && typeof body.retryAfter === 'number' ? body.retryAfter : undefined,
      typeof body.code === 'string' ? body.code : undefined,
    );
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
