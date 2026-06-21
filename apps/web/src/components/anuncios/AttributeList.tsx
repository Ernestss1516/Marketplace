import type { AttributeSchema } from '@/types';

function formatValue(value: unknown, schema: AttributeSchema): string {
  if (schema.type === 'boolean') return value ? 'Sí' : 'No';
  const str = String(value);
  return schema.unit ? `${str} ${schema.unit}` : str;
}

export function AttributeList({
  schema,
  values,
}: {
  schema: AttributeSchema[];
  values: Record<string, unknown>;
}) {
  const visible = schema.filter(
    (s) => values[s.name] !== undefined && values[s.name] !== null && values[s.name] !== '',
  );

  if (visible.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">Características</h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {visible.map((s) => (
          <div key={s.name} className="rounded-md bg-muted/50 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="mt-0.5 text-sm font-medium">{formatValue(values[s.name], s)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
