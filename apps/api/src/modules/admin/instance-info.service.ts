import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LISTINGS_INDEX } from '../search/search.service';
import { BUMP_SCHEDULE_TIMEZONE } from '../bump-schedule/next-run';
import {
  DEFAULT_FISCAL_PERIODICITY,
  DEFAULT_FISCAL_WINDOW_MONTHS,
  FISCAL_PERIODICITY_SETTING,
  FISCAL_WINDOW_SETTING,
} from '../invoicing/invoicing.constants';
import type { InstanceInfo } from './instance-info.types';

/** El defecto de `RESEND_FROM` en `configuration.ts`. Un placeholder con pinta de dominio real. */
const REMITENTE_PLACEHOLDER = 'noreply@tudominio.es';

/** La clave del buzón de soporte. La misma que lee `TicketNotificationsService`. */
const SUPPORT_EMAIL_SETTING = 'supportEmail';

/** La clave de los datos fiscales del emisor. La misma que lee `InvoicingService`. */
const FISCAL_ISSUER_SETTING = 'fiscalIssuer';

/**
 * Los proveedores de facturación que emiten facturas FISCALMENTE VÁLIDAS.
 *
 * HOY ESTÁ VACÍA A PROPÓSITO: el único proveedor conectado es `stub`, que genera un PDF de
 * pega. `env.validation.ts` ni siquiera admite otro valor todavía. Cuando se conecte un
 * proveedor homologado se añade su nombre aquí —al mismo tiempo que su implementación en
 * `InvoicingModule`— y el aviso ámbar del panel se apaga solo.
 *
 * SE DECIDE EN EL BACKEND Y NO EN LA PANTALLA: «qué proveedor es homologado» es conocimiento de
 * negocio, no presentación. La UI sólo pinta la consecuencia.
 */
const PROVEEDORES_FACTURACION_VALIDOS: readonly string[] = [];

/**
 * AJUSTES RÁFAGA B — EL CONSTRUCTOR DEL PANEL DE INSTANCIA, CAMPO A CAMPO.
 *
 * ── LA REGLA DE ESTE FICHERO, QUE NO SE NEGOCIA ───────────────────────────────────────────
 *
 * Cada dato de la respuesta se escribe A MANO, con su nombre, en el objeto que devuelve
 * `get()`. **No hay ningún `...process.env`, ningún `Object.keys`, ningún filtro de claves
 * «sensibles».** Un filtro es una lista negra, y una lista negra falla en la dirección
 * peligrosa: la variable que alguien añada mañana al `.env` **no está en ella**, así que se
 * publicaría sola. Una lista blanca escrita a mano falla en la dirección segura — un dato nuevo
 * no aparece hasta que alguien lo escribe aquí, mirándolo.
 *
 * De cualquier credencial se publica `configurado: boolean` y **nunca** el valor, ni entero ni
 * en trozos. Ver la cabecera de `instance-info.types.ts` y §6.1 de la auditoría.
 *
 * `test/instance-info.e2e-spec.ts` recorre la respuesta REAL en busca de los valores secretos
 * del entorno y falla si encuentra cualquiera. Esa es la otra mitad de la barrera.
 */
@Injectable()
export class InstanceInfoService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async get(): Promise<InstanceInfo> {
    const [buzonSoporte, emisor, periodicidad, ventana] = await Promise.all([
      this.leerBuzonSoporte(),
      this.leerEmisorFiscal(),
      this.leerPeriodicidadFiscal(),
      this.leerVentanaFiscal(),
    ]);

    const remitente = this.config.get<string>('resend.from', REMITENTE_PLACEHOLDER);
    const entornoRedsys = this.config.get<string>('redsys.environment', 'test');
    const proveedorFacturacion = this.config.get<string>('invoicing.provider', 'stub');

    // La zona horaria REAL del proceso: la que usan todos los @Cron. Puede no ser la de las
    // programaciones de bump, y por eso se enseñan las dos.
    const tzServidor = Intl.DateTimeFormat().resolvedOptions().timeZone;

