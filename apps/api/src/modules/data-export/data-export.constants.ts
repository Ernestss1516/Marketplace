import { DataExportStatus } from '@prisma/client';

/**
 * BORRADO DE CUENTAS C6 — LAS CONSTANTES DE LA EXPORTACIÓN, EN UN SOLO SITIO.
 *
 * FICHERO PURO, SIN DI: lo importan el servicio, el worker, el cron y los tests,
 * que no se conocen entre sí. Mismo movimiento que `system-account.ts` (C5) y
 * `media-keys.ts` (B3): una regla que vive en dos sitios es una regla que acabará
 * divergiendo.
 */

/**
 * EL PREFIJO PRIVADO. Hermano de `facturas/`, no de `media/`.
 *
 * La diferencia no es de carpeta, es de puerta: bajo `media/` la respuesta de
 * subida ES una URL que sirve el bucket, y quien tenga el enlace entra. Bajo este
 * prefijo el objeto **sólo existe detrás de un endpoint autenticado que revalida
 * propiedad en CADA descarga** (`DataExportService.getExportFile`). No hay, y no
 * puede haber, una URL pública a un ZIP con la vida entera de una persona.
 */
export const DATA_EXPORT_PREFIX = 'exportaciones';

/** La clave del objeto de una exportación. La regla, y su única copia. */
export function dataExportKey(exportId: string): string {
  return `${DATA_EXPORT_PREFIX}/${exportId}.zip`;
}

/**
 * CUÁNTO VIVE EL ZIP.
 *
 * Siete días, y el número sale de las dos presiones opuestas: tiene que dar
 * margen a alguien que pide su exportación un viernes y no vuelve hasta el lunes,
 * y no puede convertir el bucket en un archivo permanente de vidas ajenas. Cuenta
 * desde que el fichero EXISTE, no desde que se pidió — si el worker tarda una
 * hora, el plazo del usuario no se ha comido esa hora.
 */
export const DATA_EXPORT_TTL_DAYS = 7;

/**
 * QUÉ CUENTA COMO «UNA EXPORTACIÓN VIVA» para el límite de una por usuario (§7.3).
 *
 * `PENDING` y `READY`, y **no** `FAILED` ni `EXPIRED`. Las dos exclusiones son la
 * razón de que esto sea una constante y no un `in` escrito a mano en la consulta:
 * si `FAILED` contara, una exportación que reventó dejaría a esa persona sin poder
 * pedir otra **nunca**, y el límite habría pasado de proteger el bucket a
 * secuestrar un derecho. Si `EXPIRED` contara, pasaría lo mismo a los siete días.
 *
 * Sin `as const`/`readonly`: Prisma rechaza arrays de sólo lectura en un `in`
 * (misma razón que en `account-visibility.ts`).
 */
export const ESTADOS_DE_EXPORTACION_VIVA: DataExportStatus[] = [
  DataExportStatus.PENDING,
  DataExportStatus.READY,
];

/** El nombre del fichero que se descarga: `exportacion-<slug>-<fecha>.zip` (§7.1). */
export function dataExportFilename(slug: string, fecha: Date): string {
  const dia = fecha.toISOString().slice(0, 10);
  return `exportacion-${slug}-${dia}.zip`;
}
