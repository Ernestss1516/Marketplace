'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import { getFiscalIssuer, updateFiscalIssuer, type FiscalIssuer } from '@/lib/api/admin-facturas';
import { ApiError } from '@/lib/api/client';
import { isValidFiscalTaxId } from '@/lib/fiscal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SesionNoDisponible } from '@/app/(admin)/components/SesionNoDisponible';

type Status = 'idle' | 'saving' | 'success' | 'error';

const EMPTY: FiscalIssuer = {
  taxId: '',
  fiscalName: '',
  address: '',
  city: '',
  postalCode: '',
  province: '',
  country: 'ES',
};

export default function EmisorFiscalPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [fields, setFields] = useState<FiscalIssuer>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [taxIdError, setTaxIdError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getFiscalIssuer(token)
      .then((r) => {
        if (r.issuer) setFields({ ...EMPTY, ...r.issuer });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [token]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setFields((prev) => ({ ...prev, [name]: value }));
    if (status !== 'idle') setStatus('idle');
    if (name === 'taxId') setTaxIdError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    const taxId = fields.taxId.trim();
    if (!isValidFiscalTaxId(taxId)) {
      setTaxIdError('El NIF/CIF del emisor no tiene un formato válido.');
      return;
    }

    setStatus('saving');
    setErrorMsg(null);
    try {
      await updateFiscalIssuer(token, {
        taxId,
        fiscalName: fields.fiscalName.trim(),
        address: fields.address.trim(),
        city: fields.city.trim(),
        postalCode: fields.postalCode.trim(),
        province: fields.province.trim(),
        country: fields.country.trim().toUpperCase(),
      });
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof ApiError ? err.message : 'Error al guardar el emisor fiscal.');
    }
  }

  if (!token) {
    return (
      <SesionNoDisponible />
    );
  }

  return (
    <div className="max-w-2xl">
      <Link href="/admin/facturas" className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="mr-1 h-4 w-4" />
        Volver a facturas
      </Link>

      <h1 className="mb-1 text-2xl font-bold">Emisor fiscal</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Datos fiscales de la plataforma como emisora de las facturas.
      </p>

      {/* Aviso de NO retroactividad — inmutabilidad fiscal */}
      <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          Este emisor se aplica <strong>solo a las facturas que se emitan a partir de ahora</strong>. Las
          facturas ya emitidas conservan su emisor y no se modifican (inmutabilidad fiscal).
        </span>
      </div>

      {!loaded ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="taxId">NIF / CIF</Label>
              <Input id="taxId" name="taxId" value={fields.taxId} onChange={handleChange} maxLength={20} aria-invalid={Boolean(taxIdError)} autoComplete="off" />
              {taxIdError && <p className="text-xs text-destructive">{taxIdError}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fiscalName">Razón social</Label>
              <Input id="fiscalName" name="fiscalName" value={fields.fiscalName} onChange={handleChange} maxLength={150} required />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address">Dirección</Label>
              <Input id="address" name="address" value={fields.address} onChange={handleChange} maxLength={200} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">Ciudad</Label>
              <Input id="city" name="city" value={fields.city} onChange={handleChange} maxLength={100} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="province">Provincia</Label>
              <Input id="province" name="province" value={fields.province} onChange={handleChange} maxLength={100} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="postalCode">Código postal</Label>
              <Input id="postalCode" name="postalCode" value={fields.postalCode} onChange={handleChange} maxLength={10} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="country">País (ISO)</Label>
              <Input id="country" name="country" value={fields.country} onChange={handleChange} maxLength={2} placeholder="ES" required />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button type="submit" disabled={status === 'saving'}>
              {status === 'saving' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar emisor
            </Button>
            {status === 'success' && <p className="text-sm text-green-600">Emisor fiscal guardado.</p>}
            {status === 'error' && <p className="text-sm text-destructive">{errorMsg}</p>}
          </div>
        </form>
      )}
    </div>
  );
}
