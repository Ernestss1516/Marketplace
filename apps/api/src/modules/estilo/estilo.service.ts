import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RevalidateService } from '../../common/revalidate/revalidate.service';
import {
  avisosContraste,
  buscarModelo,
  ESTILO_CACHE_TAG,
  ESTILO_SETTING_KEY,
  ESTILO_ZONES,
  MODELO_POR_DEFECTO,
  MODELOS,
  resolverTokens,
  validarContraste,
  VERSION_POR_DEFECTO,
  type ColoresConfigurables,
  type EstiloZone,
  type Tokens,
} from './estilo.constants';
import { hexATriplete, parsearTriplete } from './color';

/** Lo que se guarda en `Setting.estiloConfig`. */
export interface EstiloConfig {
  modelo: string;
  version: string;
  colores: ColoresConfigurables;
}

/** Lo que sale por `GET /estilo`: el tema ya resuelto, listo para pintar. */
export interface EstiloResuelto {
  modelo: string;
  version: string;
  /** Los tokens de `:root`. */
  tokens: Tokens;
  /** Los ajustes por zona. En Modelo 0 las tres son idénticas a `:root`. */
  zonas: Record<EstiloZone, Tokens>;
  /** Contrastes por debajo de la norma que NO impiden guardar. Ver `avisosContraste`. */
  avisos: { pareja: string; ratio: number; minimo: number }[];
}

/**
 * E4a — EL SERVICIO DEL SISTEMA DE ESTILO. Molde literal de `BrandingService`.
 *
 * ── QUÉ HEREDA DEL MOLDE, Y POR QUÉ CADA COSA ─────────────────────────────────────
 *
 *  · **ES EL ÚNICO ESCRITOR** de `Setting.estiloConfig`, que está fuera del whitelist
 *    del PATCH genérico. Aquel endpoint aceptaría cualquier JSON, no validaría el
 *    contraste y no revalidaría nada — y aquí lo que se guarda repinta las 81
 *    pantallas.
 *  · **AJUSTE Y AUDITORÍA EN LA MISMA TRANSACCIÓN.** Cambiar el tema de una instancia
 *    es un acto administrativo con consecuencias en todas las pantallas: tiene que
 *    quedar quién y cuándo, o ninguna de las dos cosas.
 *  · **`revalidateTag` AL TERMINAR.** El tema se resuelve en el layout de servidor con
 *    `unstable_cache`; sin tumbar el tag, el cambio no se vería hasta que caducara.
 *  · **DEGRADA, NUNCA ROMPE.** Sin fila, `get()` devuelve el Modelo 0 con sus colores
 *    de fábrica, que es el estado legítimo de toda instancia recién desplegada. Nunca
 *    un 404 ni un 500 por falta de datos.
 *
 * ── LO QUE NO HEREDA ──────────────────────────────────────────────────────────────
 *
 * No hay `R2Service` ni `MediaCleanupService`: aquí no se sube ningún fichero. Las
 * ilustraciones, que sí son objetos del bucket, llegan en E7 y entonces este módulo
 * ganará esas dos dependencias — con la limpieza encolada del molde, no en línea.
 */
