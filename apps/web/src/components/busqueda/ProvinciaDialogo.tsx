'use client';

import * as React from 'react';
import { DialogoFiltrable, type OpcionFiltrable } from '@/components/ui/dialogo-filtrable';
import { PROVINCIAS } from '@/lib/provincias';

/**
 * ══ BUSCADOR · BQ-B — EL DIÁLOGO DE UBICACIÓN ════════════════════════════════════════
 *
 * Las 52 provincias de `lib/provincias.ts`. Adaptador mínimo: una provincia no tiene
 * jerarquía, así que no hay `contexto` ni `nota` y lo buscable es el propio nombre
 * (`docs/diseno-buscador.md` §4).
 *
 * ── PROVINCIA Y NO MUNICIPIO, Y ESO NO ES UNA SIMPLIFICACIÓN ──────────────────────
 *
 * El buscador de portada filtra por provincia —la entrada amplia—; el municipio se afina
 * en `/busqueda`, donde `FilterPanel` ya tiene su campo de ciudad. Y hay un motivo de
 * peso además del de producto: `/data/municipios.json` son **8 132 filas y 372 KB**, y la
 * portada es la página de más tráfico del sitio. `PROVINCIAS` ya viajaba en el bundle del
 * buscador, así que este diálogo **no añade un solo byte de datos**.
 *
 * ── EL VALOR QUE SE ENVÍA ES EL EXACTO DE `PROVINCIAS`, POR CONSTRUCCIÓN ──────────
 *
 * `SearchService` filtra con un `=` EXACTO contra el `province` del documento
 * (`filters.push(`province = "…"`)`), que es el mismo string guardado en
 * `Listing.province` y el mismo que sale de `/data/municipios.json`. Una errata o una
 * variación de mayúsculas o tildes da **cero resultados en silencio** — es el defecto que
 * `FilterPanel` ya había cerrado cambiando su campo de texto libre por un `<select>`, y
 * que desde BQ-E cierra montando este mismo diálogo (su `<select>` era el segundo control
 * de provincia del sitio; ahora sólo hay uno).
 *
 * Aquí lo cierra la forma del molde, no la disciplina: `DialogoFiltrable` llama a
 * `onElegir` **sólo desde el manejador de una fila**, y el valor de esa fila es la entrada
 * de la constante. **No existe ningún camino desde el texto tecleado hasta `onElegir`.**
 * El campo de texto filtra; no es el campo del valor.
 *
 * ── LAS GRAFÍAS COOFICIALES SALEN GRATIS ──────────────────────────────────────────
 *
 * Cinco entradas llevan grafía doble (`Alicante/Alacant`, `Araba/Álava`,
 * `Castellón/Castelló`, `Valencia/València`). La normalización NFD del filtro más un
 * `includes` las cubre sin una línea propia, porque la barra no separa nada para un
 * `includes`: «alac» encuentra `Alicante/Alacant` y «valen» encuentra `Valencia/València`
 * con el acento ya fuera de la comparación.
 */

/**
 * `PROVINCIAS` es una tupla literal (`as const`), así que se copia a un array mutable de
 * opciones una sola vez para todo el módulo: la lista no depende de nada y no hay razón
 * para rehacerla en cada render.
 */
const OPCIONES: OpcionFiltrable[] = PROVINCIAS.map((p) => ({
  valor: p,
  etiqueta: p,
  buscable: p,
}));

export function ProvinciaDialogo({
  valor,
  onElegir,
  className,
}: {
  valor: string;
  /**
   * Qué pasa al elegir; lo decide quien monta el diálogo, no este fichero.
   *
   *   · `SearchBar` (portada)   → escribe la provincia en el estado del buscador;
   *   · `FilterPanel` (/busqueda y /[categoria]) → NAVEGA, escribiendo `?province=` en
   *     la URL con el mismo `update()` que los demás filtros del panel (BQ-E).
   *
   * En los dos casos el string que sale de aquí es la entrada exacta de `PROVINCIAS`, que
   * es lo único que este adaptador garantiza — y lo único que el backend acepta.
   */
  onElegir: (provincia: string) => void;
  /** Geometría del disparador. La decide quien lo monta — ver `DialogoFiltrable`. */
  className?: string;
}) {
  return (
    <DialogoFiltrable
      opciones={OPCIONES}
      valor={valor}
      onElegir={onElegir}
      etiquetaVacio="Toda España"
      opcionLimpiar="Toda España"
      titulo="Elige una provincia"
      marcadorFiltro="Filtrar provincias…"
      etiquetaDisparador="Provincia"
      className={className}
    />
  );
}
