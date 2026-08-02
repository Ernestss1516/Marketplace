'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { AlertCircle, Search } from 'lucide-react';
import {
  getAdminTransactions,
  getAdminWallets,
  type AdminTransaction,
  type AdminWallet,
} from '@/lib/api/admin-billing';
import { ApiError } from '@/lib/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const PER_PAGE = 25;

type Tab = 'transacciones' | 'wallets';

// ─── Labels ───────────────────────────────────────────────────────────────────

const TX_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendiente',
  SUCCEEDED: 'Cobrada',
  FAILED: 'Fallida',
  REFUNDED: 'Devuelta',
  PARTIALLY_REFUNDED: 'Dev. parcial',
};

const TX_STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  PENDING: 'secondary',
  SUCCEEDED: 'default',
  FAILED: 'destructive',
  REFUNDED: 'outline',
  PARTIALLY_REFUNDED: 'outline',
};

const GATEWAY_LABELS: Record<string, string> = {
  REDSYS: 'Redsys',
  STRIPE: 'Stripe',
  ADMIN: 'Admin',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAmount(raw: string, currency: string) {
  const n = parseFloat(raw);
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(n);
}

// ─── Transactions tab ─────────────────────────────────────────────────────────

function TransaccionesTab({ token }: { token: string }) {
  const router = useRouter();

  const [items, setItems] = useState<AdminTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [gateway, setGateway] = useState('');
  const [status, setStatus] = useState('');
  const [userId, setUserId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetch = useCallback(
    async (p: number, gw: string, st: string, uid: string, df: string, dt: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminTransactions(token, {
          gateway: gw || undefined,
          status: st || undefined,
          userId: uid || undefined,
          dateFrom: df || undefined,
          dateTo: dt || undefined,
          page: p,
          perPage: PER_PAGE,
        });
        setItems(data.items);
        setTotal(data.total);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? `Error ${err.statusCode}: ${err.message}`
            : 'Error al cargar las transacciones',
        );
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void fetch(page, gateway, status, userId, dateFrom, dateTo);
  }, [fetch, page, gateway, status, userId, dateFrom, dateTo]);

  function resetFilters() {
    setGateway('');
    setStatus('');
    setUserId('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={gateway}
          onChange={(e) => { setGateway(e.target.value); setPage(1); }}
          className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Todas las pasarelas</option>
          <option value="REDSYS">Redsys</option>
          <option value="STRIPE">Stripe</option>
          <option value="ADMIN">Admin</option>
        </select>

        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Todos los estados</option>
          <option value="PENDING">Pendiente</option>
          <option value="SUCCEEDED">Cobrada</option>
          <option value="FAILED">Fallida</option>
          <option value="REFUNDED">Devuelta</option>
          <option value="PARTIALLY_REFUNDED">Dev. parcial</option>
        </select>

        <input
          type="text"
          value={userId}
          onChange={(e) => { setUserId(e.target.value.trim()); setPage(1); }}
          placeholder="ID de usuario..."
          className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />

        {(gateway || status || userId || dateFrom || dateTo) && (
          <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
            Limpiar filtros
          </Button>
        )}
      </div>

      <p className="mb-2 text-sm text-muted-foreground">{total} transacciones</p>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Usuario</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Pasarela</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Estado</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Importe</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fecha</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  No hay transacciones con los filtros seleccionados.
                </td>
              </tr>
            ) : (
              items.map((tx) => (
                <tr key={tx.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">{tx.user.name}</p>
                      <p className="text-xs text-muted-foreground">{tx.user.email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{GATEWAY_LABELS[tx.gateway] ?? tx.gateway}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={TX_STATUS_VARIANTS[tx.status] ?? 'outline'}>
                      {TX_STATUS_LABELS[tx.status] ?? tx.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatAmount(tx.amountGross, tx.currency)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(tx.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => router.push(`/admin/facturacion/usuarios/${tx.user.id}`)}
                    >
                      Ver usuario
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || loading}
          >
            Siguiente
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Wallets tab ──────────────────────────────────────────────────────────────

function WalletsTab({ token }: { token: string }) {
  const router = useRouter();

  const [items, setItems] = useState<AdminWallet[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [inputQ, setInputQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const fetch = useCallback(
    async (p: number, search: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminWallets(token, { q: search || undefined, page: p, perPage: PER_PAGE });
        setItems(data.items);
        setTotal(data.total);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? `Error ${err.statusCode}: ${err.message}`
            : 'Error al cargar los saldos',
        );
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void fetch(page, q);
  }, [fetch, page, q]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setQ(inputQ.trim());
    setPage(1);
  }

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div>
      <form onSubmit={handleSearch} className="mb-4 flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            value={inputQ}
            onChange={(e) => setInputQ(e.target.value)}
            placeholder="Buscar por nombre o email..."
            className="w-full rounded-md border bg-background py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <Button type="submit" variant="outline" size="sm">Buscar</Button>
        {q && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { setInputQ(''); setQ(''); setPage(1); }}
          >
            Limpiar
          </Button>
        )}
      </form>

      <p className="mb-2 text-sm text-muted-foreground">{total} wallets</p>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Usuario</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Saldo (créditos)</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Última actualización</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 4 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  No se encontraron wallets.
                </td>
              </tr>
            ) : (
              items.map((w) => (
                <tr
                  key={w.id}
                  className="cursor-pointer hover:bg-muted/20"
                  onClick={() => router.push(`/admin/facturacion/usuarios/${w.user.id}`)}
                >
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">{w.user.name}</p>
                      <p className="text-xs text-muted-foreground">{w.user.email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{w.balance}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(w.updatedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                      Ver detalle
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || loading}
          >
            Siguiente
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminFacturacionPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;
  const [activeTab, setActiveTab] = useState<Tab>('transacciones');

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
        <h1 className="text-2xl font-bold">Facturación</h1>
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 border-b">
        {(['transacciones', 'wallets'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {tab === 'transacciones' ? 'Transacciones' : 'Saldos (wallets)'}
          </button>
        ))}
      </div>

      {activeTab === 'transacciones' && <TransaccionesTab token={token} />}
      {activeTab === 'wallets' && <WalletsTab token={token} />}
    </div>
  );
}
