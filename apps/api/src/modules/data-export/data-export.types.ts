/**
 * BORRADO DE CUENTAS C6 — el trabajo de cola, en un fichero SIN dependencias.
 *
 * EXISTE PARA ROMPER UN CICLO, igual que `account-cleanup.types.ts` en C5: el
 * servicio encola y el worker llama al servicio, así que si el tipo del job
 * viviera en cualquiera de los dos, Nest no podría resolver el otro
 * («Nest can't resolve dependencies of the ...Processor (?)»). Un fichero de tipos
 * puros no importa nada y por eso los dos pueden importarlo.
 */
export const DATA_EXPORT_JOB = {
  BUILD: 'build-data-export',
} as const;

export interface BuildDataExportJobData {
  /** La fila `DataExport` que este trabajo tiene que completar. */
  exportId: string;
}