    return {
      identidad: {
        appUrl: this.config.get<string>('appUrl', ''),
        // Sin `??`: si NODE_ENV no está definido, «desconocido» es la verdad y decirla es el
        // trabajo de este panel.
        entorno: process.env.NODE_ENV ?? 'desconocido',
      },

      correos: {
        remitente: {
          direccion: remitente,
          esPlaceholder: remitente === REMITENTE_PLACEHOLDER,
        },
        buzonSoporte,
        proveedor: {
          nombre: 'Resend',
          // EL HECHO, NUNCA LA CLAVE.
          configurado: this.tieneValor(this.config.get<string>('resend.apiKey')),
        },
        // No existe. Ver el tipo: se dice, no se rellena.
        contactoPublico: null,
      },

      proveedores: {
        facturacion: {
          proveedor: proveedorFacturacion,
          emiteFacturasValidas: PROVEEDORES_FACTURACION_VALIDOS.includes(proveedorFacturacion),
        },
        emisorFiscal: emisor,
        pagoRecurrente: {
          nombre: 'Stripe',
          configurado: this.tieneValor(this.config.get<string>('stripe.secretKey')),
        },
        pagoUnico: {
          nombre: 'Redsys',
          // El código de comercio y el terminal NO son secretos: viajan en cada formulario de
          // pago que se le manda al banco. La clave de firma, en cambio, jamás — sólo su
          // booleano, como el resto de credenciales.
          comercio: this.oNulo(this.config.get<string>('redsys.merchantCode')),
          terminal: this.oNulo(this.config.get<string>('redsys.terminal')),
          entorno: entornoRedsys,
          cobrosReales: entornoRedsys === 'production',
          configurado: this.tieneValor(this.config.get<string>('redsys.secretKey')),
        },
        almacenamiento: {
          endpoint: this.oNulo(this.config.get<string>('s3.endpoint')),
          bucket: this.oNulo(this.config.get<string>('s3.bucket')),
          urlPublica: this.oNulo(this.config.get<string>('s3.publicUrl')),
          // Las credenciales del bucket (`s3.accessKeyId`, `s3.secretAccessKey`) NO se publican
          // ni como booleano: son obligatorias por Joi, así que el dato sería siempre «sí» y no
          // contesta ninguna pregunta.
        },
        busqueda: {
          host: this.oNulo(this.config.get<string>('meili.host')),
          // El MISMO valor que usa el indexador, importado de su dueño y no releído del entorno:
          // un panel que dijera un índice y el buscador usara otro sería peor que no tenerlo.
          indice: LISTINGS_INDEX,
        },
        geocodificacion: {
          proveedor: this.config.get<string>('geocoding.provider', 'nominatim'),
        },
        loginGoogle: {
          configurado: this.tieneValor(this.config.get<string>('google.clientId')),
        },
        observabilidad: {
          // `SENTRY_DSN` no pasa por `configuration.ts` (lo lee `main.ts` directamente del
          // entorno, antes de que exista el contenedor de Nest), así que aquí se lee igual.
          configurado: this.tieneValor(process.env.SENTRY_DSN),
        },
      },

      configuracion: {
        zonaHoraria: {
          programaciones: BUMP_SCHEDULE_TIMEZONE,
          servidor: tzServidor,
          coinciden: tzServidor === BUMP_SCHEDULE_TIMEZONE,
        },
        iva: { modo: 'por-linea-de-factura' },
        facturacion: {
          periodicidad,
          ventanaAutoservicioMeses: ventana,
        },
        // El gestor de paquetes la define al arrancar por script (`pnpm start`); arrancando el
        // `dist` a pelo no está, y entonces es `null` — «no disponible», no un número inventado.
        versionApi: this.oNulo(process.env.npm_package_version),
        // EL HUECO PREPARADO. Hoy nadie exporta `GIT_SHA`, así que esto es `null`.
        commit: this.oNulo(process.env.GIT_SHA),
      },
    };
  }

  /** «Tiene valor» = existe y no está vacía. Una cadena vacía es «sin configurar», no un secreto. */
  private tieneValor(v: string | undefined): boolean {
    return typeof v === 'string' && v.trim().length > 0;
  }

  /** Normaliza «vacío» a `null` para que la pantalla pinte «sin configurar» y no un hueco. */
  private oNulo(v: string | undefined): string | null {
    return this.tieneValor(v) ? (v as string).trim() : null;
  }

  private async leerBuzonSoporte(): Promise<string | null> {
    const fila = await this.prisma.setting.findUnique({
      where: { key: SUPPORT_EMAIL_SETTING },
      select: { value: true },
    });
    return typeof fila?.value === 'string' && fila.value.trim() ? fila.value.trim() : null;
  }

  /**
   * Del emisor fiscal salen SÓLO dos cosas: si está configurado y su razón social.
   *
   * La razón social es un dato público —figura en toda factura emitida— y es lo que permite
   * confirmar de un vistazo que esta instancia factura a nombre de quien debe. El resto de la
   * ficha (domicilio, NIF) se queda en su página: aquí no hace falta para confirmar nada.
   *
   * «Configurado» significa lo MISMO que para `InvoicingService`: con `taxId` y `fiscalName`.
   * Si significara otra cosa, el panel diría «configurado» mientras la emisión falla.
   */
  private async leerEmisorFiscal(): Promise<{ configurado: boolean; razonSocial: string | null }> {
    const fila = await this.prisma.setting.findUnique({
      where: { key: FISCAL_ISSUER_SETTING },
      select: { value: true },
    });
    const v = fila?.value as Record<string, unknown> | undefined;
    const configurado = !!v && typeof v === 'object' && !!v.taxId && !!v.fiscalName;
    return {
      configurado,
      razonSocial: typeof v?.fiscalName === 'string' ? v.fiscalName : null,
    };
  }

  /** La periodicidad vigente, con el mismo defecto que aplica el cron. */
  private async leerPeriodicidadFiscal(): Promise<string> {
    const fila = await this.prisma.setting.findUnique({
      where: { key: FISCAL_PERIODICITY_SETTING },
      select: { value: true },
    });
    return String(fila?.value ?? DEFAULT_FISCAL_PERIODICITY) === 'MONTHLY'
      ? 'MONTHLY'
      : DEFAULT_FISCAL_PERIODICITY;
  }

  /** La ventana vigente, con el mismo defecto (y la misma tolerancia) que aplica el lector. */
  private async leerVentanaFiscal(): Promise<number> {
    const fila = await this.prisma.setting.findUnique({
      where: { key: FISCAL_WINDOW_SETTING },
      select: { value: true },
    });
    const meses = Number(fila?.value);
    return Number.isFinite(meses) && meses > 0 ? meses : DEFAULT_FISCAL_WINDOW_MONTHS;
  }
}
