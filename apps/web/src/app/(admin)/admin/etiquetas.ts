/**
 * I18N T3-A — EL PUENTE. El vocabulario se mudó; esta puerta sigue abierta.
 *
 * ─── QUÉ PASÓ ────────────────────────────────────────────────────────────────
 *
 * El contenido de este fichero está ahora en `@/lib/etiquetas-enums`. Aquí no queda
 * ni una etiqueta: sólo la re-exportación de todas.
 *
 * SE MUDÓ porque dejó de ser del backoffice. Nació aquí y durante un tiempo eso fue
 * exacto —lo leían las dos fichas del staff—, pero T1 tuvo que arreglar los filtros
 * PÚBLICOS de búsqueda, que pintaban «FIXED (12)» a cualquiera, y la única forma de
 * no abrir otra copia fue que un componente público importara de una carpeta de
 * administración. Eso quedó anotado como deuda con fecha. Ésta es la fecha.
 *
 * ─── POR QUÉ NO SE BORRA Y SE REAPUNTAN LOS CONSUMIDORES ─────────────────────
 *
 * Porque son dos cosas distintas y hacerlas juntas cuesta el diagnóstico. Mover un
 * módulo del que importan doce ficheros es un riesgo; sustituir las copias que
 * quedan repartidas por el repo es otro. En un solo merge, un rojo no diría cuál de
 * los dos fue. Con el puente, esta fase cambia de sitio un fichero y NO TOCA NI UN
 * CONSUMIDOR: si algo se rompe, es la mudanza y nada más.
 *
 * La Fase B irá reapuntando los doce a `@/lib/etiquetas-enums`, retirará las copias
 * sueltas y, cuando no quede nadie, borrará este puente. Hasta entonces vive, y no
 * es deuda oculta: es el estado declarado de una consolidación a medias.
 *
 * ─── QUÉ IMPORTAR SI ESCRIBES CÓDIGO NUEVO ───────────────────────────────────
 *
 * `@/lib/etiquetas-enums`, directamente. Este puente es para lo que ya existía.
 *
 * Ver `docs/auditoria-i18n-espanol.md` §8.2 (el patrón) y §9 (T3).
 */
export * from '@/lib/etiquetas-enums';
