import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RevalidateService } from '../../common/revalidate/revalidate.service';
import {
  COOKIES_CONFIG_CACHE_TAG,
  COOKIE_TEXT_DEFAULTS,
  COOKIE_TEXT_MAX_LENGTH,
  COOKIE_TEXT_SETTING_KEYS,
  REJECT_LABEL_FORBIDDEN,
  type CookieTextField,
} from './consent.constants';

/** El texto del banner, ya resuelto. Nunca lleva `null`: sin fila vale el defecto. */
export type CookieTextConfig = Record<CookieTextField, string>;

const CAMPOS = Object.keys(COOKIE_TEXT_SETTING_KEYS) as CookieTextField[];

/**
 * COOKIES RÁFAGA 2 — EL TEXTO DEL BANNER, POR INSTANCIA.
 *
 * Ver docs/diseno-consentimiento-cookies.md §4.
 *
 * ─── LA FRONTERA, QUE ES LO ÚNICO DELICADO DE ESTE FICHERO ──────────────────────
 *
 * El admin edita el TEXTO y el enlace. No edita la mecánica: qué se bloquea, cuántas
 * opciones tiene el banner, si el banner aparece, o qué categorías existen. Eso es
 * legal y es fijo. Aquí la frontera no se defiende con una nota en la pantalla, se
 * defiende con el modelo: **las únicas claves que este servicio conoce son las siete de
 * `COOKIE_TEXT_SETTING_KEYS`**, y ninguna de ellas puede apagar nada.
 *
 * ─── SIN FILAS, EL BANNER SIGUE SALIENDO ────────────────────────────────────────
 *
 * `get()` no devuelve `null` jamás: cada campo cae a su defecto en código. Una
 * instancia recién desplegada, o una a la que le falte una fila, enseña un banner
 * correcto en español. Un banner que desaparece porque falta un ajuste sería un
 * incumplimiento causado por un descuido de despliegue — y este repo ya tiene la
 * cicatriz de un interruptor que existía en el whitelist y no en la semilla
 * (`videoEnabled`, docs/auditoria-pro-video.md §2.0).
 */
