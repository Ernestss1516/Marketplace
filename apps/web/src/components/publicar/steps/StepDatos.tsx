'use client';

import { AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ListingType, Condition, PriceType } from '@/types';

export type PriceMode = 'fixed' | 'free' | 'negotiable';

export interface DatosData {
  title: string;
  description: string;
  type: ListingType | '';
  condition: Condition | '';
  priceMode: PriceMode;
  price: string;
}

interface StepDatosProps {
  data: DatosData;
  onChange: (updates: Partial<DatosData>) => void;
  errors: Record<string, string>;
}

const CONDITION_OPTIONS: { value: Condition; label: string }[] = [
  { value: 'NEW', label: 'Nuevo' },
  { value: 'LIKE_NEW', label: 'Como nuevo' },
  { value: 'GOOD', label: 'Buen estado' },
  { value: 'FAIR', label: 'Aceptable' },
  { value: 'FOR_PARTS', label: 'Para piezas' },
];

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
      <AlertCircle className="h-3 w-3 shrink-0" />
      {message}
    </p>
  );
}

export function priceTypeFromMode(mode: PriceMode): PriceType {
  if (mode === 'free') return 'FREE';
  if (mode === 'negotiable') return 'NEGOTIABLE';
  return 'FIXED';
}

export function StepDatos({ data, onChange, errors }: StepDatosProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Datos del anuncio</h2>
        <p className="text-sm text-muted-foreground">
          Describe tu artículo con claridad para atraer compradores.
        </p>
      </div>

      {/* Título */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="title">Título *</Label>
          <span className="text-xs text-muted-foreground">{data.title.length}/100</span>
        </div>
        <Input
          id="title"
          value={data.title}
          maxLength={100}
          placeholder="p. ej. iPhone 14 Pro 256 GB negro"
          onChange={(e) => onChange({ title: e.target.value })}
          aria-invalid={Boolean(errors.title)}
        />
        <FieldError message={errors.title} />
      </div>

      {/* Descripción */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="description">Descripción *</Label>
          <span className="text-xs text-muted-foreground">{data.description.length}/4000</span>
        </div>
        <Textarea
          id="description"
          value={data.description}
          maxLength={4000}
          rows={5}
          placeholder="Describe el estado, características y motivo de venta…"
          onChange={(e) => onChange({ description: e.target.value })}
          aria-invalid={Boolean(errors.description)}
        />
        <FieldError message={errors.description} />
      </div>

      {/* Tipo */}
      <div className="space-y-1.5">
        <Label>Tipo *</Label>
        <RadioGroup
          value={data.type}
          onValueChange={(v) =>
            onChange({
              type: v as ListingType,
              condition: v === 'SERVICE' ? '' : data.condition,
            })
          }
          className="flex gap-6"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="PRODUCT" id="type-product" />
            <Label htmlFor="type-product" className="cursor-pointer font-normal">
              Producto
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="SERVICE" id="type-service" />
            <Label htmlFor="type-service" className="cursor-pointer font-normal">
              Servicio
            </Label>
          </div>
        </RadioGroup>
        <FieldError message={errors.type} />
      </div>

      {/* Condición (solo productos) */}
      {data.type === 'PRODUCT' && (
        <div className="space-y-1.5">
          <Label htmlFor="condition">Estado / condición *</Label>
          <Select
            value={data.condition}
            onValueChange={(v) => onChange({ condition: v as Condition })}
          >
            <SelectTrigger id="condition" aria-invalid={Boolean(errors.condition)}>
              <SelectValue placeholder="Selecciona el estado…" />
            </SelectTrigger>
            <SelectContent>
              {CONDITION_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError message={errors.condition} />
        </div>
      )}

      {/* Precio */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Precio *</legend>

        <RadioGroup
          value={data.priceMode}
          onValueChange={(v) => onChange({ priceMode: v as PriceMode })}
          className="flex flex-wrap gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="fixed" id="price-fixed" />
            <Label htmlFor="price-fixed" className="cursor-pointer font-normal">
              Precio fijo
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="free" id="price-free" />
            <Label htmlFor="price-free" className="cursor-pointer font-normal">
              Gratis
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="negotiable" id="price-negotiable" />
            <Label htmlFor="price-negotiable" className="cursor-pointer font-normal">
              A convenir
            </Label>
          </div>
        </RadioGroup>

        {data.priceMode === 'fixed' && (
          <div className="flex items-center gap-2">
            <div className="relative w-40">
              <Input
                id="price"
                type="number"
                min="0.01"
                step="0.01"
                value={data.price}
                placeholder="0,00"
                onChange={(e) => onChange({ price: e.target.value })}
                aria-invalid={Boolean(errors.price)}
                className="pr-10"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                €
              </span>
            </div>
            <FieldError message={errors.price} />
          </div>
        )}
      </fieldset>
    </div>
  );
}
