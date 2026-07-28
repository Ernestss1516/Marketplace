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
import type { ListingType, Condition, PriceType, PriceUnit } from '@/types';

export type PriceMode = 'fixed' | 'free' | 'negotiable';

export interface DatosData {
  title: string;
  description: string;
  type: ListingType | '';
  condition: Condition | '';
  priceMode: PriceMode;
  price: string;
  /** RP.3 — formato del precio. Siempre tiene valor (ONE_TIME por defecto), aunque
   *  el selector no se muestre: así el wizard envía algo coherente sin ramas. */
  priceUnit: PriceUnit;
}

interface StepDatosProps {
  data: DatosData;
  onChange: (updates: Partial<DatosData>) => void;
  errors: Record<string, string>;
  /** true en edición: el tipo ya no se puede cambiar tras crear el anuncio. */
  readOnlyType?: boolean;
  /** RP.3 — formatos EFECTIVOS de la categoría elegida (ya resueltos por el
   *  backend en GET /categories/:slug). Con uno solo o ninguno, el selector no
   *  se renderiza: toda categoría sin configurar (todas las de hoy) resuelve a
   *  [ONE_TIME] y ve el formulario exactamente igual que antes de RP.3. */
  allowedPriceUnits?: PriceUnit[];
}

const TYPE_LABELS: Record<ListingType, string> = {
  PRODUCT: 'Producto',
  SERVICE: 'Servicio',
};

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

/** Etiquetas ES de los formatos — las mismas que PRICE_UNIT_OPTIONS del panel
 *  de categorías (RP.2), para que admin y vendedor lean lo mismo. */
export const PRICE_UNIT_LABELS: Record<PriceUnit, string> = {
  ONE_TIME: 'Pago único',
  PER_MONTH: 'Al mes',
  PER_WEEK: 'A la semana',
  PER_DAY: 'Al día',
  PER_HOUR: 'Por hora',
  PER_UNIT: 'Por unidad',
  PER_SESSION: 'Por sesión',
};

/**
 * Elige qué formato debe quedar seleccionado (RP.3). Preferencias, en orden:
 * el actual si la categoría lo permite (edición: no se cambia lo que el
 * vendedor ya eligió), ONE_TIME si está permitido, y si no el primero de la
 * lista. Nunca devuelve un formato fuera de `allowed` salvo que la lista venga
 * vacía, donde ONE_TIME es el mismo default que aplica el backend.
 *
 * Pura: el wizard la llama al elegir categoría y al montar la edición.
 */
export function resolvePriceUnitSelection(
  allowed: PriceUnit[],
  current?: PriceUnit,
): PriceUnit {
  if (current && allowed.includes(current)) return current;
  if (allowed.includes('ONE_TIME')) return 'ONE_TIME';
  return allowed[0] ?? 'ONE_TIME';
}

/** Selector de formato. Extraído para que las ramas "precio fijo" y "a convenir"
 *  compartan exactamente el mismo control sin duplicarlo. */
function PriceUnitSelect({
  value,
  units,
  onChange,
}: {
  value: PriceUnit;
  units: PriceUnit[];
  onChange: (updates: Partial<DatosData>) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange({ priceUnit: v as PriceUnit })}>
      <SelectTrigger className="w-40" aria-label="Formato del precio" data-testid="price-unit-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {units.map((unit) => (
          <SelectItem key={unit} value={unit}>
            {PRICE_UNIT_LABELS[unit]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function StepDatos({
  data,
  onChange,
  errors,
  readOnlyType = false,
  allowedPriceUnits,
}: StepDatosProps) {
  const units = allowedPriceUnits ?? [];
  // Con 0 o 1 formato no hay nada que elegir: no se pregunta. Esto es lo que
  // mantiene el formulario idéntico al de siempre en toda categoría sin
  // configurar (efectivo [ONE_TIME]) — ver §6.1 del diseño.
  const showUnitSelector = units.length > 1;

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
        {readOnlyType ? (
          <div>
            <p className="text-sm font-medium">
              {data.type ? TYPE_LABELS[data.type] : '—'}
            </p>
            <p className="text-xs text-muted-foreground">
              El tipo no se puede cambiar tras crear el anuncio.
            </p>
          </div>
        ) : (
          <>
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
          </>
        )}
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
            {showUnitSelector && <PriceUnitSelect value={data.priceUnit} units={units} onChange={onChange} />}
            <FieldError message={errors.price} />
          </div>
        )}

        {/* "A convenir" no lleva importe, pero sí puede llevar formato: un
            alquiler «a convenir, al mes» es un caso real (decisión aprobada,
            §7.1 del diseño). "Gratis" nunca lleva formato. */}
        {data.priceMode === 'negotiable' && showUnitSelector && (
          <div className="flex items-center gap-2">
            <PriceUnitSelect value={data.priceUnit} units={units} onChange={onChange} />
          </div>
        )}
      </fieldset>
    </div>
  );
}
