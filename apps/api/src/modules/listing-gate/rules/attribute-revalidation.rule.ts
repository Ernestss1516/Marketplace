import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AttributeCheckService } from '../attribute-check.service';
import type { GateContext, GateListing, GateReason, ListingGateRule } from '../listing-gate.types';

/**
 * El interruptor de esta regla. MOLDE `videoEnabled`: una fila de `Setting`,
 * editable desde el backoffice (`PATCH /admin/settings/:key`), y SIN FILA
 * SIGNIFICA APAGADA. Registrada en la lista de claves editables de `AdminService`
 * —sin eso sería un ajuste que nadie puede tocar—, y con su lector aquí abajo,
 * que es la otra mitad del molde: este repo ya arrastra dos ajustes muertos
 * (`listingExpiryDays`, `contactRequiresVerification`) y un interruptor sin
 * lector es peor que no tenerlo.
 */
export const ATTRIBUTE_RULE_ENABLED_SETTING = 'attributeRevalidationEnabled';

/**
 * B.2 — LOS ATRIBUTOS CONTRA EL SCHEMA EFECTIVO DE SU CATEGORÍA.
 *
 * NACE APAGADA, y no por prudencia genérica: es la única regla de la puerta que
 * puede frenar a anuncios que llevan años publicados sin que su dueño haya hecho
 * nada. El alta valida los atributos desde siempre, pero la CONFIGURACIÓN de las
 * categorías cambia debajo de anuncios ya publicados —renombrar un atributo,
 * quitar una opción de un select, marcar uno como requerido— y hoy eso no avisa
 * a nadie. Encenderla sin saber a cuántos afecta es exactamente la decisión que
 * el informe de M2 existe para no tomar a ciegas (`pnpm gate-impact-report`).
 *
 * QUÉ COMPRUEBA. El bag completo del anuncio contra el schema EFECTIVO N-nivel
 * (el pliegue de toda su cadena) filtrado por su tipo: requeridos que faltan,
 * valores fuera de opciones o de tipo, selects vinculados incoherentes y claves
 * huérfanas que el schema ya no reconoce. Es la misma comprobación que hace el
 * alta, sin el «grandfathering» del delta que aplica la edición: aquí la
 * pregunta no es «¿está bien lo que acabas de tocar?» sino «¿está bien el
 * anuncio?».
 *
 * GRUPO `contenido` — CARA: resuelve la cadena de categorías. Por eso el grupo
 * `entrada` corta antes: no se paga esto por un anuncio que ya falló la cuota.
 *
 * `appliesTo` — TODOS LOS ACTORES, al revés que la cuota. La diferencia no es
 * caprichosa: la cuota es una propiedad del VENDEDOR (su plan), y por eso el
 * trabajo de moderación no puede quedar rehén de ella; esto es una propiedad del
 * ANUNCIO, y un moderador que aprueba un anuncio inválido publica algo que el
 * propio editor rechazaría.
 *
 * EN `bump`/`featured` SÓLO MIRA A LOS MARCADOS. Promocionar no es publicar: el
 * anuncio ya está ACTIVE y ya se está viendo. Revalidar ahí el universo entero
 * convertiría la regla en un peaje sobre las acciones que generan ingreso; en
 * cambio, cobrarle la revalidación a quien YA está marcado es justo la política
 * de `needsRevalidation` (§C del diseño): no puedes hacer nada nuevo con un
 * anuncio que sabes que está fuera de norma, hasta arreglarlo.
 */
@Injectable()
export class AttributeRevalidationRule implements ListingGateRule {
  readonly name = 'attribute-revalidation';
  readonly group = 'contenido' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly attributes: AttributeCheckService,
  ) {}

  appliesTo(_context: GateContext): boolean {
    return true;
  }

  /** Sin fila, apagada. Molde `VideoService.isEnabled`, incluido el `=== true`. */
  async isEnabled(): Promise<boolean> {
    const ajuste = await this.prisma.setting.findUnique({
      where: { key: ATTRIBUTE_RULE_ENABLED_SETTING },
      select: { value: true },
    });
    return ajuste?.value === true;
  }

  async check(listing: GateListing, context: GateContext): Promise<GateReason[] | null> {
    const soloMarcados = context.transition === 'bump' || context.transition === 'featured';
    if (soloMarcados && !listing.needsRevalidation) return null;

    const issues = await this.attributes.issuesFor(listing);
    if (issues.length === 0) return null;

    // VARIOS motivos, uno por atributo. Es la decisión D-motivos del diseño, y su
    // razón es esta regla: un anuncio marcado puede incumplir tres cosas, y
    // descubrirlas de una en una —corregir, reintentar, descubrir la siguiente—
    // convierte el aviso en un juego de adivinanzas.
    return issues.map((i) => ({ code: i.code, message: i.message, field: i.field }));
  }
}