@Injectable()
export class ConsentConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly revalidateService: RevalidateService,
  ) {}

  /**
   * El texto vigente. UNA consulta para las siete claves.
   *
   * Lo consume el endpoint público (lo lee el layout del sitio en cada render cacheado)
   * y también la pantalla de admin, que necesita ver exactamente lo que ve el visitante.
   */
  async get(): Promise<CookieTextConfig> {
    const filas = await this.prisma.setting.findMany({
      where: { key: { in: CAMPOS.map((c) => COOKIE_TEXT_SETTING_KEYS[c]) } },
    });
    const porClave = new Map(filas.map((f) => [f.key, f.value]));

    const salida = {} as CookieTextConfig;
    for (const campo of CAMPOS) {
      salida[campo] = ConsentConfigService.textoODefecto(
        porClave.get(COOKIE_TEXT_SETTING_KEYS[campo]),
        COOKIE_TEXT_DEFAULTS[campo],
      );
    }

    salida.policyUrl = await this.policyUrlServible(salida.policyUrl);
    return salida;
  }

  /**
   * RÁFAGA 3 — EL BANNER LEGAL NUNCA ENLAZA A UN 404.
   *
   * La política de cookies vive en el CMS y nace EN BORRADOR, esperando el texto de
   * asesoría. Entre que el admin apunta aquí su ruta y el día que la publica pueden pasar
   * semanas, y durante todas ellas el botón «Más información» del banner llevaría a una
   * página que no existe — desde el aviso legal, que es el peor sitio posible para un
   * enlace roto.
   *
   * Así que la URL sólo se sirve si apunta a una página del CMS **publicada**. Si no,
   * vuelve vacía y el banner despliega su detalle en línea (el respaldo de la ráfaga 2):
   * el visitante siempre ve información, nunca un error.
   *
   * ─── POR QUÉ ESTO NO ES ACOPLAR DE MÁS ──────────────────────────────────────────
   *
   * Se comprueba **sólo** si la ruta tiene la forma `/paginas/<slug>`, que es la única
   * que este servidor puede verificar. Una URL externa (la política alojada en otro
   * sitio) o cualquier otra ruta interna se sirven tal cual, sin preguntar nada: no es un
   * validador de enlaces, es el cierre de un caso concreto y conocido.
   *
   * Publicar o despublicar la página cambia el comportamiento del banner sin que nadie
   * toque un ajuste — que es exactamente lo que se quiere: el botón funciona cuando hay
   * algo que leer.
   */
  private async policyUrlServible(url: string): Promise<string> {
    const slug = /^\/paginas\/([A-Za-z0-9-]+)$/.exec(url.trim())?.[1];
    if (!slug) return url;

    const pagina = await this.prisma.post.findFirst({
      where: { slug, type: 'PAGE', status: 'PUBLISHED' },
      select: { id: true },
    });
    return pagina ? url : '';
  }

  /**
   * Guarda los campos que vengan. Todo o nada, con su auditoría, y revalidando la caché
   * del sitio — molde literal de `BrandingService.setLogo`.
   *
   * PARCIAL A PROPÓSITO: la pantalla manda sólo lo que cambió. Mandarlo todo obligaría a
   * que un admin que corrige una errata reescribiera también la versión, que es
   * justamente el campo que NO debe moverse por accidente (D5).
   */
  async update(
    cambios: Partial<CookieTextConfig>,
    actorId: string,
    ip?: string,
  ): Promise<CookieTextConfig> {
    const entradas = (Object.entries(cambios) as [CookieTextField, string | undefined][])
      .filter((e): e is [CookieTextField, string] => e[1] !== undefined)
      .map(([campo, valor]) => [campo, valor.trim()] as const);

    for (const [campo, valor] of entradas) ConsentConfigService.validar(campo, valor);

    const antes = await this.get();

    await this.prisma.$transaction(async (tx) => {
      for (const [campo, valor] of entradas) {
        const key = COOKIE_TEXT_SETTING_KEYS[campo];
        await tx.setting.upsert({
          where: { key },
          create: { key, value: valor, updatedById: actorId },
          update: { value: valor, updatedById: actorId },
        });
      }

      // UN registro de auditoría por operación, no uno por campo: lo que hizo el admin
      // fue «guardar el texto del banner», y partirlo en siete haría ilegible el
      // historial de la única clave que importa de verdad, la versión.
      await this.auditLog.log(
        {
          action: 'COOKIE_CONFIG_UPDATE',
          actorId,
          resourceType: 'Setting',
          resourceId: 'cookies-config',
          before: antes as unknown as Prisma.InputJsonValue,
          after: { ...antes, ...Object.fromEntries(entradas) } as unknown as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );
    });

    this.revalidateService.revalidateTag(COOKIES_CONFIG_CACHE_TAG);
    return this.get();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** `Setting.value` es `Json`: sólo vale una cadena no vacía. Todo lo demás es «sin configurar». */
  private static textoODefecto(valor: Prisma.JsonValue | undefined, defecto: string): string {
    return typeof valor === 'string' && valor.trim().length > 0 ? valor : defecto;
  }

  private static validar(campo: CookieTextField, valor: string): void {
    // `policyUrl` es el único que admite quedarse vacío: mientras la página de cookies no
    // exista (ráfaga 3), vaciarlo es la forma de decir «todavía no hay adónde enlazar».
    if (valor.length === 0 && campo !== 'policyUrl') {
      throw new UnprocessableEntityException(
        `El campo «${campo}» no puede quedarse vacío: el banner tiene que decir algo.`,
      );
    }

    if (valor.length > COOKIE_TEXT_MAX_LENGTH[campo]) {
      throw new UnprocessableEntityException(
        `El campo «${campo}» no puede pasar de ${COOKIE_TEXT_MAX_LENGTH[campo]} caracteres.`,
      );
    }

    /**
     * LA ÚNICA VALIDACIÓN DE CONTENIDO, y protege una obligación legal, no un gusto.
     *
     * Poner «Aceptar» o «Vale» en el botón de rechazo deja el sistema NO CONFORME —
     * rechazar tiene que ser tan fácil como aceptar— y la mecánica seguiría siendo
     * impecable, así que nadie lo notaría mirando el código. Se corta aquí, en el
     * servidor, y no en la pantalla: un aviso en la interfaz se puede ignorar.
     */
    if (campo === 'rejectLabel') {
      const normalizada = valor.toLowerCase();
      if (REJECT_LABEL_FORBIDDEN.some((p) => normalizada.includes(p))) {
        throw new UnprocessableEntityException(
          'El botón de rechazo tiene que expresar un rechazo inequívoco: no puede decir ' +
            '«aceptar», «permitir», «vale» ni equivalentes. El RGPD exige que rechazar sea ' +
            'tan fácil como aceptar, y eso empieza por el texto del botón.',
        );
      }
    }

    /**
     * El enlace, sólo relativo o https. Un `javascript:` en un enlace que sale en TODAS
     * las páginas sería un XSS con alcance total, y un `http://` degradaría la seguridad
     * de la página entera.
     */
    if (campo === 'policyUrl' && valor.length > 0) {
      const valido = valor.startsWith('/') || valor.startsWith('https://');
      if (!valido) {
        throw new UnprocessableEntityException(
          'El enlace de la política tiene que ser una ruta interna (empieza por «/») o una ' +
            'dirección https://.',
        );
      }
    }
  }
}
