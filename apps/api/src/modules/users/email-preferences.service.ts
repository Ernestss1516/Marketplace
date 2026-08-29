import { createHmac, timingSafeEqual } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  COLUMNA_POR_CATEGORIA,
  type EmailCategory,
} from '../../infra/queue/email-categories';

export const CATEGORIAS: EmailCategory[] = ['MESSAGES', 'LISTINGS', 'REVIEWS', 'ALERTS'];

export type EmailPreferences = Record<EmailCategory, boolean>;

/**
 * NOTIFICACIONES N5 — LAS PREFERENCIAS DE CORREO, Y LA BAJA.
 *
 * ── SÓLO GOBIERNAN LAS INFORMATIVAS ────────────────────────────────────────
 *
 * Aquí no hay una bandera para las sanciones, el borrado de cuenta, el cambio de
 * rol, lo que el staff hace con tus anuncios ni el dinero: **esas no se pueden
 * apagar**, y su camino de envío ni siquiera consulta nada (ver
 * `email-categories.ts`). Que el interruptor no exista es parte de la garantía.
 *
 * ── LA BAJA VA POR HMAC, SIN GUARDAR NINGÚN TOKEN ──────────────────────────
 *
 * El enlace del pie del correo tiene que funcionar **sin sesión** —quien se da de
 * baja normalmente no va a iniciarla— y sin convertirse en un oráculo. Se firma
 * `userId:categoría` con el secreto del servidor:
 *
 *   · no hay tabla de tokens que mantener, caducar ni limpiar;
 *   · no se puede forjar sin el secreto, así que nadie da de baja a otro;
 *   · es idempotente: pulsar dos veces deja lo mismo.
 *
 * NO CADUCA a propósito: un enlace de baja que caduca es un enlace de baja roto, y
 * lo único que permite es dejar de recibir correo — el daño de un enlace viejo que
 * siga funcionando es exactamente cero.
 */
@Injectable()
export class EmailPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async get(userId: string): Promise<EmailPreferences> {
    const usuario = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { emailMessages: true, emailListings: true, emailReviews: true, emailAlerts: true },
    });
    return {
      MESSAGES: usuario.emailMessages,
      LISTINGS: usuario.emailListings,
      REVIEWS: usuario.emailReviews,
      ALERTS: usuario.emailAlerts,
    };
  }

  /** Actualiza sólo las categorías que vengan. Lo ausente no se toca. */
  async update(userId: string, cambios: Partial<EmailPreferences>): Promise<EmailPreferences> {
    const data: Record<string, boolean> = {};
    for (const categoria of CATEGORIAS) {
      const valor = cambios[categoria];
      if (typeof valor === 'boolean') data[COLUMNA_POR_CATEGORIA[categoria]] = valor;
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({ where: { id: userId }, data });
    }
    return this.get(userId);
  }

  /** La firma que viaja en el enlace del pie del correo. */
  firmar(userId: string, categoria: EmailCategory): string {
    return createHmac('sha256', this.config.getOrThrow<string>('jwt.secret'))
      .update(`${userId}:${categoria}`)
      .digest('hex');
  }

  /**
   * Da de baja UNA categoría desde el enlace del correo, sin sesión.
   *
   * La comparación es en TIEMPO CONSTANTE: comparar firmas con `===` filtra por
   * cuánto tardan en diferir. Aquí el riesgo real es bajo, pero es el molde correcto
   * y no cuesta nada.
   */
  async bajaConFirma(
    userId: string,
    categoria: EmailCategory,
    firma: string,
  ): Promise<{ categoria: EmailCategory }> {
    if (!CATEGORIAS.includes(categoria)) {
      throw new BadRequestException('Categoría desconocida');
    }

    const esperada = Buffer.from(this.firmar(userId, categoria));
    const recibida = Buffer.from(firma ?? '');
    if (
      esperada.length !== recibida.length ||
      !timingSafeEqual(new Uint8Array(esperada), new Uint8Array(recibida))
    ) {
      throw new BadRequestException('Enlace de baja no válido');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { [COLUMNA_POR_CATEGORIA[categoria]]: false },
    });
    return { categoria };
  }
}
