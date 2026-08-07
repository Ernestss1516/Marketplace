// Mismas clases que el editor de bloques del blog (block-editor/editors/shared.ts)
// y que los formularios del resto del backoffice — consistencia visual entre los
// campos de las dos zonas del editor de portada y el resto del panel.
//
// Se duplican en vez de importarse del blog a propósito: son cuatro cadenas de
// Tailwind, y hacer que el editor de portada dependa de un fichero del editor de
// blog acoplaría los dos por la puerta de atrás justo cuando el diseño (§4.0)
// separa los motores. Lo que se comparte entre motores son componentes, no
// constantes de estilo.
export const inputCls =
  'w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50';
export const textareaCls =
  'w-full resize-y rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50';
export const labelCls = 'text-xs font-medium text-muted-foreground';
export const errorCls = 'mt-1 flex items-center gap-1 text-xs text-destructive';
export const hintCls = 'mt-1 text-xs text-muted-foreground';
