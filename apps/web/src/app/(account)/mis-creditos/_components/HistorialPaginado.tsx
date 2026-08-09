'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

/**
 * UXV.6 (M9) — el historial se puede pasear.
 *
 * EL DEFECTO: la API devolvía `page/perPage/totalPages` desde el primer día y la página los
 * IGNORABA: pintaba los veinte primeros movimientos y ahí se acababa. El usuario veía una
 * lista que parecía completa y no tenía forma de llegar al movimiento del mes pasado —
 * justo en la pantalla donde uno va a auditar en qué se le fue el dinero.
 *
 * Genérico sobre el tipo de apunte porque hay DOS historiales con la misma forma y
 * paginación (créditos y bumps) y distinta moneda; mantener dos copias de esto era
 * garantizar que una se quedara sin arreglar.
 */

interface Pagina<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

interface Props<T> {
  /** Primera página, ya servida por el servidor: la lista se pinta sin esperar a nada. */
  inicial: Pagina<T>;
  /** Trae otra página. La provee el llamador porque cada historial tiene su endpoint. */
  cargar: (page: number) => Promise<Pagina<T>>;
  /** Cómo se pinta un apunte. */
  fila: (item: T) => React.ReactNode;
  /** Clave estable del apunte. */
  clave: (item: T) => string;
  /** Qué se enseña cuando no hay ni un movimiento (B5). */
  vacio: React.ReactNode;
}

export function HistorialPaginado<T>({ inicial, cargar, fila, clave, vacio }: Props<T>) {
  const [pagina, setPagina] = useState<Pagina<T>>(inicial);
  const [cargando, setCargando] = useState(false);

  async function ir(n: number) {
    if (n < 1 || n > pagina.totalPages || cargando) return;
    setCargando(true);
    try {
      setPagina(await cargar(n));
    } catch {
      // Un fallo de red no debe vaciar lo que el usuario ya está mirando: se queda en la
      // página actual.
    } finally {
      setCargando(false);
    }
  }

  if (pagina.items.length === 0) return <>{vacio}</>;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-4">
          {pagina.items.map((item, idx) => (
            <div key={clave(item)}>
              {fila(item)}
              {idx < pagina.items.length - 1 && <Separator />}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Con una sola página no se pintan controles: serían dos botones muertos. */}
      {pagina.totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            Página {pagina.page} de {pagina.totalPages} · {pagina.total} movimiento
            {pagina.total === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2">
            {cargando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <Button
              variant="outline"
              size="sm"
              onClick={() => ir(pagina.page - 1)}
              disabled={pagina.page <= 1 || cargando}
              aria-label="Página anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => ir(pagina.page + 1)}
              disabled={pagina.page >= pagina.totalPages || cargando}
              aria-label="Página siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
