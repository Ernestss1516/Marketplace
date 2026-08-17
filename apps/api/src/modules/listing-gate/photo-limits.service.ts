import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  DEFAULT_MAX_PHOTOS,
  DEFAULT_MIN_PHOTOS,
  MAX_PHOTOS_SETTING,
  MIN_PHOTOS_RULE_ENABLED_SETTING,
  MIN_PHOTOS_SETTING,
} from './photo-limits';

/** Lo que la API publica para que el asistente no tenga que saberse los números. */
export interface PhotoLimitsConfig {
  max: number;
  min: number;
  /** Si el mínimo se está exigiendo de verdad ahora mismo. */
  minEnforced: boolean;
}

/**
 * EL ÚNICO LECTOR de los topes de fotos.
 *
 * Lo consumen tres sitios que tienen que decir el MISMO número o la interfaz
 * miente: la validación del alta/edición, la regla que frena al publicar, y el
 * asistente de publicación (que lo pide por `GET /listings/photo-limits` en vez
 * de llevar su propia copia — molde exacto de `GET /video/config`, que sirve
 * `enabled` junto a los límites precisamente para que editor y servidor no puedan
 * discrepar).
 *
 * TOLERANTE CON LA CONFIGURACIÓN ROTA, igual que
 * `TagsService.getMaxTagsPerListing`: un valor no numérico o absurdo cae al
 * defecto en vez de tumbar la publicación de todo el mundo. Un ajuste mal escrito
 * no puede ser un incidente.
 */
@Injectable()
export class PhotoLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMax(): Promise<number> {
    return this.leerNumero(MAX_PHOTOS_SETTING, DEFAULT_MAX_PHOTOS);
  }

  async getMin(): Promise<number> {
    return this.leerNumero(MIN_PHOTOS_SETTING, DEFAULT_MIN_PHOTOS);
  }

  /** Sin fila, APAGADO. Mismo molde que el resto de interruptores de la puerta. */
  async isMinEnforced(): Promise<boolean> {
    const ajuste = await this.prisma.setting.findUnique({
      where: { key: MIN_PHOTOS_RULE_ENABLED_SETTING },
      select: { value: true },
    });
    return ajuste?.value === true;
  }

  /** Lo que necesita el cliente, en una sola consulta de ida y vuelta. */
  async getConfig(): Promise<PhotoLimitsConfig> {
    const [max, min, minEnforced] = await Promise.all([
      this.getMax(),
      this.getMin(),
      this.isMinEnforced(),
    ]);
    return { max, min, minEnforced };
  }

  private async leerNumero(key: string, porDefecto: number): Promise<number> {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    const value = Number(setting?.value);
    return Number.isFinite(value) && value > 0 ? value : porDefecto;
  }
}
