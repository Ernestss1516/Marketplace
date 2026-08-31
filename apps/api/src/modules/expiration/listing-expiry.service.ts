import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LISTING_EXPIRY_SETTING, parseExpiryDays } from './listing-expiry';

/**
 * EL ÚNICO LECTOR del plazo de caducidad de un anuncio.
 *
 * Molde `PhotoLimitsService`: fichero puro con la clave y el defecto al lado, servicio fino que
 * lee el `Setting` y tolera la basura. Lo consumen los SIETE sitios que escriben
 * `Listing.expiresAt` —publicar, republicar desde borrador, renovar, reactivar, aprobar en
 * moderación, cambiar el estado desde el backoffice y reactivar al volver de una cuenta
 * archivada—, y todos tienen que usar el MISMO número o el plazo dependería de por qué puerta
 * entró el anuncio.
 *
 * ── POR QUÉ DEJÓ DE SER `static` ──────────────────────────────────────────────────────────
 *
 * Era `ExpirationService.expiresAt(from)`, un método estático, y por eso era imposible que
 * leyera nada: un estático no tiene inyección, así que el 60 tenía que estar clavado. **El
 * estático se ha eliminado, no se ha dejado como atajo.** Dejarlo habría sido dejar una puerta
 * por la que volver a la constante sin que ningún test se enterara — que es exactamente cómo
 * este ajuste llevaba muerto desde el MVP.
 *
 * ── POR QUÉ SU PROPIO MÓDULO ──────────────────────────────────────────────────────────────
 *
 * `ListingExpiryModule` es una HOJA (su única dependencia es `PrismaService`, que es global),
 * así que los cuatro módulos que lo necesitan —listings, moderación, admin y archivo de
 * cuentas— pueden importarlo sin riesgo de ciclo. Importar `ExpirationModule` entero sí lo
 * tendría: arrastra colas, auditoría y tres servicios de notificaciones.
 */
@Injectable()
export class ListingExpiryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Los días vigentes: la fila del ajuste, o `DEFAULT_EXPIRY_DAYS` si no hay o no vale. */
  async getDays(): Promise<number> {
    const ajuste = await this.prisma.setting.findUnique({
      where: { key: LISTING_EXPIRY_SETTING },
      select: { value: true },
    });
    return parseExpiryDays(ajuste?.value);
  }

  /**
   * La fecha de caducidad para un anuncio que se publica (o se renueva) en `from`.
   *
   * Se CONGELA en la fila: quien la llama la guarda en `Listing.expiresAt` y nadie la
   * recalcula después. Ver la nota de no-retroactividad en `listing-expiry.ts`.
   */
  async expiresAt(from: Date): Promise<Date> {
    const dias = await this.getDays();
    return new Date(from.getTime() + dias * 24 * 60 * 60 * 1000);
  }
}
