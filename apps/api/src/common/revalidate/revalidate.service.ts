import { Injectable, Logger } from '@nestjs/common';

/**
 * Revalidación on-demand de Next.js (ISR path o unstable_cache tag),
 * fire-and-forget: un frontend lento o caído no debe fallar la acción admin
 * que la dispara. Compartido entre BlogService (páginas/posts) y
 * FooterService (columnas/ítems del footer) — antes vivía duplicado como un
 * método privado de BlogService; extraído aquí para que "reutilizar" sea
 * literal y no una segunda copia-pega del mismo fetch con el mismo AbortSignal.
 *
 * NOTA: billing.processor.ts:161 tiene su propia copia de este patrón, sin
 * tocar — no es parte de este mini-hito (footer nav).
 */
@Injectable()
export class RevalidateService {
  private readonly logger = new Logger(RevalidateService.name);

  constructor() {
    // Logueado una sola vez (Nest singleton), no por request: ausencia de
    // REVALIDATE_SECRET es un modo dev soportado (ISR sigue revalidando por
    // su propio TTL), no necesariamente una mala configuración.
    if (!process.env.REVALIDATE_SECRET) {
      this.logger.warn(
        'REVALIDATE_SECRET no configurado: revalidación on-demand deshabilitada (blog/páginas/footer se actualizan al expirar el TTL de ISR)',
      );
    }
  }

  revalidatePath(path: string): void {
    this.call({ path });
  }

  revalidateTag(tag: string): void {
    this.call({ tag });
  }

  private call(params: { path?: string; tag?: string }): void {
    const secret = process.env.REVALIDATE_SECRET;
    if (!secret) return;
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const qs = new URLSearchParams({ secret });
    if (params.path !== undefined) qs.set('path', params.path);
    if (params.tag !== undefined) qs.set('tag', params.tag);
    // Logueado aparte de la URL de la request — la URL lleva `secret` en la
    // query string y nunca debe acabar en logs.
    const target = params.path ?? `tag:${params.tag}`;
    fetch(`${appUrl}/api/revalidate?${qs}`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
    })
      .then((res) => {
        // fetch() solo rechaza en fallo de red — un 404/500 resuelve
        // "correctamente" y falla en silencio a revalidar salvo que se
        // compruebe aquí.
        if (!res.ok) {
          this.logger.warn(`Revalidation endpoint returned ${res.status} for ${target}`);
        }
      })
      .catch((err) => {
        this.logger.warn(
          `Revalidation request failed for ${target}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }
}
