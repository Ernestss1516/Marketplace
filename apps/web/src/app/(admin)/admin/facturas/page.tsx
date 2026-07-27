'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Download, Loader2, Settings } from 'lucide-react';
import {
  getAdminInvoices,
  getFiscalIssuer,
  type AdminInvoiceRow,
} from '@/lib/api/admin-facturas';
import { ApiError } from '@/lib/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const PER_PAGE = 25;
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const STATUS_LABELS: Record<string, string> = { DRAFT: 'Borrador', ISSUED: 'Emitida', FAILED: 'Fallida' };
const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive'> = {
  DRAFT: 'secondary',
  ISSUED: 'default',
  FAILED: 'destructive',
};
const ORIGIN_LABELS: Record<string, string> = {
  USER_REQUESTED: 'Manual',
  AUTO_PERIODIC: 'Automática',
  ADMIN: 'Admin',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatAmount(raw: string, currency: string) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(parseFloat(raw));
}

function FacturasTable({ token }: { token: string }) {
  const [items, setItems] = useState<AdminInvoiceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [status, setStatus] = useState('');
  const [origin, setOrigin] = useState('');
  const [periodKey, setPeriodKey] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(
    async (p: number, st: string, or: string, pk: string, uq: string, df: string, dt: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminInvoices(token, {
          status: st || undefined,
          origin: or || undefined,
          periodKey: pk || undefined,
          userQuery: uq || undefined,
          dateFrom: df || undefined,
          dateTo: dt || undefined,
          page: p,
          perPage: PER_PAGE,
        });
        setItems(data.items);
        setTotal(data.total);
      } catch (err) {
        setError(err instanceof ApiError ? `Error ${err.statusCode}: ${err.message}` : 'Error al cargar las facturas');
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void load(page, status, origin, periodKey, userQuery, dateFrom, dateTo);
  }, [load, page, status, origin, periodKey, userQuery, dateFrom, dateTo]);

  async function handleDownload(inv: AdminInvoiceRow) {
    setDownloadingId(inv.id);
    try {
      const res = await fetch(`${API_URL}/admin/invoices/${inv.id}/pdf`, {
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
      setError('No se pudo descargar el PDF.');
    } finally {
      setDownloadingId(null);
    }
  }

  const totalPages = Math.ceil(total / PER_PAGE);
  const selectCls = 'rounded-md border px-3 py-2 text-sm';

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-3">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={selectCls}>
          <option value="">Estado (todos)</option>
          <option value="ISSUED">Emitida</option>
          <option value="DRAFT">Borrador</option>
          <option value="FAILED">Fallida</option>
        </select>
        <select value={origin} onChange={(e) => { setOrigin(e.target.value); setPage(1); }} className={selectCls}>
          <option value="">Origen (todos)</option>
          <option value="USER_REQUESTED">Manual</option>
          <option value="AUTO_PERIODIC">Automática</option>
          <option value="ADMIN">Admin</option>
        </select>
        <input value={periodKey} onChange={(e) => { setPeriodKey(e.target.value); setPage(1); }} placeholder="Periodo (2026-Q3)" className={selectCls} />
        <input value={userQuery} onChange={(e) => { setUserQuery(e.target.value); setPage(1); }} placeholder="Usuario (email/nombre)" className={selectCls} />
        <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className={selectCls} />
        <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className={selectCls} />
      </div>

      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No hay facturas para estos filtros.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Número</th>
                <th className="px-4 py-2">Receptor</th>
                <th className="px-4 py-2">Origen</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2">Periodo</th>
                <th className="px-4 py-2">Emitida</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-4 py-2 font-medium">{inv.number ?? '—'}</td>
                  <td className="px-4 py-2">
                    <div>{inv.receiverName ?? inv.user.name}</div>
                    <div className="text-xs text-muted-foreground">{inv.receiverTaxId ?? inv.user.email}</div>
                  </td>
                  <td className="px-4 py-2">{ORIGIN_LABELS[inv.origin] ?? inv.origin}</td>
                  <td className="px-4 py-2">
                    <Badge variant={STATUS_VARIANTS[inv.status] ?? 'secondary'}>
                      {STATUS_LABELS[inv.status] ?? inv.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-right">{formatAmount(inv.totalGross, inv.currency)}</td>
                  <td className="px-4 py-2">{inv.periodKey ?? '—'}</td>
                  <td className="px-4 py-2">{formatDate(inv.issuedAt)}</td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!inv.hasPdf || downloadingId === inv.id}
                      onClick={() => handleDownload(inv)}
                    >
                      {downloadingId === inv.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{total} facturas</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
            <span className="px-2 py-1">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminFacturasPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;
  const [issuerConfigured, setIssuerConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    if (!token) return;
    getFiscalIssuer(token)
      .then((r) => setIssuerConfigured(r.configured))
      .catch(() => setIssuerConfigured(null));
  }, [token]);

  if (!token) {
    return (
      <div className="rounded border border-yellow-300 bg-yellow-50 p-4 text-yellow-800">
        Sesión no disponible. Recarga la página o inicia sesión de nuevo.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Facturas emitidas</h1>
        <Button variant="outline" asChild>
          <Link href="/admin/facturas/emisor">
            <Settings className="mr-2 h-4 w-4" />
            Emisor fiscal
          </Link>
        </Button>
      </div>

      {issuerConfigured === false && (
        <div className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          El emisor fiscal aún no está configurado. Configúralo antes de que se emitan facturas — sin él, la
          emisión (manual y automática) falla.{' '}
          <Link href="/admin/facturas/emisor" className="font-medium underline">
            Configurar ahora
          </Link>
        </div>
      )}

      <FacturasTable token={token} />
    </div>
  );
}
