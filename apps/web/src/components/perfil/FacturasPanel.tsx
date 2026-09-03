'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Download, FileText, LifeBuoy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { requestInvoice, type Facturable, type InvoiceDto, type InvoiceEligibility } from '@/lib/api/facturacion';
import { toUserMessage } from '@/lib/api/client';

interface Props {
  token: string;
  eligibility: InvoiceEligibility;
  facturables: Facturable[];
  invoices: InvoiceDto[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function FacturasPanel({ token, eligibility, facturables, invoices }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  /**
   * UXV.3 (M7) — emitir una factura es IRREVERSIBLE: la base de datos tiene triggers que
   * rechazan cualquier UPDATE/DELETE sobre una `Invoice` ISSUED y sobre sus líneas. Hasta
   * ahora se disparaba con UN clic, sin confirmar nada —mientras archivar un anuncio sí
   * lo pedía— y al terminar solo hacía `router.refresh()`, sin señal ninguna de que se
   * hubiera emitido. Ahora confirma antes (`AlertDialog`, el mismo molde de archivar) y
   * avisa después.
   */
  function handleRequest() {
    setError(null);
    startTransition(async () => {
      try {
        await requestInvoice(token);
        toast.success(
          `Factura emitida con ${facturables.length} línea${facturables.length === 1 ? '' : 's'}. Ya puedes descargarla.`,
        );
        router.refresh();
      } catch (e) {
        setError(toUserMessage(e));
      }
    });
  }

  /**
   * Por qué NO se puede pedir factura ahora mismo. El botón se deshabilitaba con
   * `!eligibility.canRequest` sin decir nada: con los datos fiscales completos y sin
   * movimientos, o fuera de la ventana de autoservicio, quedaba un botón muerto y ninguna
   * explicación. `reason` la trae el backend (`GET /billing/eligibility`).
   */
  const motivoNoDisponible = (() => {
    if (eligibility.canRequest) return null;
    switch (eligibility.reason) {
      case 'MISSING_FISCAL_DATA':
        return 'Completa tus datos fiscales, arriba, para poder emitir la factura.';
      case 'NO_INVOICEABLE_MOVEMENTS':
        return 'No hay movimientos pendientes de facturar en el periodo vigente.';
      default:
        return 'Ahora mismo no se puede emitir la factura. Si crees que es un error, abre un ticket de soporte.';
    }
  })();

  async function handleDownload(inv: InvoiceDto) {
    setDownloadingId(inv.id);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/billing/invoices/${inv.id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `factura-${inv.number ?? inv.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo descargar la factura. Inténtalo de nuevo.');
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="space-y-8">
      {/* Movimientos facturables */}
      <section>
        <h2 className="mb-1 text-lg font-semibold">Movimientos facturables</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Cobros de la plataforma pendientes de facturar en el periodo vigente.
        </p>

        {/* UXV.6 (B5) — «(arriba)» no es una salida: el usuario tenía que buscar el
            formulario por su cuenta. Ahora es un enlace que lleva a él. */}
        {!eligibility.hasFiscalData ? (
          <div className="rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
            Para poder solicitar facturas necesitas tus datos fiscales completos.{' '}
            <a href="#datos-fiscales" className="font-medium underline">
              Completarlos ahora
            </a>
            .
          </div>
        ) : facturables.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tienes movimientos facturables ahora mismo. Aparecerán aquí en cuanto compres
            créditos, bumps, un destacado o la suscripción Pro.
          </p>
        ) : (
          <>
            <ul className="divide-y rounded-lg border">
              {facturables.map((f) => (
                <li key={f.transactionId} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium">{f.concept}</p>
                    <p className="text-muted-foreground">{formatDate(f.operationDate)}</p>
                  </div>
                  <span className="font-medium">
                    {f.amountGross} {f.currency}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap items-center gap-4">
              {/* UXV.3 (M7) — mismo molde de confirmación que Archivar/Eliminar en
                  MyListingCard. Una factura emitida no se puede tocar ni borrar (lo
                  imponen triggers en la base de datos), así que merece al menos la misma
                  pregunta que archivar un anuncio. */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={isPending || !eligibility.canRequest}>
                    {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Solicitar factura
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Emitir la factura?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Se emitirá una factura con {facturables.length} línea
                      {facturables.length === 1 ? '' : 's'}, a nombre de tus datos fiscales
                      actuales y por un total de {facturables[0]?.currency ? '' : ''}
                      {facturables
                        .reduce((sum, f) => sum + Number(f.amountGross), 0)
                        .toFixed(2)}{' '}
                      {facturables[0]?.currency ?? 'EUR'}. Una factura emitida{' '}
                      <strong>no se puede modificar ni anular</strong>, y esos movimientos
                      dejarán de estar disponibles para futuras facturas.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRequest} disabled={isPending}>
                      Emitir factura
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <p className="text-xs text-muted-foreground">
                Se emitirá una factura con {facturables.length} línea
                {facturables.length === 1 ? '' : 's'}.
              </p>
            </div>

            {/* UXV.3 (M7) — un botón deshabilitado sin explicación es un callejón. */}
            {motivoNoDisponible && (
              <p className="mt-2 text-xs text-muted-foreground" data-testid="motivo-no-facturable">
                {motivoNoDisponible}
              </p>
            )}
          </>
        )}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </section>

      <Separator />

      {/* Facturas emitidas */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Mis facturas</h2>
        {invoices.length === 0 ? (
          // UXV.6 (B5) — dice además QUÉ hacer para tener una, en vez de constatar el vacío.
          <p className="text-sm text-muted-foreground">
            Todavía no has emitido ninguna factura. Cuando tengas movimientos facturables,
            podrás emitirla desde el bloque de arriba.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {invoices.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div>
                    <p className="font-medium">{inv.number ?? '(sin número)'}</p>
                    <p className="text-muted-foreground">
                      {formatDate(inv.issuedAt)} · {inv.totalGross} {inv.currency} · {inv.lineCount} línea
                      {inv.lineCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {/* Atención al usuario R6 — entrada contextual. El invoiceId es
                      una sugerencia para prefijar el ticket; el backend revalida
                      que la factura sea suya al crearlo (422 si no). */}
                  <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
                    <Link href={`/mis-tickets/nuevo?invoiceId=${inv.id}`} prefetch={false}>
                      <LifeBuoy className="mr-1.5 h-3.5 w-3.5" />
                      ¿Ayuda?
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownload(inv)}
                    disabled={!inv.hasPdf || downloadingId === inv.id}
                  >
                    {downloadingId === inv.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    Descargar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Nota: hasta conectar el proveedor de facturación, los PDF se generan en modo desarrollo y van
          marcados como <strong>no válidos fiscalmente</strong>.
        </p>
      </section>
    </div>
  );
}
