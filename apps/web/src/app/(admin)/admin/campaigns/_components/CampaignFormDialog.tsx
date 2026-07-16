'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api/client';
import { getCatalog, type CatalogResponse } from '@/lib/api/billing';
import {
  createAdminCampaign,
  updateAdminCampaign,
  ACTION_DISCOUNT_PERCENT_MIN,
  ACTION_DISCOUNT_PERCENT_MAX,
  CREDIT_BONUS_VALUE_MIN,
  CREDIT_BONUS_PERCENT_MAX,
  CREDIT_BONUS_FIXED_MAX,
  type AdminCampaign,
  type CampaignType,
  type CreditBonusKind,
  type ActionDiscountAction,
} from '@/lib/api/admin-campaigns';
import { applyActionDiscount, applyCreditBonus } from '@/lib/campaigns/effect-preview';

interface Props {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = crear; con valor = editar esa campaña. */
  campaign: AdminCampaign | null;
  onSuccess: () => void;
}

const FEATURED_DURATIONS = [7, 14, 30] as const;

/** yyyy-MM-ddThh:mm — formato que espera <input type="datetime-local">. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function actionLabel(action: ActionDiscountAction): string {
  return action === 'BUMP' ? 'bumps' : 'destacados';
}

export function CampaignFormDialog({ token, open, onOpenChange, campaign, onSuccess }: Props) {
  const isEdit = campaign != null;

  const [name, setName] = useState('');
  const [type, setType] = useState<CampaignType>('ACTION_DISCOUNT');
  const [kind, setKind] = useState<CreditBonusKind>('PERCENT');
  const [value, setValue] = useState('');
  const [action, setAction] = useState<ActionDiscountAction>('BUMP');
  const [percent, setPercent] = useState('');
  const [active, setActive] = useState(true);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (campaign) {
      setName(campaign.name);
      setType(campaign.type);
      if (campaign.type === 'CREDIT_BONUS') {
        setKind((campaign.params as { kind: CreditBonusKind }).kind);
        setValue(String((campaign.params as { value: number }).value));
      } else {
        setAction((campaign.params as { action: ActionDiscountAction }).action);
        setPercent(String((campaign.params as { percent: number }).percent));
      }
      setActive(campaign.active);
      setStartsAt(toLocalInput(campaign.startsAt));
      setEndsAt(toLocalInput(campaign.endsAt));
    } else {
      setName('');
      setType('ACTION_DISCOUNT');
      setKind('PERCENT');
      setValue('');
      setAction('BUMP');
      setPercent('');
      setActive(true);
      setStartsAt('');
      setEndsAt('');
    }
  }, [open, campaign]);

  // Catálogo público — base para la vista previa del efecto (mismos números
  // que ya usa /billing/catalog, no recalculados desde Settings a mano).
  useEffect(() => {
    if (!open) return;
    getCatalog()
      .then(setCatalog)
      .catch(() => setCatalog(null));
  }, [open]);

  /** Validación de front — el back sigue siendo quien de verdad protege. */
  function validationError(): string | null {
    if (!name.trim()) return 'El nombre es obligatorio.';
    if (!startsAt || !endsAt) return 'Las fechas de inicio y fin son obligatorias.';
    if (new Date(endsAt) <= new Date(startsAt)) return 'La fecha de fin debe ser posterior a la de inicio.';

    if (type === 'CREDIT_BONUS') {
      const v = Number(value);
      if (!value.trim() || !Number.isInteger(v) || v < CREDIT_BONUS_VALUE_MIN) {
        return `El valor debe ser un número entero de al menos ${CREDIT_BONUS_VALUE_MIN}.`;
      }
      const max = kind === 'PERCENT' ? CREDIT_BONUS_PERCENT_MAX : CREDIT_BONUS_FIXED_MAX;
      if (v > max) {
        return `El valor no puede superar ${max.toLocaleString('es-ES')}${kind === 'PERCENT' ? '%' : ' créditos'}.`;
      }
    } else {
      const p = Number(percent);
      if (!percent.trim() || !Number.isInteger(p) || p < ACTION_DISCOUNT_PERCENT_MIN || p > ACTION_DISCOUNT_PERCENT_MAX) {
        return `El descuento debe ser un entero entre ${ACTION_DISCOUNT_PERCENT_MIN} y ${ACTION_DISCOUNT_PERCENT_MAX}.`;
      }
    }
    return null;
  }

  async function handleSubmit() {
    const validation = validationError();
    if (validation) {
      setError(validation);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const startsAtIso = new Date(startsAt).toISOString();
      const endsAtIso = new Date(endsAt).toISOString();
      const params = type === 'CREDIT_BONUS'
        ? { kind, value: Number(value) }
        : { action, percent: Number(percent) };

      if (isEdit) {
        await updateAdminCampaign(token, campaign!.id, {
          name,
          active,
          startsAt: startsAtIso,
          endsAt: endsAtIso,
          params,
        });
      } else {
        await createAdminCampaign(token, {
          name,
          type,
          active,
          startsAt: startsAtIso,
          endsAt: endsAtIso,
          params,
        });
      }
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CAMPAIGN_OVERLAP') {
        const what = type === 'CREDIT_BONUS' ? 'de bonus de créditos' : `de descuento en ${actionLabel(action)}`;
        setError(
          `Ya existe una campaña ${what} activa que se solapa en esas fechas. ` +
          'Desactívala o ajusta las fechas de esta campaña.',
        );
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Error al guardar la campaña.');
      }
    } finally {
      setBusy(false);
    }
  }

  const preview = useMemo(() => {
    if (!catalog) return null;

    if (type === 'ACTION_DISCOUNT') {
      const p = Number(percent);
      if (!percent.trim() || !Number.isInteger(p) || p < ACTION_DISCOUNT_PERCENT_MIN || p > ACTION_DISCOUNT_PERCENT_MAX) {
        return null;
      }
      if (action === 'BUMP') {
        const base = catalog.bumpOriginalCreditCost ?? catalog.bumpCreditCost;
        return [`Bump: ${applyActionDiscount(base, p)} créditos (antes ${base})`];
      }
      const featuredProduct = catalog.products.find((prod) => prod.prices.some((pr) => pr.durationDays != null));
      const lines: string[] = [];
      for (const days of FEATURED_DURATIONS) {
        const price = featuredProduct?.prices.find((pr) => pr.durationDays === days);
        const base = price?.originalCreditCost ?? price?.creditCost;
        if (base != null) {
          lines.push(`Destacado ${days}d: ${applyActionDiscount(base, p)} créditos (antes ${base})`);
        }
      }
      return lines.length > 0 ? lines : null;
    }

    const v = Number(value);
    if (!value.trim() || !Number.isInteger(v) || v < CREDIT_BONUS_VALUE_MIN) return null;
    const max = kind === 'PERCENT' ? CREDIT_BONUS_PERCENT_MAX : CREDIT_BONUS_FIXED_MAX;
    if (v > max) return null;

    const packs = catalog.products
      .flatMap((prod) => prod.prices)
      .filter((pr) => pr.creditAmount != null)
      .sort((a, b) => (a.creditAmount ?? 0) - (b.creditAmount ?? 0));
    if (packs.length === 0) return null;
    return packs.map((pack) => {
      const total = applyCreditBonus(pack.creditAmount!, kind, v);
      return `${pack.packName ?? 'Pack'} (${pack.creditAmount} créditos) → recibirá ${total} créditos`;
    });
  }, [catalog, type, action, percent, kind, value]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Editar campaña "${campaign!.name}"` : 'Nueva campaña'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="campaign-name">Nombre</Label>
            <Input
              id="campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="p. ej. Descuento bump verano"
            />
          </div>

          <div>
            <Label htmlFor="campaign-type">Tipo</Label>
            {isEdit ? (
              <p className="text-sm text-muted-foreground">
                {type === 'CREDIT_BONUS' ? 'Bonus de créditos' : 'Descuento en bump/destacado'}
                {' '}(no se puede cambiar tras crear)
              </p>
            ) : (
              <Select value={type} onValueChange={(v) => setType(v as CampaignType)}>
                <SelectTrigger id="campaign-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTION_DISCOUNT">Descuento en bump/destacado</SelectItem>
                  <SelectItem value="CREDIT_BONUS">Bonus de créditos</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {type === 'CREDIT_BONUS' ? (
            <>
              <div>
                <Label htmlFor="campaign-kind">Tipo de bonus</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as CreditBonusKind)}>
                  <SelectTrigger id="campaign-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENT">Porcentaje sobre el pack</SelectItem>
                    <SelectItem value="FIXED">Cantidad fija de créditos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="campaign-value">
                  {kind === 'PERCENT' ? 'Porcentaje de bonus' : 'Créditos de bonus'}
                </Label>
                <Input
                  id="campaign-value"
                  type="number"
                  min={CREDIT_BONUS_VALUE_MIN}
                  max={kind === 'PERCENT' ? CREDIT_BONUS_PERCENT_MAX : CREDIT_BONUS_FIXED_MAX}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Entre {CREDIT_BONUS_VALUE_MIN} y{' '}
                  {(kind === 'PERCENT' ? CREDIT_BONUS_PERCENT_MAX : CREDIT_BONUS_FIXED_MAX).toLocaleString('es-ES')}
                  {kind === 'PERCENT' ? '%' : ' créditos'}. Se suma al bonus Pro si el comprador es Pro (no lo sustituye).
                </p>
              </div>
            </>
          ) : (
            <>
              <div>
                <Label htmlFor="campaign-action">Acción con descuento</Label>
                <Select value={action} onValueChange={(v) => setAction(v as ActionDiscountAction)}>
                  <SelectTrigger id="campaign-action">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BUMP">Bump (pagado con créditos)</SelectItem>
                    <SelectItem value="FEATURED">Destacado (pagado con créditos)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Solo afecta al pago con créditos — nunca al pago directo con tarjeta, ni a la cuota
                  Pro, ni al saldo de bumps (esos ya son gratis o tienen su propio precio en euros).
                </p>
              </div>
              <div>
                <Label htmlFor="campaign-percent">Porcentaje de descuento</Label>
                <Input
                  id="campaign-percent"
                  type="number"
                  min={ACTION_DISCOUNT_PERCENT_MIN}
                  max={ACTION_DISCOUNT_PERCENT_MAX}
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Entre {ACTION_DISCOUNT_PERCENT_MIN} y {ACTION_DISCOUNT_PERCENT_MAX}%.
                </p>
              </div>
            </>
          )}

          {preview && (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Vista previa del efecto</p>
              <ul className="space-y-0.5 text-sm">
                {preview.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="campaign-starts-at">Empieza</Label>
              <Input
                id="campaign-starts-at"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="campaign-ends-at">Termina</Label>
              <Input
                id="campaign-ends-at"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="campaign-active"
              checked={active}
              onCheckedChange={(checked) => setActive(checked === true)}
            />
            <Label htmlFor="campaign-active" className="cursor-pointer">
              Activa
            </Label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {isEdit ? 'Guardar cambios' : 'Crear campaña'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
