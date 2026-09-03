'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { AlertCircle, ArrowLeft, Loader2, PlusCircle } from 'lucide-react';
import {
  getAdminUserBillingDetail,
  grantAdminCredits,
  type AdminUserBillingDetail,
} from '@/lib/api/admin-billing';
import { ApiError } from '@/lib/api/client';
import type { CreditLedgerType } from '@/lib/api/billing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// ─── Labels ───────────────────────────────────────────────────────────────────

// I18N T3-B — idéntico en las dos pantallas de facturación.
import { ESTADO_TRANSACCION_LABELS as TX_STATUS_LABELS, PASARELA_LABELS } from '@/lib/etiquetas-enums';
import { SesionNoDisponible } from '@/app/(admin)/components/SesionNoDisponible';
import {
  MOVIMIENTO_CREDITO_ADMIN_LABELS,
  TIPO_DERECHO_LABELS,
} from '@/lib/etiquetas-enums';

const TX_STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  PENDING: 'secondary',
  SUCCEEDED: 'default',
  FAILED: 'destructive',
  REFUNDED: 'outline',
  PARTIALLY_REFUNDED: 'outline',
};

/**
 * I18N T2 (D8) — EL LIBRO MAYOR, CON SUS OCHO MOVIMIENTOS.
 *
 * Tenía SIETE de los ocho: faltaba `COUPON_REDEEM`, así que un cupón canjeado se
 * pintaba «COUPON_REDEEM» en el backoffice mientras el MISMO movimiento salía «Cupón
 * canjeado» en la pantalla de saldo de su dueño. El staff leía peor que el usuario
 * sobre el dinero del usuario.
 *
 * NO SE ARREGLA SÓLO AÑADIENDO LA CLAVE — así es como se perdió: el mapa era
 * `Record<string, string>` y el valor nuevo entró en `CreditLedgerType` sin que nada
 * se quejara. Al tiparlo contra la unión, **el próximo miembro del enum no compila**
 * hasta que alguien le escriba su etiqueta. Es la barrera de `PLACEMENT_LABELS` y la
 * de `Historiales.tsx`, que es justamente la copia que sí estaba completa.
 *
 * Las etiquetas propias se conservan («Subida», «Crédito admin»…): son el registro de
 * esta pantalla y unificarlas con las de la cuenta es la consolidación (T3), no esto.
 * Lo único que se escribe nuevo es el octavo texto, y se copia de allí.
 */
// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null) {
  if (!iso) return '—';
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

// ─── Credit grant form ────────────────────────────────────────────────────────

