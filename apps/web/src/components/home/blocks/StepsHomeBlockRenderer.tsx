import type { HomeStepsBlock } from '@/types/home-blocks';
import { Button } from '@/components/ui/button';
import { SmartLink } from '@/components/shared/SmartLink';
import { HOME_ICONS } from '../home-icons';

/**
 * "Cómo funciona": N columnas de pasos numerados, una por audiencia.
 * **Server Component, cero JS.**
 *
 * NO reusa el `StepsBlockRenderer` del blog (docs/diseno-portada.md §4.4): aquel
 * es una secuencia ÚNICA, y la portada atiende a dos públicos a la vez
 * ("Para compradores" / "Para vendedores"), cada uno con sus pasos y su enlace
 * de cierre. Comparten el nombre y poco más.
 *
 * La numeración sale del ÍNDICE, no de un campo: reordenar pasos en el editor no
 * puede dejar un "3, 1, 2".
 */

const COLUMN_CLASS: Record<number, string> = {
  1: '',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
};

export function StepsHomeBlockRenderer({ block }: { block: HomeStepsBlock }) {
  return (
    <div>
      {block.title && (
        <h2 className="mb-8 text-center text-xl font-semibold">{block.title}</h2>
      )}

      <div className={`grid gap-10 md:gap-16 ${COLUMN_CLASS[block.columns.length] ?? ''}`}>
        {block.columns.map((column, colIdx) => {
          const Icon = column.icon ? HOME_ICONS[column.icon] : null;
          return (
            <div key={colIdx}>
              <h3 className="mb-5 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
                {column.audienceTitle}
              </h3>

              <ol className="space-y-5">
                {column.steps.map((step, stepIdx) => (
                  <li key={stepIdx} className="flex gap-4">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                      {stepIdx + 1}
                    </span>
                    <div>
                      <p className="font-medium leading-snug">{step.title}</p>
                      <p className="text-sm text-muted-foreground">{step.description}</p>
                    </div>
                  </li>
                ))}
              </ol>

              {column.cta && (
                <Button asChild variant="link" className="mt-2 h-auto p-0">
                  <SmartLink href={column.cta.href}>{column.cta.label}</SmartLink>
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
