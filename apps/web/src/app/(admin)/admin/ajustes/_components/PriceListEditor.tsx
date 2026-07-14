'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import {
  getAdminPrices,
  updateAdminPrice,
  updateAdminCreditPackAmount,
  type AdminPrice,
} from '@/lib/api/admin-prices';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';

function formatEur(amount: number, currency: string) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(amount);
}

function PriceRow({
  price,
  token,
  creditCosts,
  onSaved,
}: {
  price: AdminPrice;
  token: string;
  creditCosts: Partial<Record<7 | 14 | 30, number>>;
  onSaved: (updated: AdminPrice) => void;
}) {
  const [amount, setAmount] = useState(String(price.amount));
  const [creditAmount, setCreditAmount] = useState(String(price.creditAmount ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const creditCost = price.durationDays != null
    ? creditCosts[price.durationDays as 7 | 14 | 30]
    : undefined;

  async function handleSave() {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('El importe debe ser mayor que 0€.');
      return;
    }
    let creditAmountNum: number | null = null;
    if (price.creditPackId) {
      creditAmountNum = parseInt(creditAmount, 10);
      if (isNaN(creditAmountNum) || creditAmountNum <= 0) {
        setError('Los créditos del pack deben ser un entero mayor que 0.');
        return;
      }
    }

    const label = price.creditPackId
      ? `Cambiar "${price.label}" a ${formatEur(amountNum, price.currency)} / ${creditAmountNum} créditos?`
      : `¿Cambiar "${price.label}" a ${formatEur(amountNum, price.currency)}?`;
    if (!window.confirm(label)) return;

    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      let updated = await updateAdminPrice(token, price.id, amountNum);
      if (price.creditPackId && creditAmountNum != null) {
        updated = await updateAdminCreditPackAmount(token, price.creditPackId, creditAmountNum);
      }
      setSuccess(true);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-md border bg-background p-4">
      <div className="min-w-[180px] flex-1">
        <p className="text-sm font-medium">{price.label}</p>
        {creditCost != null && (
          <p className="text-xs text-muted-foreground">
            Equivale a {creditCost} cr. pagando con saldo
          </p>
        )}
        {!price.active && <p className="text-xs text-destructive">Inactivo</p>}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Precio ({price.currency})</span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setSuccess(false); }}
          className="w-28 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={saving}
        />
      </label>

      {price.creditPackId && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Créditos otorgados</span>
          <input
            type="number"
            min="1"
            step="1"
            value={creditAmount}
            onChange={(e) => { setCreditAmount(e.target.value); setSuccess(false); }}
            className="w-28 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={saving}
          />
        </label>
      )}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
          Guardar
        </Button>
        {success && (
          <span className="flex items-center gap-1 text-xs text-green-700">
            <Check className="h-3 w-3" />
            Guardado
          </span>
        )}
        {error && (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" />
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

export function PriceListEditor({
  token,
  creditCosts,
}: {
  token: string;
  creditCosts: Partial<Record<7 | 14 | 30, number | undefined>>;
}) {
  const [prices, setPrices] = useState<AdminPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAdminPrices(token)
      .then((data) => { if (!cancelled) setPrices(data); })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Error al cargar precios');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  function handleSaved(updated: AdminPrice) {
    setPrices((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-md border bg-muted" />
        ))}
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

  return (
    <div className="space-y-3">
      {prices.map((price) => (
        <PriceRow
          key={price.id}
          price={price}
          token={token}
          creditCosts={creditCosts as Partial<Record<7 | 14 | 30, number>>}
          onSaved={handleSaved}
        />
      ))}
    </div>
  );
}
