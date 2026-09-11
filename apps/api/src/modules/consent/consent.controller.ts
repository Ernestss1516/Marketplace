import { Body, Controller, HttpCode, HttpStatus, Ip, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { RateLimitService } from '../../infra/redis/rate-limit.service';
import { ConsentService } from './consent.service';
import { RecordConsentDto } from './dto/record-consent.dto';
import { LinkConsentDto } from './dto/link-consent.dto';
import {
  CONSENT_RATE_LIMIT,
  CONSENT_RATE_LIMIT_WINDOW_SECONDS,
} from './consent.constants';

/**
 * COOKIES RÁFAGA 1 — el único endpoint del consentimiento.
 *
 * ─── PÚBLICO CON AUTH OPCIONAL, y es el molde exacto de `trackView` ──────────────
 *
 * (`listings.controller.ts:302-307`: «público con auth opcional: cuenta anónimos, pero
 * necesita saber si hay sesión»). Aquí la frase vale igual: el consentimiento se da casi
 * siempre ANTES de iniciar sesión —es lo primero que pasa en la primera visita—, pero si
 * hay sesión hay que anotar de quién es la decisión.
 *
 * ─── NO HAY `GET`, Y ES DELIBERADO ──────────────────────────────────────────────
 *
 * El estado vive en la cookie del navegador, que es quien decide. Un `GET /consent/:id`
 * sería una vía para preguntar por el consentimiento de un id ajeno: una fuga sin
 * ninguna contrapartida, porque nadie necesita leer esta tabla desde el navegador.
 *
 * ─── 201 CON EL ID, Y NADA MÁS ──────────────────────────────────────────────────
 *
 * El id vuelve para que el navegador lo guarde dentro de su cookie y las dos mitades
 * queden unidas. No se devuelve la fila entera: el cliente no tiene nada que hacer con
 * ella, y el `ipHash` no debe salir de aquí.
 */
@ApiTags('Consent')
@Controller('consent')
export class ConsentController {
  constructor(
    private readonly consentService: ConsentService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async record(
    @Body() dto: RecordConsentDto,
    @CurrentUser() user: JwtUser | null,
    @Ip() ip: string,
  ): Promise<{ id: string | null }> {
    /**
     * RATE LIMIT — endpoint público que ESCRIBE filas: sin límite es un generador de
     * filas gratis. Molde del repo (`RateLimitService`, extraído del formulario de
     * contacto). La IP real llega bien gracias al `trust proxy` de `main.ts:29-30`.
     *
     * AL PASARSE NO SE DEVUELVE UN 429: se devuelve `{id: null}`, un éxito sin prueba.
     * Suena raro y es lo correcto — un 429 aquí le diría al navegador «tu decisión ha
     * fallado» cuando la decisión es suya y ya está tomada. El registro es nuestra
     * obligación probatoria, no un permiso que le concedemos al usuario. Misma doctrina
     * que el fail-open de abajo, aplicada al caso del abuso.
     */
    const { limited } = await this.rateLimit.checkAndIncrement(
      `consent:rl:${ip}`,
      CONSENT_RATE_LIMIT,
      CONSENT_RATE_LIMIT_WINDOW_SECONDS,
    );
    if (limited) return { id: null };

    return this.consentService.record({
      action: dto.action,
      categories: dto.categories,
      policyVersion: dto.policyVersion,
      userId: user?.userId ?? null,
      ip,
    });
  }

  /**
   * RÁFAGA 2 — ata la decisión que se tomó estando anónimo a la cuenta que acaba de
   * entrar. Ver `ConsentService.vincularConUsuario`.
   *
   * AQUÍ SÍ HACE FALTA SESIÓN (`JwtAuthGuard`, no el opcional): el único efecto de esta
   * llamada es escribir a QUIÉN pertenece una decisión, así que sin cuenta no hay nada
   * que hacer. Y el `userId` sale del token, nunca del cuerpo — si viniera del cliente,
   * cualquiera podría atribuirle un consentimiento a otra persona.
   *
   * Devuelve `{id: null}` cuando no hacía falta vincular nada (ya estaba, o el id no
   * existe). No es un error: el navegador lo llama en cada carga con sesión y la mayoría
   * de las veces no hay trabajo.
   */
  @Post('vincular')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  vincular(
    @Body() dto: LinkConsentDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<{ id: string | null }> {
    return this.consentService.vincularConUsuario({
      consentRecordId: dto.consentRecordId,
      userId: user.userId,
      ip,
    });
  }
}
