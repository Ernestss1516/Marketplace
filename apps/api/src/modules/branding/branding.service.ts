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
  BRANDING_CACHE_TAG,
  LOGO_KEY_PREFIX,
  LOGO_MAX_BYTES,
  LOGO_MIME_ERROR,
  LOGO_MIME_TO_EXT,
  LOGO_SETTING_KEYS,
  LOGO_ZONES,
  type LogoZone,
} from './branding.constants';

/** Las tres URLs. `null` = esa zona no tiene logo configurado y el render cae a su fallback (L2). */
export interface BrandingLogos {
  public: string | null;
  backoffice: string | null;
  blog: string | null;
}

/**
 * `Setting.value` es `Json`: puede ser cualquier cosa. Sólo se acepta como logo una
 * cadena no vacía; todo lo demás es «sin configurar», que es un estado con render
 * definido. Un logo que no se puede pintar y una zona vacía son el mismo problema, y
 * aquí se resuelve una vez en vez de en cada cabecera.
 */
function urlOrNull(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * TRES LOGOS L1 — EL BACKEND DE LA MARCA POR ZONA.
 *
 * QUÉ RESUELVE. La marca de la plataforma era una constante de build (`SITE_NAME`) y la
 * del backoffice un texto escrito a mano. Con varias instancias del mismo código —una
 * por nicho— eso significa que las tres zonas son idénticas en todas y que entrar en el
 * backoffice no dice EN CUÁL estás. Aquí se guardan tres imágenes independientes, una
 * por zona, configurables por el admin de cada instancia.
 *
 * TRES `Setting` Y NO UNA TABLA: es exactamente su forma —clave global, un valor, quién
 * lo tocó y cuándo—, y como los tres logos son independientes (decisión de diseño: sin
 * logo base ni distintivo automático) no hay ninguna relación entre ellos que modelar.
 *
 * **ESTE SERVICIO ES EL ÚNICO ESCRITOR DE LAS TRES CLAVES**, y de ahí sale casi todo lo
 * que hace: subir el objeto, escribir el ajuste, limpiar el anterior y revalidar son
 * cuatro pasos de UNA operación. `PATCH /admin/settings/:key` haría sólo el segundo, y
 * por eso las claves no están en su whitelist (ver `branding.constants.ts`).
 *
 * Ver `docs/diseno-logos.md` §2, §3, §4 y §7.
 */
@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly auditLog: AuditLogService,
    private readonly revalidateService: RevalidateService,
    private readonly mediaCleanup: MediaCleanupService,
  ) {}

  // ── Lectura ────────────────────────────────────────────────────────────────

  /**
   * Las tres URLs de una vez, en UNA consulta.
   *
   * LAS TRES EN LA MISMA RESPUESTA, incluida la del backoffice, por dos razones: es una
   * sola entrada de caché en el frontend en vez de tres, y el logo del backoffice **no
   * es un secreto** — es un objeto público del bucket, y saber qué imagen usa el
   * backoffice de una instancia no revela nada que su propio dominio no diga ya.
   *
   * NUNCA 404 NI 500 POR FALTA DE DATOS: sin filas devuelve los tres a `null`, que es el
   * estado inicial legítimo de toda instancia recién desplegada. Misma doctrina de
   * «degrada, nunca rompe» que `DEFAULT_HOMEPAGE_CONFIG`.
   */
  async get(): Promise<BrandingLogos> {
    const filas = await this.prisma.setting.findMany({
      where: { key: { in: LOGO_ZONES.map((z) => LOGO_SETTING_KEYS[z]) } },
    });
    const porClave = new Map(filas.map((f) => [f.key, f.value]));

    return {
      public: urlOrNull(porClave.get(LOGO_SETTING_KEYS.public)),
      backoffice: urlOrNull(porClave.get(LOGO_SETTING_KEYS.backoffice)),
      blog: urlOrNull(porClave.get(LOGO_SETTING_KEYS.blog)),
    };
  }

  // ── Escritura ──────────────────────────────────────────────────────────────

  /**
   * Sube el logo de una zona y lo deja configurado.
   *
   * SUBIR **ES** GUARDAR, y por eso no hay prefijo temporal ni dos pasos. El avatar y el
   * vídeo nacen en `tmp/` porque se suben antes de que exista la fila que los referencia
   * y la pestaña puede cerrarse sin guardar (H2). Aquí un solo POST sube y escribe el
   * ajuste: no hay ninguna ventana en la que el objeto exista sin dueño, así que no hay
   * nada que caducar.
   *
   * EL ORDEN IMPORTA Y ES EL DEL MOLDE (`UsersService.updateMe`):
   *
   *  1. leer el valor anterior — la única consulta que la limpieza añade;
   *  2. subir el objeto nuevo;
   *  3. escribir el ajuste + la auditoría, en la MISMA transacción;
   *  4. limpiar el anterior **después** de escribir (si fuera antes, la propia fila
   *     seguiría conteniendo la URL vieja y se contaría a sí misma como «otro dueño»:
   *     no se borraría nunca nada);
   *  5. revalidar.
   */
  async setLogo(
    zoneRaw: string,
    file: Express.Multer.File,
    actorId: string,
    ip?: string,
  ): Promise<BrandingLogos> {
    const zone = this.assertZone(zoneRaw);

    const ext = LOGO_MIME_TO_EXT[file.mimetype];
    if (!ext) throw new UnprocessableEntityException(LOGO_MIME_ERROR);

    // El interceptor ya corta por tamaño (413 de multer) y esto no es redundancia
    // decorativa: el límite es una decisión del dominio —un logo se sirve en todas las
    // páginas— y no puede depender de que nadie mueva un `limits` en un decorador.
    if (file.buffer.byteLength > LOGO_MAX_BYTES) {
      throw new UnprocessableEntityException(
        `El logo no puede pasar de ${Math.round(LOGO_MAX_BYTES / 1024)} KB.`,
      );
    }

    const settingKey = LOGO_SETTING_KEYS[zone];
    const anterior = urlOrNull(
      (await this.prisma.setting.findUnique({ where: { key: settingKey } }))?.value,
    );

    const key = `${LOGO_KEY_PREFIX}/${randomBytes(16).toString('hex')}${ext}`;
    await this.r2.upload(key, file.buffer, file.mimetype);
    const url = this.r2.getPublicUrl(key);

    try {
      await this.escribir(settingKey, url, actorId, 'BRANDING_LOGO_UPDATE', anterior, ip);
    } catch (err) {
      // COMPENSACIÓN (molde H2, `UsersService.updateMe`): el objeto ya está en el bucket
      // y, si la fila no se escribe, nadie lo referenciará nunca. Se deshace. Es el
      // ÚNICO borrado en línea de este servicio, y va con `catch` porque no dejar
      // limpiar no puede convertir un error en dos.
      await this.r2.delete(key).catch(() => undefined);
      throw err;
    }

    await this.limpiar(zone, anterior, url);
    this.revalidateService.revalidateTag(BRANDING_CACHE_TAG);

    return this.get();
  }

  /**
   * Quita el logo de una zona: vuelve al fallback de esa zona (L2).
   *
   * SE BORRA LA FILA, no se guarda un `null`: «sin fila» es exactamente el estado
   * inicial de una instancia recién desplegada, y tener dos formas de decir «sin
   * configurar» sería una que alguien olvidaría comprobar.
   *
   * IDEMPOTENTE: sin fila no hay nada que soltar ni que auditar, así que devuelve el
   * estado tal cual en vez de un 404. Quitar dos veces un logo que ya no está no es un
   * error del que haya que informar.
   */
  async clearLogo(zoneRaw: string, actorId: string, ip?: string): Promise<BrandingLogos> {
    const zone = this.assertZone(zoneRaw);
    const settingKey = LOGO_SETTING_KEYS[zone];

    const anterior = urlOrNull(
      (await this.prisma.setting.findUnique({ where: { key: settingKey } }))?.value,
    );
    if (anterior === null) return this.get();

    await this.escribir(settingKey, null, actorId, 'BRANDING_LOGO_DELETE', anterior, ip);

    await this.limpiar(zone, anterior, null);
    this.revalidateService.revalidateTag(BRANDING_CACHE_TAG);

    return this.get();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * La zona, validada. Cualquier otra cosa es un 400 y no un 404: la ruta existe, lo que
   * no existe es esa zona de marca.
   */
  private assertZone(zone: string): LogoZone {
    if (!(LOGO_ZONES as readonly string[]).includes(zone)) {
      throw new BadRequestException(
        `Zona '${zone}' no válida. Zonas: ${LOGO_ZONES.join(', ')}.`,
      );
    }
    return zone as LogoZone;
  }

  /**
   * El ajuste y su auditoría, en UNA transacción — los dos o ninguno.
   *
   * `url: null` borra la fila. `upsert` y no `update` por el mismo motivo que en el
   * resto del repo: las tres claves nacen a propósito sin fila, y con `update` serían
   * ineditables para siempre.
   */
  private async escribir(
    settingKey: string,
    url: string | null,
    actorId: string,
    action: string,
    anterior: string | null,
    ip?: string,
  ): Promise<void> {
    // Mismo shape que el `AuditLog` de `SETTING_UPDATE` (admin.service.ts): estos
    // registros conviven en la misma tabla y con el mismo `resourceType`, así que quien
    // lea el historial de una clave no debería encontrarse dos formas del mismo dato.
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
   * LA FUGA DIRECTA (§4.1): el logo que se acaba de sustituir o quitar.
   *
   * Molde literal del avatar (`users.service.ts:104`) y del patrocinado: dos valores
   * enteros, el diff lo calcula `MediaCleanupService`. Se hereda todo lo suyo — encola
   * en vez de borrar en línea, y **no puede tumbar la operación**: un objeto que no se
   * llega a borrar es basura que nadie ve; un cambio de logo que se pierde porque el
   * bucket no respondía sería perder el trabajo de una persona.
   */
  private async limpiar(zone: LogoZone, antes: string | null, ahora: string | null) {
    await this.mediaCleanup.purgeReleased({
      before: { logoUrl: antes },
      after: { logoUrl: ahora },
      origen: `branding:${zone}`,
    });
  }
}
