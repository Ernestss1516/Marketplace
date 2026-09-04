import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { R2Service } from '../../infra/r2/r2.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RevalidateService } from '../../common/revalidate/revalidate.service';
import { MediaCleanupService } from '../media-cleanup/media-cleanup.service';
import {
  ILUSTRACIONES_CACHE_TAG,
  ILUSTRACION_IDS,
  ILUSTRACION_KEY_PREFIX,
  ILUSTRACION_MAX_BYTES,
  ILUSTRACION_MIME_ERROR,
  ILUSTRACION_MIME_TO_EXT,
  ILUSTRACION_SETTING_KEYS,
  ILUSTRACION_SLOTS,
  buscarSlot,
  type SlotIlustracion,
} from './ilustraciones.constants';
import {
  ESTILO_SETTING_KEY,
  MODELO_POR_DEFECTO,
  buscarModelo,
  type Modelo,
} from '../estilo/estilo.constants';

/** Lo que el frontend necesita para pintar un slot, ya resuelto. */
export interface IlustracionResuelta {
  url: string;
  alt: string;
  ancho: number;
  alto: number;
  /** `true` si la sirve el default del modelo; `false` si el admin la sustituyó. */
  esDefecto: boolean;
}

export type IlustracionesResueltas = Record<string, IlustracionResuelta>;

/**
 * `Setting.value` es `Json`: puede contener cualquier cosa. Sólo cuenta como sustitución
 * una cadena no vacía; todo lo demás es «sin sustituir», que NO es un estado degradado
 * sino el normal — se sirve el default del modelo. Misma normalización que `urlOrNull`
 * en `BrandingService`, y por el mismo motivo: resolverlo una vez aquí en vez de en cada
 * pantalla.
 */
function urlOrNull(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * El modelo activo, leído de la fila de estilo y con la misma tolerancia que
 * `EstiloService.normalizar`: la fila es `Json` y puede contener cualquier cosa —una
 * migración a medias, un modelo retirado del catálogo—, y ante cualquiera de esas la
 * respuesta correcta es el Modelo 0, no un fallo.
 */
function modeloActivo(value: Prisma.JsonValue | undefined): Modelo {
  const id =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).modelo
      : undefined;
  return (typeof id === 'string' ? buscarModelo(id) : undefined) ?? MODELO_POR_DEFECTO;
}

/**
 * E7 — EL SUBSISTEMA DE ILUSTRACIONES.
 *
 * ── ES `BrandingService` CALCADO, Y ESO ES LO QUE SE PEDÍA (§8.3) ────────────────────
 *
 * Clave aleatoria en el bucket, subida = guardado en un solo POST, ajuste y `AuditLog` en
 * la misma transacción con compensación si la fila no se escribe, limpieza del anterior
 * ENCOLADA —nunca en línea, nunca puede tumbar la operación— y `revalidateTag` al
 * terminar. Cada una de esas decisiones tiene su porqué escrito en `branding.service.ts`
 * y aquí se hereda entero en vez de reargumentarse.
 *
 * ── LA ÚNICA DIFERENCIA DE FONDO CON LOS LOGOS ──────────────────────────────────────
 *
 * Un logo sin configurar deja la zona en su respaldo (texto). **Una ilustración sin
 * configurar NO deja hueco**: cae al default del modelo, que viaja con el código. Por eso
 * `get()` no puede devolver `null` en ningún slot — y por eso el tipo de retorno no
 * admite `null`. Un hueco sería el único fallo de verdad de este subsistema, y aquí es
 * inexpresable.
 */
