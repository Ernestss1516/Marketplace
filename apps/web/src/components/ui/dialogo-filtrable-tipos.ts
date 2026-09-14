/**
 * ══ LA FORMA DE UNA FILA ═════════════════════════════════════════════════════════════
 *
 * En un fichero propio, y no dentro del componente, porque el disparador
 * (`dialogo-filtrable.tsx`) y la capa (`dialogo-filtrable-capa.tsx`) lo comparten y la
 * segunda se carga con `next/dynamic`. Si el tipo viviera en la capa, importarlo desde el
 * disparador crearía un `import` estático hacia ella y **la descarga diferida dejaría de
 * serlo** — que es justo lo que ese reparto existe para conseguir.
 *
 * Un fichero sólo de tipos no llega al navegador: TypeScript lo borra al compilar.
 */

/**
 * Una fila del diálogo. **Cuatro ranuras FIJAS más las dos claves de búsqueda, no una vía
 * de escape**: no hay `renderItem` a propósito, porque el valor de este componente es que
 * todos sus usos produzcan el MISMO árbol (la frontera del sistema de estilo: estructura
 * común, sabor por tokens). Si un día una fila necesita algo que no cabe aquí, la pregunta
 * es si ese caso es de verdad este componente.
 */
export interface OpcionFiltrable {
  /** Lo que se guarda al elegir. Sale tal cual por `onElegir`. */
  valor: string;
  /** Lo que se lee, y lo que muestra el disparador cuando está elegida. */
  etiqueta: string;
  /** Dónde vive: la ruta de ancestros. Se MUESTRA atenuado; ver `buscable`. */
  contexto?: string;
  /** Un dato corto sobre la fila («y 6 subcategorías»). Se muestra, no se busca. */
  nota?: string;
  /**
   * La cadena contra la que filtra el texto. **No tiene por qué ser la etiqueta**: el
   * diálogo de categoría busca en el NOMBRE y muestra la ruta, porque buscando en la ruta
   * teclear «veh» devolvería la rama entera de Vehículos y el filtro dejaría de filtrar
   * (`docs/diseno-buscador.md` §3.3).
   */
  buscable: string;
  /**
   * La red de esa decisión: si NADA casa con `buscable`, se reintenta con esto antes de
   * enseñar el vacío. Es lo que cubre a quien teclea «vehiculos coches».
   */
  buscableAmplio?: string;
}
