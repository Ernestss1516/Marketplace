import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import type { GateContext, GateListing, GateReason, ListingGateRule } from '../listing-gate.types';

/** Sin fila, APAGADA. Mismo molde que `videoEnabled` y que las otras dos reglas nuevas. */
export const EMAIL_VERIFIED_RULE_ENABLED_SETTING = 'emailVerifiedToPublishEnabled';

/**
 * El código del motivo. Lo EXPORTA la regla porque no es sólo suyo: `publish` lo
 * reconoce para degradar en vez de rechazar (ver `ListingsService.publish`). Es la
 * única pieza de acoplamiento entre los dos, y por eso es una constante y no un
 * literal repetido en dos ficheros.
 */
export const EMAIL_NOT_VERIFIED_CODE = 'EMAIL_NOT_VERIFIED';

/**
 * REGLA NUEVA #2 — CORREO VERIFICADO PARA PUBLICAR.
 *
 * QUÉ EXIGE, Y CUÁNDO. Que el vendedor tenga el correo verificado para que su
 * anuncio llegue al mercado. `User.emailVerified` existe desde el principio pero
 * hoy NO ES PUERTA EN NINGÚN SITIO —el mapa lo confirmó: no hay ningún
 * `EmailVerifiedGuard`—; lo único que hace es cambiar lo que se ve en el perfil y
 * bloquear el formulario de contacto en el frontend. Esta regla lo convierte en
 * condición de PUBLICACIÓN.
 *
 * SÓLO AL PUBLICAR, y esto no es una restricción menor: crear y redactar siguen
 * siendo libres. Alguien que se acaba de registrar puede escribir su anuncio
 * entero, subir las fotos y guardarlo; lo único que no puede es sacarlo al
 * mercado. Exigir el correo para CREAR convertiría la verificación en un peaje
 * antes de que el usuario haya visto siquiera si el producto le sirve.
 *
 * NO RECHAZA: DEGRADA. Cuando se aplica, el anuncio SE QUEDA EN DRAFT tal y como
 * estaba —ni un campo tocado, ni `publishedAt` escrito— y el vendedor recibe un
 * aviso con la salida. Esa parte no vive aquí sino en `ListingsService.publish`,
 * y el porqué está explicado allí: la puerta sigue siendo binaria (pasa o no
 * pasa) y es el camino quien decide que ESTE «no pasa» concreto no es un error
 * sino un «todavía no».
 *
 * `appliesTo` — VENDEDOR y SÓLO `publish`. Es lo que hace segura la degradación:
 * el motivo `EMAIL_NOT_VERIFIED` no puede aparecer en ningún otro camino, así que
 * ningún otro camino necesita saber interpretarlo. Renovar, reactivar o aprobar
 * NO lo miran — un anuncio que ya estuvo en el mercado no se retira porque su
 * dueño no haya verificado el correo, y el trabajo de moderación no depende de
 * ello. Hay un test unitario que fija esta lista precisamente porque ampliarla
 * rompería la seguridad de la degradación.
 *
 * GRUPO `entrada` — BARATA: una consulta de una columna por id de usuario.
 *
 * NACE APAGADA. M2 la señaló como la de más impacto potencial —es la única que
 * depende de algo que el vendedor puede no haber hecho nunca— así que se enciende
 * con el número de `pnpm gate-impact-report` delante.
 */
@Injectable()
export class EmailVerifiedRule implements ListingGateRule {
  readonly name = 'email-verified';
  readonly group = 'entrada' as const;

  constructor(private readonly prisma: PrismaService) {}

  appliesTo(context: GateContext): boolean {
    return context.actor === 'seller' && context.transition === 'publish';
  }

  async isEnabled(): Promise<boolean> {
    const ajuste = await this.prisma.setting.findUnique({
      where: { key: EMAIL_VERIFIED_RULE_ENABLED_SETTING },
      select: { value: true },
    });
    return ajuste?.value === true;
  }

  async check(listing: GateListing): Promise<GateReason | null> {
    const seller = await this.prisma.user.findUnique({
      where: { id: listing.sellerId },
      select: { emailVerified: true },
    });
    // Un vendedor que no existe no es asunto de esta regla: el anuncio no podría
    // ni haberse cargado. Se deja pasar en vez de inventar un motivo.
    if (!seller || seller.emailVerified) return null;

    return {
      code: EMAIL_NOT_VERIFIED_CODE,
      // El mensaje DICE LA SALIDA y dice qué ha pasado con el anuncio, que es lo
      // que de verdad preocupa a quien acaba de darle a publicar.
      message:
        'Verifica tu correo para publicar. El anuncio se ha guardado como borrador ' +
        'y podrás publicarlo en cuanto lo verifiques.',
    };
  }
}
