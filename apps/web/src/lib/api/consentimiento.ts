import { apiFetch } from './client';
import type { Categoria } from '@/lib/consentimiento/constantes';

/**
 * COOKIES RÁFAGA 1 — el registro de la decisión en el servidor (la prueba, art. 7.1).
 *
 * Ver docs/diseno-consentimiento-cookies.md §2.4.
 */

export type AccionConsentimiento = 'GRANTED' | 'REJECTED' | 'UPDATED' | 'WITHDRAWN';

/**
 * Registra la decisión y devuelve el id con el que probarla, o `null` si no se pudo.
 *
 * ─── NUNCA LANZA, Y ESA ES LA DECISIÓN ──────────────────────────────────────────
 *
 * FAIL-OPEN. Si la API no responde, el llamador escribe su cookie igual, con `id: null`,
 * y el usuario no ve ningún error. Es la doctrina que ya gobierna la telemetría de este
 * repo («el tracking nunca debe afectar la experiencia», `lib/api/anuncios.ts:23-27`), y
 * aquí es todavía más clara: **un fallo al registrar la prueba no puede impedir que se
 * respete la voluntad del usuario**.
 *
 * Lo que se acepta es una prueba incompleta si el backend está caído. Lo contrario
 * —ignorar un rechazo porque la API no responde— sería mucho peor: incumpliría
 * justamente en el caso que el sistema existe para cubrir. **[legal]** en el diseño,
 * pendiente de confirmar con asesoría que el riesgo probatorio es aceptable.
 */
/**
 * RÁFAGA 2 — ata una decisión anónima a la cuenta que acaba de entrar.
 *
 * NUNCA LANZA, por el mismo motivo que `registrarConsentimiento`: si falla, lo que se
 * pierde es un detalle de la prueba, no la decisión del usuario — que sigue guardada en
 * su cookie y sigue respetándose. No hay nada que el usuario pueda hacer con ese error,
 * así que no se le enseña.
 */
export async function vincularConsentimiento(
  consentRecordId: string,
  token: string,
): Promise<void> {
  try {
    await apiFetch<{ id: string | null }>('/consent/vincular', {
      method: 'POST',
      body: JSON.stringify({ consentRecordId }),
      token,
    });
  } catch {
    // Silencio deliberado — ver arriba.
  }
}

export async function registrarConsentimiento(input: {
  action: AccionConsentimiento;
  categories: Categoria[];
  policyVersion: string;
  token?: string;
}): Promise<string | null> {
  try {
    const res = await apiFetch<{ id: string | null }>('/consent', {
      method: 'POST',
      body: JSON.stringify({
        action: input.action,
        categories: input.categories,
        policyVersion: input.policyVersion,
      }),
      token: input.token,
    });
    return res.id;
  } catch {
    return null;
  }
}
