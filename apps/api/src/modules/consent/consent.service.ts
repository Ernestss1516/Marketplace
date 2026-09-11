import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConsentAction } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * COOKIES RÁFAGA 1 — EL REGISTRO DEL CONSENTIMIENTO (la prueba, RGPD art. 7.1).
 *
 * Ver docs/diseno-consentimiento-cookies.md §2.
 *
 * ─── LA MITAD QUE ESTE SERVICIO **NO** HACE ──────────────────────────────────────
 *
 * No decide qué se carga. Eso lo hace el gate del navegador leyendo la cookie, sin
 * preguntar a nadie: meter una llamada a la API antes de pintar un vídeo añadiría
 * latencia al camino caliente de una plataforma read-heavy. Este servicio existe sólo
 * para poder DEMOSTRAR el consentimiento, que es una obligación distinta.
 *
 * De ahí sale la propiedad más importante del diseño: **si esto falla, no pasa nada
 * visible**. El frontend escribe su cookie igualmente y respeta la voluntad del usuario
 * aunque la fila no llegue a escribirse (ver `consent.controller.ts`).
 *
 * ─── UNA FILA POR DECISIÓN, NUNCA UN UPDATE ──────────────────────────────────────
 *
 * El historial ES la prueba. Un `upsert` que machacara la fila anterior destruiría
 * exactamente lo que hay que demostrar: que en tal fecha, con tal texto delante, esta
 * persona dijo que sí (o que no).
 */
@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra una decisión y devuelve el id, que el navegador guarda dentro de su cookie.
   * Ese id es lo único que une las dos mitades: no hace falta ningún identificador nuevo
   * ni ninguna huella.
   *
   * `ip` llega en crudo y se hashea AQUÍ, en el borde: así ningún llamador puede
   * quedarse con la tentación de guardarla entera. Molde del repo —`visitor.ts:53`,
   * `listings.controller.ts:314`—: la IP en claro no se guarda para esto.
   */
  async record(input: {
    action: ConsentAction;
    categories: string[];
    policyVersion: string;
    userId: string | null;
    ip?: string;
  }): Promise<{ id: string }> {
    const row = await this.prisma.consentRecord.create({
      data: {
        action: input.action,
        categories: input.categories,
        policyVersion: input.policyVersion,
        userId: input.userId,
        ipHash: ConsentService.hashIp(input.ip),
      },
      select: { id: true },
    });

    this.logger.log(
      `Consentimiento ${input.action} registrado (${row.id}) — categorías: ` +
        `${input.categories.length > 0 ? input.categories.join(', ') : 'ninguna'}, ` +
        `versión ${input.policyVersion}`,
    );

    return row;
  }

  /**
   * `sha256(ip)`, o `null` si no hay IP.
   *
   * NO lleva sal ni pimienta, y es una decisión con su motivo: el espacio de las IPv4 es
   * pequeño y un hash sin sal es reversible por fuerza bruta, así que esto **no es
   * anonimización**, es reducción de exposición — que es justo lo que hace falta aquí.
   * Una sal fija tampoco lo arreglaría (vive en el mismo despliegue que la tabla), y una
   * rotatoria rompería la única propiedad útil que tiene el campo: poder comparar dos
   * registros del mismo origen. Se documenta así para que nadie lo confunda con un dato
   * anónimo en la política de privacidad.
   */
  private static hashIp(ip?: string): string | null {
    const limpia = ip?.trim();
    if (!limpia) return null;
    return createHash('sha256').update(limpia).digest('hex');
  }
}
