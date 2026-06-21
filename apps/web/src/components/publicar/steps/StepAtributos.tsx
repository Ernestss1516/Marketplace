'use client';

import { AlertCircle } from 'lucide-react';
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
import type { AttributeSchema } from '@/types';

interface StepAtributosProps {
  schema: AttributeSchema[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
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

export function StepAtributos({ schema, values, onChange, errors }: StepAtributosProps) {
  if (schema.length === 0) {
    return (
      <div className="space-y-2 py-4 text-center text-sm text-muted-foreground">
        <p>Esta categoría no requiere atributos adicionales.</p>
      </div>
    );
  }

  function set(name: string, value: string) {
    onChange({ ...values, [name]: value });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Atributos</h2>
        <p className="text-sm text-muted-foreground">
          Completa los detalles específicos de esta categoría.
        </p>
      </div>

      {schema.map((field) => {
        const id = `attr-${field.name}`;
        const value = values[field.name] ?? '';
        const error = errors[field.name];
        const label = `${field.label}${field.required ? ' *' : ''}`;

        if (field.type === 'boolean') {
          return (
            <div key={field.name} className="flex items-center gap-3">
              <Checkbox
                id={id}
                checked={value === 'true'}
                onCheckedChange={(checked) => set(field.name, String(checked))}
              />
              <Label htmlFor={id} className="cursor-pointer font-normal">
                {field.label}
              </Label>
              <FieldError message={error} />
            </div>
          );
        }

        if (field.type === 'select') {
          return (
            <div key={field.name} className="space-y-1.5">
              <Label htmlFor={id}>{label}</Label>
              <Select value={value} onValueChange={(v) => set(field.name, v)}>
                <SelectTrigger id={id} aria-invalid={Boolean(error)}>
                  <SelectValue placeholder={`Selecciona ${field.label.toLowerCase()}…`} />
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={error} />
            </div>
          );
        }

        // text or number
        return (
          <div key={field.name} className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            <div className="flex items-center gap-2">
              <Input
                id={id}
                type={field.type === 'number' ? 'number' : 'text'}
                value={value}
                onChange={(e) => set(field.name, e.target.value)}
                aria-invalid={Boolean(error)}
                className={field.unit ? 'max-w-[200px]' : undefined}
              />
              {field.unit && (
                <span className="text-sm text-muted-foreground">{field.unit}</span>
              )}
            </div>
            <FieldError message={error} />
          </div>
        );
      })}
    </div>
  );
}
