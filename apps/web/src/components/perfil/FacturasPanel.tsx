'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
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

  function handleRequest() {
    setError(null);
    startTransition(async () => {
      try {
        await requestInvoice(token);
        router.refresh();
      } catch (e) {
        setError(toUserMessage(e));
      }
    });
  }

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

        {!eligibility.hasFiscalData ? (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            Completa tus datos fiscales (arriba) para poder solicitar facturas.
          </div>
        ) : facturables.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tienes movimientos facturables ahora mismo.</p>
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

            <div className="mt-4 flex items-center gap-4">
              <Button onClick={handleRequest} disabled={isPending || !eligibility.canRequest}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Solicitar factura
              </Button>
              <p className="text-xs text-muted-foreground">
                Se emitirá una factura con {facturables.length} línea
                {facturables.length === 1 ? '' : 's'}.
              </p>
            </div>
          </>
        )}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </section>

      <Separator />

      {/* Facturas emitidas */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Mis facturas</h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no has emitido ninguna factura.</p>
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
