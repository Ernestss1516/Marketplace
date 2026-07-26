'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { updateMe } from '@/lib/api/usuarios';
import { isValidFiscalTaxId } from '@/lib/fiscal';
import type { FiscalEntityType, User } from '@/types';

type Status = 'idle' | 'saving' | 'success' | 'error';

interface Props {
  initialUser: User;
  token: string;
}

const ENTITY_OPTIONS: { value: FiscalEntityType; label: string }[] = [
  { value: 'INDIVIDUAL', label: 'Particular' },
  { value: 'SELF_EMPLOYED', label: 'Autónomo' },
  { value: 'COMPANY', label: 'Empresa' },
];

export function FacturacionForm({ initialUser, token }: Props) {
  const router = useRouter();
  const [fields, setFields] = useState({
    fiscalTaxId: initialUser.fiscalTaxId ?? '',
    fiscalName: initialUser.fiscalName ?? '',
    fiscalEntityType: (initialUser.fiscalEntityType ?? '') as FiscalEntityType | '',
    fiscalAddress: initialUser.fiscalAddress ?? '',
    fiscalCity: initialUser.fiscalCity ?? '',
    fiscalPostalCode: initialUser.fiscalPostalCode ?? '',
    fiscalProvince: initialUser.fiscalProvince ?? '',
    fiscalCountry: initialUser.fiscalCountry ?? 'ES',
  });
  const [status, setStatus] = useState<Status>('idle');
  const [taxIdError, setTaxIdError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isSaving = isPending || status === 'saving';

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setFields((prev) => ({ ...prev, [name]: value }));
    if (status !== 'idle') setStatus('idle');
    if (name === 'fiscalTaxId') setTaxIdError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const taxId = fields.fiscalTaxId.trim();
    if (taxId && !isValidFiscalTaxId(taxId)) {
      setTaxIdError('El NIF/DNI/NIE/CIF no tiene un formato válido.');
      return;
    }

    setStatus('saving');
    startTransition(async () => {
      try {
        await updateMe(
          {
            fiscalTaxId: taxId || undefined,
            fiscalName: fields.fiscalName.trim() || undefined,
            fiscalEntityType: fields.fiscalEntityType || undefined,
            fiscalAddress: fields.fiscalAddress.trim() || undefined,
            fiscalCity: fields.fiscalCity.trim() || undefined,
            fiscalPostalCode: fields.fiscalPostalCode.trim() || undefined,
            fiscalProvince: fields.fiscalProvince.trim() || undefined,
            fiscalCountry: fields.fiscalCountry.trim().toUpperCase() || undefined,
          },
          token,
        );
        setStatus('success');
        router.refresh();
      } catch {
        setStatus('error');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Estos datos se usan para emitir tus facturas. Se guardan en cada factura tal como estén en
        el momento de emitirla: si los cambias después, las facturas ya emitidas conservan los datos
        anteriores.
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="fiscalTaxId">NIF / DNI / CIF</Label>
          <Input
            id="fiscalTaxId"
            name="fiscalTaxId"
            value={fields.fiscalTaxId}
            onChange={handleChange}
            maxLength={20}
            aria-invalid={Boolean(taxIdError)}
            autoComplete="off"
          />
          {taxIdError && <p className="text-xs text-destructive">{taxIdError}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fiscalEntityType">Tipo</Label>
          <Select
            value={fields.fiscalEntityType}
            onValueChange={(v) => {
              setFields((prev) => ({ ...prev, fiscalEntityType: v as FiscalEntityType }));
              if (status !== 'idle') setStatus('idle');
            }}
          >
            <SelectTrigger id="fiscalEntityType">
              <SelectValue placeholder="Selecciona…" />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="fiscalName">Nombre fiscal o razón social</Label>
          <Input
            id="fiscalName"
            name="fiscalName"
            value={fields.fiscalName}
            onChange={handleChange}
            maxLength={150}
            placeholder="Nombre y apellidos, o razón social de la empresa"
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="fiscalAddress">Dirección fiscal</Label>
          <Input
            id="fiscalAddress"
            name="fiscalAddress"
            value={fields.fiscalAddress}
            onChange={handleChange}
            maxLength={200}
            placeholder="Vía y número"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fiscalCity">Ciudad</Label>
          <Input
            id="fiscalCity"
            name="fiscalCity"
            value={fields.fiscalCity}
            onChange={handleChange}
            maxLength={100}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fiscalProvince">Provincia</Label>
          <Input
            id="fiscalProvince"
            name="fiscalProvince"
            value={fields.fiscalProvince}
            onChange={handleChange}
            maxLength={100}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fiscalPostalCode">Código postal</Label>
          <Input
            id="fiscalPostalCode"
            name="fiscalPostalCode"
            value={fields.fiscalPostalCode}
            onChange={handleChange}
            maxLength={10}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fiscalCountry">País (ISO)</Label>
          <Input
            id="fiscalCountry"
            name="fiscalCountry"
            value={fields.fiscalCountry}
            onChange={handleChange}
            maxLength={2}
            placeholder="ES"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={isSaving}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar datos de facturación
        </Button>

        {status === 'success' && (
          <p className="text-sm text-green-600">Datos de facturación guardados.</p>
        )}
        {status === 'error' && (
          <p className="text-sm text-destructive">Error al guardar. Inténtalo de nuevo.</p>
        )}
      </div>
    </form>
  );
}
