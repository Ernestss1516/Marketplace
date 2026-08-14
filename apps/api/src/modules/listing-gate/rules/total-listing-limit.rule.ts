import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { ProStatusService } from '../pro-status.service';
import {
  DEFAULT_FREE_TOTAL_LIMIT,
  DEFAULT_PRO_TOTAL_LIMIT,
  ESTADOS_QUE_CUENTAN_AL_TOTAL,
  FREE_TOTAL_LIMIT_SETTING,
  PRO_TOTAL_LIMIT_SETTING,
  TOTAL_LIMIT_RULE_ENABLED_SETTING,
} from '../listing-limits';
import type { GateContext, GateReason, ListingGateRule } from '../listing-gate.types';

/**
 * REGLA NUEVA #1 — EL LÍMITE TOTAL DE ANUNCIOS.
 *
 * Es la primera regla que la puerta no hereda de nada: la cuota de activos ya
 * existía y sólo se mudó, y la de atributos formaliza validaciones que el alta ya
 * hacía. Ésta es política nueva, y por eso NACE APAGADA.
 *
 * QUÉ LIMITA, Y EN QUÉ SE DIFERENCIA DE LA CUOTA DE ACTIVOS. La cuota de activos
 * limita el ESCAPARATE (sólo `ACTIVE`); ésta limita la ACUMULACIÓN (todo menos
 * `ARCHIVED` y `SOLD` — ver `ESTADOS_QUE_CUENTAN_AL_TOTAL`). Conviven: son dos
 * reglas separadas en la misma lista, con topes propios, mensajes propios y
 * momentos de aplicación distintos.
 *
 * ES UN LÍMITE DE ENTRADA, y esto es lo más importante de su diseño: **no marca
 * ni expulsa nada**. Un vendedor que hoy tenga cincuenta anuncios y un tope de
 * diez no pierde ni uno: simplemente no puede añadir el cincuenta y uno hasta
 * bajar del tope archivando o vendiendo. Aplicar el límite hacia atrás sobre lo
 * ya publicado sería castigar a alguien por una decisión posterior a sus actos.
 *
 * DÓNDE SE APLICA: SÓLO AL CREAR — ver `checkBeforeCreate`.
 *
 * `appliesTo` — SÓLO VENDEDOR, y por el mismo motivo que la cuota de activos: el
 * trabajo de moderación no puede quedar rehén del tope de un tercero (D3 del
 * diseño; el porqué completo está en `ActiveListingLimitRule`).
 *
 * GRUPO `entrada` — BARATA: un `count` con índice por `sellerId`, sin resolver
 * categorías. Va con la cuota, antes de que se pague nada caro.
 */
@Injectable()
export class TotalListingLimitRule implements ListingGateRule {
  readonly name = 'total-listing-limit';
  readonly group = 'entrada' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly proStatus: ProStatusService,
  ) {}

  /**
   * SÓLO acciones de vendedor. Y ninguna transición de las que ya pasan por la
   * puerta: este límite se comprueba EXCLUSIVAMENTE al crear (ver
   * `checkBeforeCreate`), así que para `publish`, `renew`, `bump`… no aplica.
   */
  appliesTo(context: GateContext): boolean {
    return context.actor === 'seller' && context.transition === 'create';
  }

  /** Sin fila, apagada. Mismo lector que `videoEnabled` y que la regla de atributos. */
  async isEnabled(): Promise<boolean> {
    const ajuste = await this.prisma.setting.findUnique({
      where: { key: TOTAL_LIMIT_RULE_ENABLED_SETTING },
      select: { value: true },
    });
    return ajuste?.value === true;
  }

  /**
   * POR QUÉ SÓLO AL CREAR, Y NO TAMBIÉN AL PUBLICAR. El tope limita cuántos
   * anuncios EXISTEN, y un `DRAFT` ya existe: cuenta desde el momento en que se
   * crea. Publicarlo no añade nada al total —el anuncio ya estaba dentro—, sólo
   * cambia su estado, así que frenar ahí cobraría dos veces por el mismo anuncio
   * y dejaría borradores imposibles de publicar sin motivo.
   *
   * Publicar sí lo frena la OTRA regla, la de activos, porque eso sí ocupa una
   * plaza de escaparate que antes no ocupaba. Cada límite cobra en el momento en
   * que se consume lo que limita.
   *
   * NO RECIBE UN ANUNCIO porque todavía no hay ninguno: es la única pregunta de
   * la puerta que se hace sobre algo que aún no existe.
   */
  async checkBeforeCreate(sellerId: string): Promise<GateReason | null> {
    const isPro = await this.proStatus.isProActive(sellerId);
    const settingKey = isPro ? PRO_TOTAL_LIMIT_SETTING : FREE_TOTAL_LIMIT_SETTING;
    const defaultLimit = isPro ? DEFAULT_PRO_TOTAL_LIMIT : DEFAULT_FREE_TOTAL_LIMIT;

    const setting = await this.prisma.setting.findUnique({ where: { key: settingKey } });
    const limit = setting ? Number(setting.value) : defaultLimit;

    const total = await this.prisma.listing.count({
      where: { sellerId, status: { in: ESTADOS_QUE_CUENTAN_AL_TOTAL } },
    });
    if (total < limit) return null;

    return {
      code: 'TOTAL_LIMIT_REACHED',
      // El mensaje DICE LA SALIDA. Un tope sin salida es un muro; con ella es una
      // tarea. Y la salida es real: archivar y vender sacan del recuento.
      message:
        `Has alcanzado el límite de ${limit} anuncios de tu plan. ` +
        'Archiva o marca como vendido alguno para poder crear otro.',
    };
  }
}