function CreditGrantForm({
  token,
  userId,
  onSuccess,
}: {
  token: string;
  userId: string;
  onSuccess: (newBalance: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function reset() {
    setAmount('');
    setReason('');
    setFormError(null);
    setOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(amount, 10);
    if (!n || n < 1 || n > 10000) {
      setFormError('El importe debe estar entre 1 y 10 000 créditos.');
      return;
    }
    if (reason.trim().length < 5) {
      setFormError('El motivo debe tener al menos 5 caracteres.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await grantAdminCredits(token, userId, { amount: n, reason: reason.trim() });
      onSuccess(result.balance);
      reset();
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? `Error ${err.statusCode}: ${err.message}`
          : 'Error al acreditar los créditos',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-1"
        onClick={() => setOpen(true)}
      >
        <PlusCircle className="h-4 w-4" />
        Acreditar créditos
      </Button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-primary/30 bg-primary/5 p-4"
    >
      <p className="mb-3 text-sm font-medium">Acreditar créditos manualmente</p>
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            Importe (1–10 000)
          </label>
          <input
            type="number"
            min={1}
            max={10000}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Ej. 100"
            required
            className="w-32 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1 min-w-[220px]">
          <label className="text-xs font-medium text-muted-foreground">
            Motivo (solo visible para admins)
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo de la acreditación..."
            minLength={5}
            maxLength={500}
            required
            className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirmar'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={submitting}>
            Cancelar
          </Button>
        </div>
      </div>
      {formError && (
        <div className="mt-2 flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {formError}
        </div>
      )}
    </form>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border">
      <div className="border-b bg-muted/50 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminUserBillingDetailPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [data, setData] = useState<AdminUserBillingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !params?.id) return;
    setLoading(true);
    setError(null);
    getAdminUserBillingDetail(token, params.id)
      .then(setData)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.statusCode === 404) {
          setError('Usuario no encontrado.');
        } else {
          setError(
            err instanceof ApiError
              ? `Error ${err.statusCode}: ${err.message}`
              : 'Error al cargar el detalle de facturación',
          );
        }
      })
      .finally(() => setLoading(false));
  }, [token, params?.id]);

  if (!token) {
    return (
      <SesionNoDisponible />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Cargando...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error}
      </div>
    );
  }

  if (!data) return null;

  function handleCreditGranted(newBalance: number) {
    // Refresh the full detail so the ledger shows the new ADMIN_CREDIT entry.
    if (!token || !params?.id) return;
    getAdminUserBillingDetail(token, params.id)
      .then(setData)
      .catch(() => {
        // Fallback: at least update the balance optimistically.
        setData((prev) =>
          prev && prev.wallet
            ? { ...prev, wallet: { ...prev.wallet, balance: newBalance } }
            : prev,
        );
      });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/admin/facturacion')}
          className="gap-1"
        >
          <ArrowLeft className="h-4 w-4" />
          Facturación
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{data.user.name}</h1>
          <p className="text-sm text-muted-foreground">{data.user.email}</p>
        </div>
      </div>

      {/* Wallet */}
      <Section title="Saldo (wallet)">
        {data.wallet === null ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Este usuario no tiene wallet.</p>
            <CreditGrantForm token={token} userId={data.user.id} onSuccess={handleCreditGranted} />
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-end gap-4">
              <div>
                <span className="text-3xl font-bold tabular-nums">{data.wallet.balance}</span>
                <span className="ml-2 text-muted-foreground">créditos</span>
              </div>
              <CreditGrantForm token={token} userId={data.user.id} onSuccess={handleCreditGranted} />
            </div>

            {data.wallet.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin movimientos.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 pr-4 font-medium text-muted-foreground">Tipo</th>
                      <th className="py-2 pr-4 font-medium text-muted-foreground">Importe</th>
                      <th className="py-2 pr-4 font-medium text-muted-foreground">Referencia</th>
                      <th className="py-2 font-medium text-muted-foreground">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.wallet.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="py-2 pr-4">
                          {/* El `as` + el `??` van juntos, y son la pareja de
                              `ticketStatusLabel`: `entry.type` llega como `string`
                              desde `lib/api/`, y una fila de un tipo retirado no debe
                              reventar la tabla — cae al valor crudo, el último recurso
                              VISIBLE. El tipado de arriba es lo que protege en
                              compilación; esto, lo que protege en ejecución. */}
                          {MOVIMIENTO_CREDITO_ADMIN_LABELS[entry.type as CreditLedgerType] ?? entry.type}
                        </td>
                        <td
                          className={[
                            'py-2 pr-4 tabular-nums font-medium',
                            entry.amount > 0 ? 'text-success-foreground' : 'text-destructive',
                          ].join(' ')}
                        >
                          {entry.amount > 0 ? '+' : ''}
                          {entry.amount}
                        </td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground">
                          {entry.referenceType ? `${entry.referenceType}` : '—'}
                          {entry.note && <span className="ml-1">· {entry.note}</span>}
                        </td>
                        <td className="py-2 text-muted-foreground">{formatDate(entry.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted-foreground">
                  Últimos {data.wallet.entries.length} movimientos.
                </p>
              </div>
            )}
          </>
        )}
      </Section>

      {/* Entitlements */}
      <Section title="Entitlements activos">
        {data.entitlements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin entitlements activos.</p>
        ) : (
          <div className="space-y-2">
            {data.entitlements.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm"
              >
                <Badge variant="default">
                  {TIPO_DERECHO_LABELS[e.type] ?? e.type}
                </Badge>
                <span className="text-muted-foreground">
                  Desde {formatDate(e.startsAt)}
                </span>
                {e.expiresAt && (
                  <span className="text-muted-foreground">
                    · Expira {formatDate(e.expiresAt)}
                  </span>
                )}
                {e.listingId && (
                  <span className="text-xs text-muted-foreground">
                    · Anuncio: {e.listingId}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Transactions */}
      <Section title="Últimas transacciones">
        {data.transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin transacciones.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4 font-medium text-muted-foreground">Pasarela</th>
                  <th className="py-2 pr-4 font-medium text-muted-foreground">Estado</th>
                  <th className="py-2 pr-4 text-right font-medium text-muted-foreground">Importe</th>
                  <th className="py-2 font-medium text-muted-foreground">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="py-2 pr-4">
                      <Badge variant="outline">{PASARELA_LABELS[tx.gateway] ?? tx.gateway}</Badge>
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant={TX_STATUS_VARIANTS[tx.status] ?? 'outline'}>
                        {TX_STATUS_LABELS[tx.status] ?? tx.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatAmount(tx.amountGross, tx.currency)}
                    </td>
                    <td className="py-2 text-muted-foreground">{formatDate(tx.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              Últimas {data.transactions.length} transacciones.
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}
