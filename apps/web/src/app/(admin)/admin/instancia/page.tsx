'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AlertCircle, AlertTriangle, Check, X } from 'lucide-react';
import { getInstanceInfo, type InstanceInfo } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
// Las cuatro constantes de BUILD del frontend. No vienen del backend a propósito: son de
// este lado y copiarlas allí crearía dos fuentes para el mismo valor. Ver la cabecera de
// `instance-info.types.ts` en la API.
import { SITE_NAME, SITE_DESCRIPTION, API_URL, DEFAULT_CURRENCY } from '@/config';

/**
 * AJUSTES RÁFAGA B — CÓMO ESTÁ MONTADA ESTA INSTANCIA.
 *
 * ── QUÉ PREGUNTA CONTESTA ─────────────────────────────────────────────────────────────────
 *
 * «¿Desde qué dirección salen los correos de ESTA instancia? ¿Qué dominio tiene? ¿Está
 * cobrando de verdad o contra el TPV de pruebas? ¿Las facturas que emite valen?». Hoy eso sólo
 * se puede confirmar entrando en el servidor a leer un `.env`. Con varios despliegues —uno por
 * nicho— eso deja de ser viable, y esta página es la respuesta de un vistazo.
 *
 * ── SOLO LECTURA, Y ES LA MITAD DE SU VALOR ───────────────────────────────────────────────
 *
 * **Aquí no se edita nada.** No es «Ajustes»: es la confirmación. Lo que sí es configurable
 * —el buzón de soporte, la periodicidad fiscal— aparece aquí en solo lectura Y se edita en
 * `/admin/ajustes`, con un enlace para ir. Mezclar las dos cosas convertiría una pantalla de
 * consulta rápida en otra pantalla en la que hay que tener cuidado.
 *
 * ── LOS AVISOS ÁMBAR SON EL MOTIVO DE LA PÁGINA ───────────────────────────────────────────
 *
 * Dos configuraciones pueden estar mal de una forma que no da ningún error y que nadie
 * descubre hasta que duele: el proveedor de facturación en `stub` (emite PDFs que **no son
 * facturas válidas**) y Redsys en `test` (cobra contra el TPV de pruebas). Van en ámbar y
 * arriba del todo, no en gris al final: una alarma que hay que buscar no es una alarma. Lo
 * mismo con el remitente de fábrica, que parece un dominio real.
 *
 * Lo que NO se pinta aquí es tan importante como lo que sí: ninguna credencial, ni entera ni en
 * trozos. De cada una, sólo si está puesta. La barrera vive en el backend (el objeto se
 * construye campo a campo) y la pinza `test/instance-info.e2e-spec.ts`.
 */

// ─── Piezas de presentación ───────────────────────────────────────────────────

/** Un dato: etiqueta a la izquierda, valor a la derecha. El molde de toda la página. */
function Dato({
  label,
  children,
  nota,
}: {
  label: string;
  children: React.ReactNode;
  nota?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium sm:text-right">
        {children}
        {nota && <p className="mt-0.5 text-xs font-normal text-muted-foreground">{nota}</p>}
      </dd>
    </div>
  );
}

/** Un valor que puede no estar. `null` NUNCA se pinta como hueco: se dice que no está. */
function Valor({ v, ausente = 'Sin configurar' }: { v: string | null | undefined; ausente?: string }) {
  if (v === null || v === undefined || v === '') {
    return <span className="text-muted-foreground">{ausente}</span>;
  }
  return <span className="font-mono text-xs">{v}</span>;
}

/**
 * EL HECHO DE ESTAR CONFIGURADA, que es lo único que se publica de una credencial.
 *
 * Nunca el valor ni un fragmento: los últimos caracteres de una clave no son públicos, y no
 * ayudan a confirmar nada que este ✓ no confirme ya.
 */
function Configurado({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-green-700">
      <Check className="h-3.5 w-3.5" /> Configurado
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <X className="h-3.5 w-3.5" /> Sin configurar
    </span>
  );
}

