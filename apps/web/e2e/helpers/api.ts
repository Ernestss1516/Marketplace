import type { APIRequestContext } from '@playwright/test';

// RÁFAGA 5 (verificación integral, producto/servicio) — helpers para hablar
// directo con el backend (puerto 3001) desde Playwright, sin pasar por la UI.
// Usado para: (a) el POST/GET "crudo" que prueba la coherencia backend/UI
// (admin-categorias-tipo.spec.ts), y (b) el setup rápido de categorías vía
// API admin en producto-servicio-flujo.spec.ts (la UI admin ya se prueba en
// el otro spec — aquí el foco es wizard→búsqueda→ficha, no el editor).

const API_BASE = 'http://localhost:3001';

/** Login directo contra el backend (independiente de la sesión next-auth del navegador).
 * Rechaza a ADMIN (deben usar loginAdminViaApi) — ver AuthService.login. */
export async function loginViaApi(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await request.post(`${API_BASE}/api/auth/login`, {
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(`[loginViaApi] login falló para ${email}: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { accessToken: string };
  return body.accessToken;
}

/** Login directo contra /auth/admin-login — la única puerta para cuentas
 * ADMIN (loginViaApi las rechaza). Ver AuthService.adminLogin. */
export async function loginAdminViaApi(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await request.post(`${API_BASE}/api/auth/admin-login`, {
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(`[loginAdminViaApi] login falló para ${email}: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { accessToken: string };
  return body.accessToken;
}

export function authedPost(
  request: APIRequestContext,
  path: string,
  token: string,
  data: Record<string, unknown>,
) {
  return request.post(`${API_BASE}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
}

export function authedPatch(
  request: APIRequestContext,
  path: string,
  token: string,
  data: Record<string, unknown>,
) {
  return request.patch(`${API_BASE}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
}

export function authedGet(request: APIRequestContext, path: string, token?: string) {
  return request.get(`${API_BASE}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

export function authedDelete(request: APIRequestContext, path: string, token: string) {
  return request.delete(`${API_BASE}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Sondea GET /api/search hasta que `predicate` acepte el body, o hasta agotar
 * el timeout. Necesario porque la indexación en Meilisearch es asíncrona
 * (BullMQ) — mismo motivo que `waitForCard` para las páginas SSR, pero
 * operando sobre el JSON de la API en lugar de la página renderizada.
 */
interface SearchResponse {
  hits: unknown[];
  totalHits: number;
  facets?: Record<string, Record<string, number>>;
}

export async function pollSearch(
  request: APIRequestContext,
  query: Record<string, string>,
  predicate: (body: SearchResponse) => boolean,
  { intervalMs = 1_500, timeoutMs = 30_000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<SearchResponse> {
  const deadline = Date.now() + timeoutMs;
  let lastBody: SearchResponse = { hits: [], totalHits: 0 };

  while (true) {
    const res = await request.get(`${API_BASE}/api/search?${new URLSearchParams(query)}`);
    lastBody = await res.json();
    if (predicate(lastBody)) return lastBody;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(intervalMs, remaining)));
  }

  throw new Error(
    `[pollSearch] el predicado nunca se cumplió en ${timeoutMs}ms.\n` +
      `  query: ${JSON.stringify(query)}\n` +
      `  último body: ${JSON.stringify(lastBody)}`,
  );
}