@Injectable()
export class EstiloService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly revalidateService: RevalidateService,
  ) {}

  // ── Lectura ────────────────────────────────────────────────────────────────

  /** El catálogo, para que la pantalla de admin sepa qué ofrecer. */
  catalogo() {
    return MODELOS.map((m) => ({
      id: m.id,
      nombre: m.nombre,
      descripcion: m.descripcion,
      versiones: m.versiones,
      coloresPorDefecto: m.coloresPorDefecto,
    }));
  }

  /**
   * La configuración guardada, o la de fábrica.
   *
   * VALIDA LO QUE LEE, y no es paranoia: la fila es `Json`, así que puede contener
   * cualquier cosa —una migración a medias, una edición manual en la base, un modelo
   * que se retiró del catálogo—. Si algo no cuadra se cae al Modelo 0 en vez de
   * propagar un tema roto a todas las pantallas.
   */
  async getConfig(): Promise<EstiloConfig> {
    const fila = await this.prisma.setting.findUnique({ where: { key: ESTILO_SETTING_KEY } });
    return this.normalizar(fila?.value);
  }

  /**
   * El tema RESUELTO. Es lo que consume el frontend: un mapa de variables listo para
   * escribirse, sin que el frontend sepa nada de modelos ni de derivaciones.
   *
   * LAS TRES ZONAS SALEN EN LA MISMA RESPUESTA, como los tres logos, y por el mismo
   * motivo: es una sola entrada de caché en el frontend en vez de tres. En Modelo 0
   * las tres son idénticas a `:root` —la diferenciación real por zona es E5—, y aun
   * así se emiten: así el frontend ya tiene su forma final y E5 sólo cambia valores.
   */
  async get(): Promise<EstiloResuelto> {
    const config = await this.getConfig();
    const modelo = buscarModelo(config.modelo) ?? MODELO_POR_DEFECTO;
    const tokens = resolverTokens(modelo, config.colores);

    const zonas = Object.fromEntries(
      ESTILO_ZONES.map((z) => [z, {} as Tokens]),
    ) as Record<EstiloZone, Tokens>;

    return {
      modelo: modelo.id,
      version: config.version,
      tokens,
      zonas,
      avisos: avisosContraste(tokens),
    };
  }

  // ── Escritura ──────────────────────────────────────────────────────────────

  /**
   * Guarda modelo + versión + los cuatro colores. **Valida el contraste ANTES de
   * escribir**: un tema inaccesible no llega a la base, así que no puede llegar a una
   * pantalla.
   *
   * EL 422 LLEVA LA LISTA DENTRO. Decirle al admin «no cumple» y callar qué pareja
   * falla y por cuánto es obligarle a probar combinaciones a ciegas entre cuatro
   * colores. Con la lista sabe que el problema es la letra sobre el principal y que
   * se queda en 3.1 cuando necesita 4.5.
   */
  async setConfig(
    entrada: { modelo: string; version: string; colores: Record<string, string> | { primary: string; secondary: string; accent: string; neutral: string } },
    actorId: string,
    ip?: string,
  ): Promise<EstiloResuelto> {
    const modelo = buscarModelo(entrada.modelo);
    if (!modelo) {
      throw new UnprocessableEntityException(
        `El modelo '${entrada.modelo}' no existe. Disponibles: ${MODELOS.map((m) => m.id).join(', ')}.`,
      );
    }
    if (!modelo.versiones.includes(entrada.version)) {
      throw new UnprocessableEntityException(
        `La versión '${entrada.version}' no existe en '${modelo.id}'. Disponibles: ${modelo.versiones.join(', ')}.`,
      );
    }

    const colores = this.normalizarColores(entrada.colores, modelo.coloresPorDefecto);
    const tokens = resolverTokens(modelo, colores);

    const fallos = validarContraste(tokens);
    if (fallos.length > 0) {
      throw new UnprocessableEntityException({
        message:
          'Esta combinación de colores no cumple el contraste mínimo de accesibilidad (AA).',
        fallos: fallos.map((f) => ({
          pareja: f.pareja,
          contrasteActual: f.ratio,
          contrasteMinimo: f.minimo,
        })),
      });
    }

    const anterior = await this.getConfig();
    const nueva: EstiloConfig = { modelo: modelo.id, version: entrada.version, colores };

    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: ESTILO_SETTING_KEY },
        // `upsert` y no `update`: la clave nace a propósito SIN fila (Modelo 0 es el
        // estado de fábrica), así que con `update` sería ineditable para siempre.
        create: {
          key: ESTILO_SETTING_KEY,
          value: nueva as unknown as Prisma.InputJsonValue,
          updatedById: actorId,
        },
        update: { value: nueva as unknown as Prisma.InputJsonValue, updatedById: actorId },
      });

      await this.auditLog.log(
        {
          action: 'ESTILO_CONFIG_UPDATE',
          actorId,
          resourceType: 'Setting',
          resourceId: ESTILO_SETTING_KEY,
          before: { value: anterior } as unknown as Prisma.InputJsonValue,
          after: { value: nueva } as unknown as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );
    });

    this.revalidateService.revalidateTag(ESTILO_CACHE_TAG);
    return this.get();
  }

  /**
   * Vuelve al Modelo 0 de fábrica borrando la fila.
   *
   * SE BORRA, no se guarda la config por defecto: «sin fila» es exactamente el estado
   * inicial de una instancia recién desplegada, y tener dos formas de decir lo mismo
   * sería una que alguien olvidaría comprobar. Idempotente, como `clearLogo`.
   */
  async reset(actorId: string, ip?: string): Promise<EstiloResuelto> {
    const anterior = await this.prisma.setting.findUnique({
      where: { key: ESTILO_SETTING_KEY },
    });
    if (!anterior) return this.get();

    await this.prisma.$transaction(async (tx) => {
      await tx.setting.deleteMany({ where: { key: ESTILO_SETTING_KEY } });
      await this.auditLog.log(
        {
          action: 'ESTILO_CONFIG_RESET',
          actorId,
          resourceType: 'Setting',
          resourceId: ESTILO_SETTING_KEY,
          before: { value: anterior.value } as unknown as Prisma.InputJsonValue,
          after: { value: null } as unknown as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );
    });

    this.revalidateService.revalidateTag(ESTILO_CACHE_TAG);
    return this.get();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private normalizar(value: Prisma.JsonValue | undefined): EstiloConfig {
    const porDefecto: EstiloConfig = {
      modelo: MODELO_POR_DEFECTO.id,
      version: VERSION_POR_DEFECTO,
      colores: MODELO_POR_DEFECTO.coloresPorDefecto,
    };
    if (!value || typeof value !== 'object' || Array.isArray(value)) return porDefecto;

    const v = value as Record<string, unknown>;
    const modelo = typeof v.modelo === 'string' ? buscarModelo(v.modelo) : undefined;
    if (!modelo) return porDefecto;

    const version =
      typeof v.version === 'string' && modelo.versiones.includes(v.version)
        ? v.version
        : modelo.versiones[0];

    const colores = this.normalizarColores(
      (v.colores ?? {}) as Record<string, string>,
      modelo.coloresPorDefecto,
    );

    return { modelo: modelo.id, version, colores };
  }

  /**
   * Acepta triplete HSL o hexadecimal y devuelve siempre triplete.
   *
   * EL HEXADECIMAL ES LO QUE LLEGA DEL SELECTOR DE COLOR de la pantalla de admin; el
   * triplete es lo que `globals.css` necesita. La conversión ocurre AQUÍ, una vez, al
   * guardar — nunca sobre un valor que ya estaba bien, que es lo que garantiza que el
   * Modelo 0 de fábrica no pase por ninguna aritmética.
   *
   * Un color ilegible cae al de fábrica de su ranura en vez de tumbar la operación:
   * el DTO ya rechaza la basura en la entrada, y esto es la red por si algo llega por
   * otra vía (una fila editada a mano en la base).
   */
  private normalizarColores(
    entrada: Record<string, string>,
    porDefecto: ColoresConfigurables,
  ): ColoresConfigurables {
    const uno = (v: unknown, fallback: string): string => {
      if (typeof v !== 'string') return fallback;
      if (parsearTriplete(v)) return v;
      return hexATriplete(v) ?? fallback;
    };
    return {
      primary: uno(entrada.primary, porDefecto.primary),
      secondary: uno(entrada.secondary, porDefecto.secondary),
      accent: uno(entrada.accent, porDefecto.accent),
      neutral: uno(entrada.neutral, porDefecto.neutral),
    };
  }
}
