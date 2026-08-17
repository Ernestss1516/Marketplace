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
 * SÓLO AL PUBLICAR, y esto tiene una consecuencia que conviene aceptar a ojos
 * abiertos: renovar o reactivar NO lo miran. Un anuncio de hace dos años sin
 * fotos se sigue pudiendo renovar. Es deliberado — es el mismo principio que el
 * límite total: una regla nueva no se aplica hacia atrás sobre lo que alguien ya
 * publicó cuando no se le exigía.
 *
 * ⚠ HUECO CONOCIDO Y ACEPTADO: un anuncio con palabras filtradas va a
 * `PENDING_REVIEW` en vez de a ACTIVE, y `publish` no llama a la puerta en ese
 * caso (no ocupa plaza todavía). Si luego un moderador lo aprueba, llega a ACTIVE
 * sin pasar por aquí. Cerrarlo exigiría aplicar la regla también a `approve`, y
 * eso dejaría al moderador atrapado: no puede añadirle fotos a un anuncio ajeno,
 * así que no podría ni aprobarlo ni desatascarlo. Se prefiere el hueco —estrecho
 * y con un humano mirando— a bloquear la moderación.
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
    return context.actor === 'seller' && context.transition === 'publish';
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
