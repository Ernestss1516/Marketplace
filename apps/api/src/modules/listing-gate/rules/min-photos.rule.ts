import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { PhotoLimitsService } from '../photo-limits.service';
import { NOT_ENOUGH_PHOTOS_CODE } from '../photo-limits';
import type { GateContext, GateListing, GateReason, ListingGateRule } from '../listing-gate.types';

/**
 * REGLA NUEVA #3 — EL MÍNIMO DE FOTOS PARA PUBLICAR.
 *
 * LO QUE HACE ES CUMPLIR UNA PROMESA VIEJA. El asistente de publicación lleva
 * desde siempre diciendo «para publicar se necesita al menos 1 foto» y
 * deshabilitando su botón sin ellas; el backend nunca lo exigió. Por «Mis
 * anuncios» o por la API se podía publicar un anuncio sin ninguna foto. Esta
 * regla alinea el servidor con lo que la interfaz promete.
 *
 * RECHAZA, NO DEGRADA — y la diferencia con la regla #2 es la que importa:
 *
 *  · El correo sin verificar es un problema FUERA del anuncio. El anuncio está
 *    perfecto; le falta un paso a su dueño en otra pantalla. Por eso se degrada:
 *    se guarda y se avisa.
 *  · Faltar fotos es un problema DENTRO del anuncio, y se arregla editándolo —
 *    igual que un atributo requerido que falta. La regla de atributos rechaza con
 *    422 y sus motivos; ésta hace lo mismo, y por lo mismo.
 *
 * AL PUBLICAR Y AL APROBAR — ES UNA REGLA DEL ANUNCIO (moderación M2).
 *
 * Renovar y reactivar siguen sin mirarla: un anuncio de hace dos años sin fotos
 * se puede renovar igual, porque una regla nueva no se aplica hacia atrás sobre
 * lo que alguien publicó cuando no se le exigía.
 *
 * Pero `approve` SÍ, y eso corrige lo que esta misma cabecera daba por bueno
 * hasta M2. El argumento de entonces era que aplicarla al aprobar dejaría al
 * moderador atrapado —no puede añadirle fotos a un anuncio ajeno— y con la
 * moderación previa en marcha ese argumento se cae por dos sitios:
 *
 *  1. **El hueco deja de ser estrecho.** Antes a `PENDING_REVIEW` sólo se llegaba
 *     por palabra prohibida; ahora es el camino principal de ramas enteras del
 *     catálogo. Un anuncio sin fotos aprobado por revisión saldría publicado
 *     saltándose exactamente el listón que la revisión existe para aplicar.
 *  2. **El moderador ya no está atrapado**, porque tiene una tercera salida:
 *     devolver el anuncio a borrador (`PENDING_REVIEW → DRAFT`) para que su dueño
 *     lo complete. No tiene que elegir entre aprobar algo inválido y dejarlo en
 *     la cola para siempre.
 *
 * LA LÍNEA, ENUNCIADA: en `approve` aplican las reglas sobre el ANUNCIO —lo que
 * el moderador está mirando— y no las del VENDEDOR (cuota, correo), que él no
 * puede arreglar y que sí lo dejarían rehén de un tercero.
 *
 * GRUPO `entrada` — BARATA: un `count` sobre `ListingImage`, con índice por
 * `listingId`.
 *
 * NACE APAGADA: puede haber anuncios publicados sin fotos, y encenderla sin saber
 * cuántos es exactamente lo que `pnpm gate-impact-report` existe para evitar.
 */
@Injectable()
export class MinPhotosRule implements ListingGateRule {
  readonly name = 'min-photos';
  readonly group = 'entrada' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly limites: PhotoLimitsService,
  ) {}

  appliesTo(context: GateContext): boolean {
    // Los DOS momentos en los que un anuncio llega al mercado por primera vez.
    // Ver la cabecera: es una regla del ANUNCIO, y las dos veces hay alguien
    // —el vendedor o el moderador— que puede actuar sobre lo que falta.
    const publicaElVendedor = context.actor === 'seller' && context.transition === 'publish';
    const apruebaElStaff = context.actor === 'staff' && context.transition === 'approve';
    return publicaElVendedor || apruebaElStaff;
  }

  isEnabled(): Promise<boolean> {
    return this.limites.isMinEnforced();
  }

  async check(listing: GateListing): Promise<GateReason | null> {
    const min = await this.limites.getMin();
    const fotos = await this.prisma.listingImage.count({ where: { listingId: listing.id } });
    if (fotos >= min) return null;

    return {
      code: NOT_ENOUGH_PHOTOS_CODE,
      // El mensaje dice cuántas hacen falta y cuántas hay: sin el segundo número
      // el vendedor no sabe cuántas le faltan.
      message:
        min === 1
          ? 'Añade al menos 1 foto para publicar el anuncio.'
          : `Añade al menos ${min} fotos para publicar el anuncio (ahora tiene ${fotos}).`,
      field: 'imageIds',
    };
  }
}