@Injectable()
export class IlustracionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly auditLog: AuditLogService,
    private readonly revalidateService: RevalidateService,
    private readonly mediaCleanup: MediaCleanupService,
  ) {}

  // ── Lectura ────────────────────────────────────────────────────────────────

  /**
   * Los diez slots resueltos, en UNA consulta.
   *
   * TODOS EN LA MISMA RESPUESTA, como los tres logos y por el mismo motivo: es una sola
   * entrada de caché en el frontend en vez de diez, y ninguna es un secreto — son objetos
   * públicos del bucket.
   *
   * NUNCA 404 NI 500 POR FALTA DE DATOS: sin ninguna fila devuelve los diez defaults, que
   * es el estado de toda instancia recién desplegada.
   */
  async get(): Promise<IlustracionesResueltas> {
    const [filas, filaEstilo] = await Promise.all([
      this.prisma.setting.findMany({
        where: { key: { in: Object.values(ILUSTRACION_SETTING_KEYS) } },
      }),
      // El modelo activo, para saber qué ilustraciones trae. Se lee la fila directamente
      // en vez de inyectar `EstiloService`: lo único que hace falta de él es el id del
      // modelo, y depender del módulo entero por eso ataría dos subsistemas que no se
      // necesitan. Si la fila no existe o no cuadra, manda el Modelo 0 — que es lo que
      // `EstiloService` hace con esa misma fila.
      this.prisma.setting.findUnique({ where: { key: ESTILO_SETTING_KEY } }),
    ]);
    const porClave = new Map(filas.map((f) => [f.key, f.value]));
    const modelo = modeloActivo(filaEstilo?.value);

    const salida: IlustracionesResueltas = {};
    for (const slot of ILUSTRACION_SLOTS) {
      const sustituida = urlOrNull(porClave.get(ILUSTRACION_SETTING_KEYS[slot.id]));
      /**
       * ⚠ LA CADENA QUE HACE QUE «NUNCA UN HUECO» SEA ESTRUCTURAL Y NO DISCIPLINA:
       *
       *     sustitución del admin  →  la del MODELO activo  →  la del REGISTRO
       *
       * El registro cierra la cadena y por eso no puede faltar (hay un test que lo exige
       * slot a slot, y otro que comprueba que el fichero existe). Un modelo futuro puede
       * declarar tres ilustraciones y olvidarse de siete: las siete siguen teniendo
       * imagen. Es la misma forma de «degrada, nunca rompe» que usa `BrandingService`,
       * con un eslabón más.
       */
      const delModelo = urlOrNull(modelo.ilustraciones[slot.id] as never);
      salida[slot.id] = {
        url: sustituida ?? delModelo ?? slot.defecto,
        alt: slot.alt,
        ancho: slot.proporcion.ancho,
        alto: slot.proporcion.alto,
        esDefecto: sustituida === null,
      };
    }
    return salida;
  }

  /** El catálogo, para que la pantalla de admin sepa qué ofrecer y con qué descripción. */
  catalogo(): readonly SlotIlustracion[] {
    return ILUSTRACION_SLOTS;
  }

  // ── Escritura ──────────────────────────────────────────────────────────────

  /**
   * Sustituye la ilustración de un slot.
   *
   * EL ORDEN ES EL DEL MOLDE (`BrandingService.setLogo`, que a su vez lo toma de
   * `UsersService.updateMe`):
   *
   *  1. leer el valor anterior — la única consulta que la limpieza añade;
   *  2. subir el objeto nuevo;
   *  3. escribir el ajuste + la auditoría, en la MISMA transacción;
   *  4. limpiar el anterior DESPUÉS de escribir (si fuera antes, la propia fila seguiría
   *     conteniendo la URL vieja y se contaría a sí misma como «otro dueño»: no se
   *     borraría nunca nada);
   *  5. revalidar.
   */
  async setIlustracion(
    slotRaw: string,
    file: Express.Multer.File,
    actorId: string,
    ip?: string,
  ): Promise<IlustracionesResueltas> {
    const slot = this.assertSlot(slotRaw);

    const ext = ILUSTRACION_MIME_TO_EXT[file.mimetype];
    if (!ext) throw new UnprocessableEntityException(ILUSTRACION_MIME_ERROR);

    // El interceptor ya corta por tamaño (413 de multer) y esto no es redundancia
    // decorativa: el límite es una decisión del dominio y no puede depender de que nadie
    // mueva un `limits` en un decorador. Mismo argumento que en los logos.
    if (file.buffer.byteLength > ILUSTRACION_MAX_BYTES) {
      throw new UnprocessableEntityException(
        `La ilustración no puede pasar de ${Math.round(ILUSTRACION_MAX_BYTES / (1024 * 1024))} MB.`,
      );
    }

    const settingKey = ILUSTRACION_SETTING_KEYS[slot.id];
    const anterior = urlOrNull(
      (await this.prisma.setting.findUnique({ where: { key: settingKey } }))?.value,
    );

    const key = `${ILUSTRACION_KEY_PREFIX}/${randomBytes(16).toString('hex')}${ext}`;
    await this.r2.upload(key, file.buffer, file.mimetype);
    const url = this.r2.getPublicUrl(key);

    try {
      await this.escribir(settingKey, url, actorId, 'ILUSTRACION_UPDATE', anterior, ip);
    } catch (err) {
      // COMPENSACIÓN: el objeto ya está en el bucket y, si la fila no se escribe, nadie
      // lo referenciará nunca. Es el ÚNICO borrado en línea de este servicio, y va con
      // `catch` porque no poder limpiar no puede convertir un error en dos.
      await this.r2.delete(key).catch(() => undefined);
      throw err;
    }

    await this.limpiar(slot.id, anterior, url);
    this.revalidateService.revalidateTag(ILUSTRACIONES_CACHE_TAG);

    return this.get();
  }

  /**
   * Quita la sustitución: el slot vuelve al default del modelo.
   *
   * SE BORRA LA FILA, no se guarda un `null`: «sin fila» es el estado inicial de toda
   * instancia, y tener dos formas de decir «sin sustituir» sería una que alguien olvidaría
   * comprobar.
   *
   * IDEMPOTENTE: sin fila no hay nada que soltar ni que auditar, así que devuelve el
   * estado tal cual en vez de un 404.
   */
  async clearIlustracion(
    slotRaw: string,
    actorId: string,
    ip?: string,
  ): Promise<IlustracionesResueltas> {
    const slot = this.assertSlot(slotRaw);
    const settingKey = ILUSTRACION_SETTING_KEYS[slot.id];

    const anterior = urlOrNull(
      (await this.prisma.setting.findUnique({ where: { key: settingKey } }))?.value,
    );
    if (anterior === null) return this.get();

    await this.escribir(settingKey, null, actorId, 'ILUSTRACION_DELETE', anterior, ip);

    await this.limpiar(slot.id, anterior, null);
    this.revalidateService.revalidateTag(ILUSTRACIONES_CACHE_TAG);

    return this.get();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * El slot, validado contra el registro. Cualquier otro es un 400 y no un 404: la ruta
   * existe; lo que no existe es ese slot. Molde de `assertZone`.
   */
  private assertSlot(id: string): SlotIlustracion {
    const slot = buscarSlot(id);
    if (!slot) {
      throw new BadRequestException(
        `Slot '${id}' no válido. Slots: ${ILUSTRACION_IDS.join(', ')}.`,
      );
    }
    return slot;
  }

  /**
   * El ajuste y su auditoría, en UNA transacción — los dos o ninguno.
   *
   * `url: null` borra la fila. `upsert` y no `update` por el mismo motivo que en el resto
   * del repo: estas claves nacen a propósito sin fila, y con `update` serían ineditables
   * para siempre.
   */
  private async escribir(
    settingKey: string,
    url: string | null,
    actorId: string,
    action: string,
    anterior: string | null,
    ip?: string,
  ): Promise<void> {
    // Mismo shape que el `AuditLog` de `SETTING_UPDATE` y el de los logos: estos registros
    // conviven en la misma tabla con el mismo `resourceType`, y quien lea el historial de
    // una clave no debería encontrarse dos formas del mismo dato.
    const before = { value: anterior } as unknown as Prisma.InputJsonValue;
    const after = { value: url } as unknown as Prisma.InputJsonValue;

    await this.prisma.$transaction(async (tx) => {
      if (url === null) {
        // `deleteMany` y no `delete`: sin fila, `delete` lanzaría un P2025 en una
        // operación que ya sabemos que no tiene nada que borrar.
        await tx.setting.deleteMany({ where: { key: settingKey } });
      } else {
        await tx.setting.upsert({
          where: { key: settingKey },
          create: { key: settingKey, value: url, updatedById: actorId },
          update: { value: url, updatedById: actorId },
        });
      }

      await this.auditLog.log(
        { action, actorId, resourceType: 'Setting', resourceId: settingKey, before, after, ip },
        tx,
      );
    });
  }

  /**
   * La fuga directa: la ilustración que se acaba de sustituir o quitar.
   *
   * Molde literal del logo, del avatar y del patrocinado — dos valores enteros, el diff lo
   * calcula `MediaCleanupService`. Se hereda todo lo suyo: ENCOLA en vez de borrar en
   * línea, y **no puede tumbar la operación**. Un objeto que no se llega a borrar es
   * basura que nadie ve; una sustitución que se pierde porque el bucket no respondía sería
   * perder el trabajo de una persona.
   */
  private async limpiar(slotId: string, antes: string | null, ahora: string | null) {
    await this.mediaCleanup.purgeReleased({
      before: { ilustracionUrl: antes },
      after: { ilustracionUrl: ahora },
      origen: `ilustracion:${slotId}`,
    });
  }
}
