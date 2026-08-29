'use client';

import Link from 'next/link';
import { AlertCircle, CheckCircle2, Eye, FileText, Inbox, Settings } from 'lucide-react';
import type { WorkQueue } from '@/lib/api/admin';

/**
 * NOTIFICACIONES N6 — QUÉ QUEDA POR HACER, por área.
 *
 * ── POR QUÉ VA ARRIBA Y SEPARADO DE LAS MÉTRICAS ───────────────────────────
 *
 * «Usuarios totales: 12.480» y «Reportes pendientes: 3» no son la misma clase de
 * dato: uno se mira una vez al mes, el otro es trabajo que alguien tiene que hacer
 * hoy. Mezclados —como estaban— el segundo se pierde entre los primeros. Aquí
 * arriba, lo primero que se ve al abrir el backoffice es la cola.
 *
 * ── UN CERO SE PINTA, NO DESAPARECE ────────────────────────────────────────
 *
 * «0 pendientes» es información: dice que esa área está al día. Una tarjeta
 * ausente es ambigua —¿no hay nada, o no se está midiendo?—. Lo que sí cambia es
 * el énfasis: lo que tiene trabajo se resalta, lo que está a cero se apaga.
 *
 * ── TODO EL STAFF LO VE, SIN FILTRAR POR SECCIÓN ───────────────────────────
 *
 * Un moderador sin acceso a facturación ve que hay 4 facturas pendientes: no puede
 * entrar, pero sabe que existen. Lo que hace segura esa decisión es que **esto son
 * números y nunca contenido** (ver el invariante en el backend).
 */

type Tarjeta = {
  etiqueta: string;
  valor: number;
  /** A dónde se va a hacer ese trabajo. Rutas del backoffice, nunca públicas. */
  href: string;
};

function Area({
  titulo,
  icono: Icono,
  tarjetas,
  nota,
}: {
  titulo: string;
  icono: React.ElementType;
  tarjetas: Tarjeta[];
  nota?: React.ReactNode;
}) {
  const pendiente = tarjetas.reduce((n, t) => n + t.valor, 0);

  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Icono className="h-4 w-4 text-muted-foreground" />
        {titulo}
        {pendiente === 0 && !nota && (
          <span className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" />
            al día
          </span>
        )}
      </h3>

      <ul className="space-y-1">
        {tarjetas.map((t) => (
          <li key={t.etiqueta}>
            <Link
              href={t.href}
              className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-muted"
            >
              <span className={t.valor > 0 ? '' : 'text-muted-foreground'}>{t.etiqueta}</span>
              <span
                className={
                  t.valor > 0
                    ? 'ml-3 min-w-6 rounded bg-primary px-1.5 text-center text-xs font-semibold leading-5 text-primary-foreground'
                    : 'ml-3 min-w-6 text-center text-xs leading-5 text-muted-foreground'
                }
              >
                {t.valor}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {nota}
    </div>
  );
}

export function ColaDeTrabajo({ cola }: { cola: WorkQueue }) {
  const { moderacion, atencion, plataforma } = cola;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Trabajo pendiente
      </h2>

      <div className="grid gap-4 lg:grid-cols-3">
        <Area
          titulo="Moderación"
          icono={Eye}
          tarjetas={[
            // Cada enlace lleva a la lista YA FILTRADA por lo que cuenta: el número
            // y su destino tienen que decir lo mismo.
            { etiqueta: 'Pendientes de revisión', valor: moderacion.pendientesRevision, href: '/admin/moderacion' },
            { etiqueta: 'Denuncias abiertas', valor: moderacion.denunciasAbiertas, href: '/admin/reportes' },
            { etiqueta: 'Valoraciones denunciadas', valor: moderacion.valoracionesDenunciadas, href: '/admin/reportes' },
            { etiqueta: 'Sin triar', valor: moderacion.sinTriar, href: '/admin/anuncios?triage=NEW' },
            { etiqueta: 'Editados tras revisarse', valor: moderacion.editadosTrasRevisar, href: '/admin/anuncios?triage=EDITED' },
            { etiqueta: 'Con detección sin mirar', valor: moderacion.conDeteccionSinMirar, href: '/admin/anuncios?triage=NEW' },
            { etiqueta: 'En observación', valor: moderacion.enObservacion, href: '/admin/anuncios?watched=true' },
          ]}
        />

        <Area
          titulo="Atención"
          icono={Inbox}
          tarjetas={[
            { etiqueta: 'Tickets sin asignar', valor: atencion.ticketsSinAsignar, href: '/admin/tickets' },
            { etiqueta: 'Esperando al equipo', valor: atencion.ticketsEsperandoStaff, href: '/admin/tickets' },
            { etiqueta: 'Sin respuesta +24 h', valor: atencion.ticketsEstancados, href: '/admin/tickets' },
            { etiqueta: 'Contacto sin atender', valor: atencion.contactoSinAtender, href: '/admin/mensajes-contacto' },
          ]}
        />

        <Area
          titulo="Plataforma"
          icono={FileText}
          tarjetas={[
            { etiqueta: 'Facturas por emitir', valor: plataforma.facturasPendientes, href: '/admin/facturas' },
            { etiqueta: 'Sin datos fiscales', valor: plataforma.sinDatosFiscales, href: '/admin/facturacion' },
          ]}
          nota={
            /*
              EL AJUSTE QUE ROMPE UN CANAL EN SILENCIO. Sin `supportEmail`, el aviso
              de un ticket nuevo al buzón de soporte NO se envía: sólo queda un
              `logger.warn` que nadie lee. Aquí deja de ser invisible.
            */
            plataforma.buzonSoporteSinConfigurar ? (
              <Link
                href="/admin/ajustes"
                className="mt-3 flex items-start gap-2 rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive hover:bg-destructive/15"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong>Buzón de soporte sin configurar.</strong> Los avisos de tickets nuevos
                  no se están enviando por correo.
                </span>
              </Link>
            ) : (
              <p className="mt-3 flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
                <Settings className="h-3.5 w-3.5" />
                Buzón de soporte configurado
              </p>
            )
          }
        />
      </div>
    </section>
  );
}
