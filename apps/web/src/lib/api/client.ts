const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/**
 * PUERTA DE VALIDACIÓN — un motivo de rechazo, accionable.
 *
 * La puerta puede rechazar por varias reglas a la vez (le falta un atributo
 * requerido Y está en el tope de su plan), y el usuario necesita verlas todas de
 * una vez: descubrirlas de una en una —corregir, reintentar, descubrir la
 * siguiente— convierte un aviso en un juego de adivinanzas.
 */
export interface ApiErrorReason {
  /** Código estable, para poder ramificar sin mirar el texto. */
  code: string;
  message: string;
  /** El campo concreto al que apunta, cuando lo hay. */
  field?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly error?: string,
    public readonly retryAfter?: number,
    public readonly code?: string,
    /**
     * ADITIVO: sólo lo traen los rechazos de la puerta. Todo lo demás lo deja
     * vacío, y quien sólo lee `message`/`code` —es decir, todo el cliente
     * anterior a la puerta— sigue funcionando exactamente igual.
     */
    public readonly reasons: ApiErrorReason[] = [],
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

/**
 * True when the user chose the Pro quota (useQuota:true) but it's no longer available
 * (HTTP 400, code QUOTA_UNAVAILABLE) — e.g. a concurrent request used the last slot, or
 * the frontend's cached remaining count went stale. Components should offer the credits
 * path instead of showing a generic error, since the user explicitly asked for quota.
 */
export function isQuotaUnavailableError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.statusCode === 400 && err.code === 'QUOTA_UNAVAILABLE';
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
 * Callers must check isCreditError (402) and isQuotaUnavailableError (400/QUOTA_UNAVAILABLE)
 * BEFORE calling this — both need a domain-specific reaction (buy credits / offer the
 * credits path), not a plain string. Distinguishes "already featured" vs "not ACTIVE" by
 * inspecting the backend's error code.
 */
export function toFeaturedByCreditsMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.statusCode) {
      case 400:
        if (err.code === 'ALREADY_FEATURED') return 'Este anuncio ya está destacado.';
        if (err.code === 'QUOTA_UNAVAILABLE') return 'Ya no tienes cuota disponible este mes.';
        return 'Solo se pueden destacar anuncios activos.';
      case 403: return 'Este anuncio no te pertenece.';
      case 404: return 'El precio ya no está disponible. Actualiza la página.';
    }
  }
  return toUserMessage(err);
}

/**
 * True when the coupon canjeado needs a listingId to proceed (HTTP 400,
 * code LISTING_REQUIRED) — the coupon is a FEATURED reward and the caller sent
 * only `code`. Components should branch here to show a listing picker and
 * resend `{ code, listingId }`, instead of showing a generic error.
 */
export function isListingRequiredError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.statusCode === 400 && err.code === 'LISTING_REQUIRED';
}

/**
 * Maps coupon redemption errors (H8 Bloque D fase 3) to user-facing strings.
 * Callers must check isListingRequiredError BEFORE calling this — it needs a
 * domain-specific reaction (show the listing picker), not a plain string.
 */
export function toCouponMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'COUPON_NOT_FOUND': return 'Código no válido.';
      case 'COUPON_INACTIVE': return 'Este cupón ha caducado o no está disponible.';
      case 'COUPON_EXHAUSTED': return 'Este cupón ya se ha agotado.';
      case 'COUPON_ALREADY_REDEEMED': return 'Ya has usado este cupón.';
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
      // PUERTA — aditivo: si el backend no manda `reasons`, queda [] y nada cambia.
      Array.isArray(body.reasons) ? (body.reasons as ApiErrorReason[]) : [],
    );
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