/** La alarma. Ámbar y con icono: tiene que verse sin buscarla. */
function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900"
      data-testid="aviso-instancia"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function Bloque({
  titulo,
  resumen,
  children,
}: {
  titulo: string;
  resumen: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-bold">{titulo}</h2>
      <p className="mb-3 mt-1 text-sm text-muted-foreground">{resumen}</p>
      <dl className="rounded-md border bg-background px-5 py-1">{children}</dl>
    </section>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function AdminInstanciaPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [info, setInfo] = useState<InstanceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    getInstanceInfo(token)
      .then((r) => vivo && setInfo(r))
      .catch((err) => {
        if (!vivo) return;
        setError(
          err instanceof ApiError ? `Error ${err.statusCode}: ${err.message}` : 'Error al cargar',
        );
      });
    return () => {
      vivo = false;
    };
  }, [token]);

  if (!token) {
    return (
      <div className="rounded border border-yellow-300 bg-yellow-50 p-4 text-yellow-800">
        Sesión no disponible. Recarga la página o inicia sesión de nuevo.
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">Instancia</h1>
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">Instancia</h1>
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-md border bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  const { identidad, correos, proveedores, configuracion } = info;

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">Instancia</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Cómo está montada esta instalación. Es una pantalla de <strong>consulta</strong>: aquí
        no se cambia nada. Lo que sí es configurable se edita en{' '}
        <Link href="/admin/ajustes" className="text-blue-700 hover:underline">
          Ajustes
        </Link>
        .
      </p>

      {/* LAS ALARMAS, ARRIBA DEL TODO. Son configuraciones que no dan ningún error y que
          nadie descubre hasta que duele; enterrarlas al final sería no tenerlas. */}
      <div className="mb-8 space-y-3">
        {!proveedores.facturacion.emiteFacturasValidas && (
          <Aviso>
            <strong>Las facturas que emite esta instancia NO son fiscalmente válidas.</strong> El
            proveedor de facturación activo es <code>{proveedores.facturacion.proveedor}</code>,
            que genera un PDF de prueba. Sirve para ver el circuito entero funcionando, no para
            entregárselo a nadie ni para declarar. Antes de facturar de verdad hay que conectar
            un proveedor homologado.
          </Aviso>
        )}
        {!proveedores.pagoUnico.cobrosReales && (
          <Aviso>
            <strong>Los pagos van al TPV de PRUEBAS.</strong> Redsys está en entorno{' '}
            <code>{proveedores.pagoUnico.entorno}</code>, así que ningún cobro de créditos,
            destacados o bumps mueve dinero de verdad. Si esta instancia está en producción,
            esto hay que cambiarlo.
          </Aviso>
        )}
        {correos.remitente.esPlaceholder && (
          <Aviso>
            <strong>Los correos salen desde la dirección de fábrica.</strong>{' '}
            <code>{correos.remitente.direccion}</code> es el valor por defecto del código —tiene
            pinta de dirección real, pero no es de nadie—. Todo el correo que manda esta
            instancia va firmado con ella.
          </Aviso>
        )}
        {!proveedores.emisorFiscal.configurado && (
          <Aviso>
            <strong>No hay datos fiscales del emisor.</strong> Mientras falten el NIF y la razón
            social no se puede emitir <em>ninguna</em> factura, ni las que pida un usuario ni las
            del proceso automático.{' '}
            <Link href="/admin/facturas/emisor" className="underline">
              Configurar el emisor
            </Link>
            .
          </Aviso>
        )}
      </div>

      {/* El contenido, acotado: la nav del backoffice tiene enlaces que se llaman igual que
          algunas etiquetas de aquí («Ajustes», «Facturación»), y sus specs necesitan poder
          distinguir la pantalla del menú. */}
      <div className="space-y-8" data-testid="instancia-contenido">
        <Bloque
          titulo="Identidad"
          resumen="Qué instalación es ésta y a qué dominio responde. Lo primero que distingue un despliegue de otro."
        >
          <Dato label="Nombre de la plataforma" nota="Constante de código; cambia al construir.">
            {SITE_NAME}
          </Dato>
          <Dato label="Descripción" nota="Sale en los metadatos SEO de todas las páginas.">
            <span className="font-normal">{SITE_DESCRIPTION}</span>
          </Dato>
          <Dato
            label="Dominio público"
            nota="Base de los enlaces de todos los correos y origen permitido del WebSocket."
          >
            <Valor v={identidad.appUrl} />
          </Dato>
          <Dato label="URL de la API">
            <Valor v={API_URL} />
          </Dato>
          <Dato label="Entorno">
            <span
              className={
                identidad.entorno === 'production' ? 'font-semibold' : 'text-muted-foreground'
              }
            >
              {identidad.entorno}
            </span>
          </Dato>
        </Bloque>

        <Bloque
          titulo="Correos"
          resumen="Desde dónde escribe esta instancia y a dónde le llegan los avisos. Lo que más difiere entre despliegues."
        >
          <Dato
            label="Remitente"
            nota={
              correos.remitente.esPlaceholder
                ? 'Es el valor por defecto del código, no una dirección configurada.'
                : undefined
            }
          >
            <Valor v={correos.remitente.direccion} />
          </Dato>
          <Dato
            label="Buzón de soporte"
            nota="Recibe los avisos de tickets. Vacío: el aviso in-app se crea igual y sólo se omite el correo."
          >
            <Valor v={correos.buzonSoporte} />
          </Dato>
          <Dato label={`Proveedor de envío (${correos.proveedor.nombre})`}>
            <Configurado ok={correos.proveedor.configurado} />
          </Dato>
          {/* NO APLICA, y se dice. No hay un correo de contacto público: los mensajes de
              /contacto se guardan en una tabla y se leen en el backoffice. */}
          <Dato
            label="Correo de contacto público"
            nota="Los mensajes de /contacto se guardan y se leen en Mensajes de contacto."
          >
            <span className="text-muted-foreground">No aplica</span>
          </Dato>
        </Bloque>

        <Bloque
          titulo="Proveedores"
          resumen="Quién hace cada cosa en esta instancia. De las credenciales sólo se dice si están puestas, nunca cuánto valen."
        >
          <Dato
            label="Facturación"
            nota={
              proveedores.facturacion.emiteFacturasValidas
                ? undefined
                : 'No emite facturas fiscalmente válidas — ver el aviso de arriba.'
            }
          >
            <Valor v={proveedores.facturacion.proveedor} />
          </Dato>
          <Dato label="Emisor fiscal">
            <span className="inline-flex flex-col items-end gap-0.5">
              <Configurado ok={proveedores.emisorFiscal.configurado} />
              {proveedores.emisorFiscal.razonSocial && (
                <span className="text-xs font-normal">{proveedores.emisorFiscal.razonSocial}</span>
              )}
            </span>
          </Dato>
          <Dato
            label={`Pago recurrente (${proveedores.pagoRecurrente.nombre})`}
            nota="Cubre la suscripción Pro."
          >
            <Configurado ok={proveedores.pagoRecurrente.configurado} />
          </Dato>
          <Dato
            label={`Pago único (${proveedores.pagoUnico.nombre})`}
            nota="Cubre packs de créditos, destacados y bumps."
          >
            <span className="inline-flex flex-col items-end gap-0.5">
              <Configurado ok={proveedores.pagoUnico.configurado} />
              <span className="text-xs font-normal">
                entorno <code>{proveedores.pagoUnico.entorno}</code>
                {!proveedores.pagoUnico.cobrosReales && ' — cobros de prueba'}
              </span>
              {proveedores.pagoUnico.comercio && (
                <span className="font-mono text-xs font-normal text-muted-foreground">
                  comercio {proveedores.pagoUnico.comercio} · terminal{' '}
                  {proveedores.pagoUnico.terminal ?? '—'}
                </span>
              )}
            </span>
          </Dato>
          <Dato label="Almacenamiento de imágenes" nota="Distingue el MinIO local del bucket real.">
            <span className="inline-flex flex-col items-end gap-0.5">
              <Valor v={proveedores.almacenamiento.endpoint} />
              <span className="font-mono text-xs font-normal text-muted-foreground">
                bucket {proveedores.almacenamiento.bucket ?? '—'}
              </span>
            </span>
          </Dato>
          <Dato label="Búsqueda (Meilisearch)">
            <span className="inline-flex flex-col items-end gap-0.5">
              <Valor v={proveedores.busqueda.host} />
              <span className="font-mono text-xs font-normal text-muted-foreground">
                índice {proveedores.busqueda.indice}
              </span>
            </span>
          </Dato>
          <Dato
            label="Geocodificación"
            nota={
              proveedores.geocodificacion.proveedor === 'nominatim'
                ? 'Nominatim va a 1 petición por segundo: explica una cola lenta al publicar.'
                : undefined
            }
          >
            <Valor v={proveedores.geocodificacion.proveedor} />
          </Dato>
          <Dato label="Login con Google" nota="Sin configurar, el botón aparece igual y no funciona.">
            <Configurado ok={proveedores.loginGoogle.configurado} />
          </Dato>
          <Dato label="Observabilidad (Sentry)" nota="Si no, los errores de esta instancia no se reportan.">
            <Configurado ok={proveedores.observabilidad.configurado} />
          </Dato>
        </Bloque>

        <Bloque
          titulo="Configuración con efecto"
          resumen="Valores que cambian el comportamiento y conviene confirmar. Los editables se cambian en Ajustes."
        >
          <Dato
            label="Zona horaria"
            nota={
              configuracion.zonaHoraria.coinciden
                ? 'Los procesos programados y el servidor van en la misma hora.'
                : 'DISCREPAN: los crones corren en la hora del servidor y las programaciones de bump se interpretan en la peninsular.'
            }
          >
            <span className="inline-flex flex-col items-end gap-0.5">
              <span className="font-mono text-xs">servidor {configuracion.zonaHoraria.servidor}</span>
              <span className="font-mono text-xs font-normal text-muted-foreground">
                programaciones {configuracion.zonaHoraria.programaciones}
              </span>
            </span>
          </Dato>
          <Dato label="Moneda">{DEFAULT_CURRENCY}</Dato>
          {/* NO SE INVENTA UN 21 %: no hay tipo global, el IVA va por línea de factura. */}
          <Dato label="IVA" nota="Cada línea de factura lleva su tipo; no hay un tipo global configurable.">
            <span className="text-muted-foreground">Por línea de factura</span>
          </Dato>
          <Dato label="Periodicidad de facturación" nota="Editable en Ajustes → Facturación.">
            {configuracion.facturacion.periodicidad === 'MONTHLY' ? 'Mensual' : 'Trimestral'}
          </Dato>
          <Dato label="Ventana de autoservicio de facturas" nota="Editable en Ajustes → Facturación.">
            {configuracion.facturacion.ventanaAutoservicioMeses} meses
          </Dato>
          <Dato label="Versión de la API">
            <Valor v={configuracion.versionApi} ausente="No disponible" />
          </Dato>
          {/* EL HUECO PREPARADO. Hoy nadie exporta GIT_SHA en el despliegue, así que dice «no
              disponible»; el día que se exporte, esta fila se llena sola. */}
          <Dato
            label="Commit desplegado"
            nota={
              configuracion.commit
                ? undefined
                : 'El despliegue todavía no exporta GIT_SHA. En cuanto lo haga, aparece aquí.'
            }
          >
            <Valor v={configuracion.commit} ausente="No disponible" />
          </Dato>
        </Bloque>
      </div>
    </div>
  );
}
