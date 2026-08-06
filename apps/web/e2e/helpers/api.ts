import type { APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

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
 * ADMIN (loginViaApi las rechaza). Ver AuthService.adminLogin.
 *
 * ⚠ PARA EL SETUP DE UN SPEC, USA `adminApiToken()`, NO ESTO. Cada llamada aquí
 * consume un intento del límite de `/auth/admin-login` (20 por IP / 15 min), que
 * la batería entera comparte — ver la nota de `adminApiToken`. Esta función se
 * mantiene exportada para lo único que la justifica: ejercitar el propio
 * endpoint de login (credenciales distintas, casos de rechazo). */
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

const ADMIN_TOKEN_FILE = path.join(__dirname, '..', 'fixtures', 'admin.token.json');
let adminTokenMemo: string | undefined;

/**
 * Token bearer de `admin-e2e@example.com` para el SETUP de un spec.
 *
 * NO se autentica: lee el que `global-setup.ts` obtuvo UNA vez para toda la
 * corrida. Es el mismo patrón que los `*.storageState.json` —una autenticación
 * global, repartida por fixture— extendido de las cookies del navegador al token
 * de API, que era la laguna que quedaba.
 *
 * POR QUÉ IMPORTA: `/auth/admin-login` está limitado a 20 intentos por IP cada
 * 15 min (`ADMIN_LOGIN_RATE_LIMIT_IP_PER_WINDOW`). Cuando cada fichero se
 * autenticaba por su cuenta, una corrida completa llegaba a 32 intentos
 * (contador `auth:admin-login:ip:::1` medido en Redis) y todo lo que se
 * autenticase a partir del vigésimo recibía un 429. Como Playwright ordena por
 * alfabeto, castigaba siempre a los mismos ficheros, y cada spec nueva que se
 * autenticaba desplazaba a otra. Ese es exactamente el fallo que este helper
 * elimina: no sube el tope ni limpia contadores, deja de gastarlos.
 *
 * Lectura síncrona y memoizada: el fichero lo escribe globalSetup antes de que
 * corra ningún test, y no cambia durante la corrida.
 */
export function adminApiToken(): string {
  if (adminTokenMemo) return adminTokenMemo;
  if (!fs.existsSync(ADMIN_TOKEN_FILE)) {
    throw new Error(
      `[adminApiToken] falta ${ADMIN_TOKEN_FILE}.\n` +
        'Lo escribe e2e/global-setup.ts (paso 6). Si estás corriendo Playwright sin su ' +
        'globalSetup, arráncalo con la configuración del proyecto.',
    );
  }
  const { accessToken } = JSON.parse(fs.readFileSync(ADMIN_TOKEN_FILE, 'utf8')) as {
    accessToken: string;
  };
  adminTokenMemo = accessToken;
  return accessToken;
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
