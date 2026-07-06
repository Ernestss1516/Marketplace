'use client';

import { useEffect, useState } from 'react';
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
import {
  createAdminCoupon,
  updateAdminCoupon,
  type AdminCoupon,
  type CouponRewardType,
} from '@/lib/api/admin-coupons';

interface Props {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = crear; con valor = editar ese cupón. */
  coupon: AdminCoupon | null;
  onSuccess: () => void;
}

/** yyyy-MM-ddThh:mm — formato que espera <input type="datetime-local">. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CouponFormDialog({ token, open, onOpenChange, coupon, onSuccess }: Props) {
  const isEdit = coupon != null;

  const [code, setCode] = useState('');
  const [rewardType, setRewardType] = useState<CouponRewardType>('CREDITS');
  const [creditAmount, setCreditAmount] = useState('');
  const [featuredDurationDays, setFeaturedDurationDays] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [active, setActive] = useState(true);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (coupon) {
      setCode(coupon.code);
      setRewardType(coupon.rewardType);
      setCreditAmount(coupon.creditAmount != null ? String(coupon.creditAmount) : '');
      setFeaturedDurationDays(
        coupon.featuredDurationDays != null ? String(coupon.featuredDurationDays) : '',
      );
      setMaxRedemptions(coupon.maxRedemptions != null ? String(coupon.maxRedemptions) : '');
      setActive(coupon.active);
      setStartsAt(toLocalInput(coupon.startsAt));
      setEndsAt(toLocalInput(coupon.endsAt));
    } else {
      setCode('');
      setRewardType('CREDITS');
      setCreditAmount('');
      setFeaturedDurationDays('');
      setMaxRedemptions('');
      setActive(true);
      setStartsAt('');
      setEndsAt('');
    }
  }, [open, coupon]);

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      const startsAtIso = new Date(startsAt).toISOString();
      const endsAtIso = new Date(endsAt).toISOString();
      const maxRedemptionsValue = maxRedemptions.trim() === '' ? null : Number(maxRedemptions);

      if (isEdit) {
        await updateAdminCoupon(token, coupon!.id, {
          active,
          startsAt: startsAtIso,
          endsAt: endsAtIso,
          maxRedemptions: maxRedemptionsValue,
          ...(rewardType === 'CREDITS' ? { creditAmount: Number(creditAmount) } : {}),
          ...(rewardType === 'FEATURED'
            ? { featuredDurationDays: Number(featuredDurationDays) }
            : {}),
        });
      } else {
        await createAdminCoupon(token, {
          code,
          rewardType,
          active,
          startsAt: startsAtIso,
          endsAt: endsAtIso,
          maxRedemptions: maxRedemptionsValue,
          ...(rewardType === 'CREDITS' ? { creditAmount: Number(creditAmount) } : {}),
          ...(rewardType === 'FEATURED'
            ? { featuredDurationDays: Number(featuredDurationDays) }
            : {}),
        });
      }
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'COUPON_CODE_TAKEN') {
        setError('Ya existe un cupón con ese código.');
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Error al guardar el cupón.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Editar cupón ${coupon!.code}` : 'Nuevo cupón'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!isEdit && (
            <div>
              <Label htmlFor="coupon-code">Código</Label>
              <Input
                id="coupon-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="p. ej. VERANO2026"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Se normaliza a MAYÚSCULAS. No se puede cambiar después de crear el cupón.
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="coupon-reward-type">Recompensa</Label>
            {isEdit ? (
              <p className="text-sm text-muted-foreground">
                {rewardType === 'CREDITS' ? 'Créditos' : 'Destacado'} (no se puede cambiar tras crear)
              </p>
            ) : (
              <Select value={rewardType} onValueChange={(v) => setRewardType(v as CouponRewardType)}>
                <SelectTrigger id="coupon-reward-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CREDITS">Créditos</SelectItem>
                  <SelectItem value="FEATURED">Destacado</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {rewardType === 'CREDITS' ? (
            <div>
              <Label htmlFor="coupon-credit-amount">Créditos a otorgar</Label>
              <Input
                id="coupon-credit-amount"
                type="number"
                min={1}
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
              />
            </div>
          ) : (
            <div>
              <Label htmlFor="coupon-featured-days">Días de destacado</Label>
              <Input
                id="coupon-featured-days"
                type="number"
                min={1}
                value={featuredDurationDays}
                onChange={(e) => setFeaturedDurationDays(e.target.value)}
              />
            </div>
          )}

          <div>
            <Label htmlFor="coupon-max-redemptions">Usos máximos</Label>
            <Input
              id="coupon-max-redemptions"
              type="number"
              min={1}
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value)}
              placeholder="Vacío = ilimitado"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="coupon-starts-at">Empieza</Label>
              <Input
                id="coupon-starts-at"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="coupon-ends-at">Termina</Label>
              <Input
                id="coupon-ends-at"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="coupon-active"
              checked={active}
              onCheckedChange={(checked) => setActive(checked === true)}
            />
            <Label htmlFor="coupon-active" className="cursor-pointer">
              Activo
            </Label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {isEdit ? 'Guardar cambios' : 'Crear cupón'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
