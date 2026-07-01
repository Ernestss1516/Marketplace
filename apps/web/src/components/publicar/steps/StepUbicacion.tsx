'use client';

import { AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MunicipioAutocomplete } from '@/components/municipio/MunicipioAutocomplete';

export interface UbicacionData {
  city: string;
  province: string;
  postalCode: string;
}

interface StepUbicacionProps {
  data: UbicacionData;
  onChange: (updates: Partial<UbicacionData>) => void;
  errors: Record<string, string>;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
      <AlertCircle className="h-3 w-3 shrink-0" />
      {message}
    </p>
  );
}

export function StepUbicacion({ data, onChange, errors }: StepUbicacionProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Ubicación</h2>
        <p className="text-sm text-muted-foreground">
          Solo se muestra la zona aproximada, nunca la dirección exacta.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="city">Ciudad *</Label>
        <MunicipioAutocomplete
          id="city"
          value={data.city}
          placeholder="p. ej. Madrid"
          aria-invalid={Boolean(errors.city)}
          data-testid="city-autocomplete"
          onChange={(city, province) => {
            onChange({ city, ...(province !== undefined && { province }) });
          }}
        />
        <FieldError message={errors.city} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="province">Provincia *</Label>
        <Input
          id="province"
          value={data.province}
          placeholder="Se rellena al seleccionar municipio"
          onChange={(e) => onChange({ province: e.target.value })}
          aria-invalid={Boolean(errors.province)}
        />
        <FieldError message={errors.province} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="postalCode">Código postal</Label>
        <Input
          id="postalCode"
          value={data.postalCode}
          placeholder="p. ej. 28001"
          maxLength={10}
          onChange={(e) => onChange({ postalCode: e.target.value })}
        />
      </div>
    </div>
  );
}
