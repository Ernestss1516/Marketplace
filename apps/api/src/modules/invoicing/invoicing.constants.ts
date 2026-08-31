/**
 * LAS CLAVES `Setting` DE FACTURACIÓN Y SUS DEFECTOS, en un solo sitio.
 *
 * FICHERO PROPIO Y NO CONSTANTES SUELTAS EN CADA SERVICIO, molde exacto de
 * `tickets/tickets.constants.ts` y `users/suspension.constants.ts`: las escribe quien las
 * configura desde el backoffice (`AdminService`) y las leen dos servicios de facturación
 * distintos. Con una copia en cada lado, el backoffice podría enseñar un defecto y el cron
 * aplicar otro — que es justo el defecto que la ráfaga A viene a cerrar en toda la página.
 *
 * Antes vivían como `const` privadas en `invoicing.service.ts` y `invoicing-schedule.service.ts`,
 * y por eso `AdminService` no podía usarlas sin importar un servicio entero. Sacarlas aquí es lo
 * que permite que las dos claves entren en el whitelist **sin duplicar ni una cadena**.
 *
 * ⚠ `fiscalInvoicingLastPeriod` NO ESTÁ AQUÍ Y NO DEBE ESTARLO. No es configuración: es la marca
 * del cron (el último periodo ya despachado), y se queda privada en `invoicing-schedule.service.ts`
 * precisamente para que nadie la traiga a un whitelist por comodidad. Adelantarla a mano se salta
 * un trimestre de facturación en silencio. Ver docs/auditoria-ajustes-backoffice.md §2.2 y §8.
 */

/**
 * Ventana de autoservicio de facturación, en MESES (RF.13).
 *
 * El defecto es PROVISIONAL: el plazo fiscalmente correcto (ventana exacta, semestre natural vs.
 * rodante) lo confirma el asesor de Ernest. La ventana se expresa sobre la fecha de OPERACIÓN
 * (`Transaction.createdAt`), no la del pago.
 */
export const FISCAL_WINDOW_SETTING = 'fiscalSelfServiceWindow';
export const DEFAULT_FISCAL_WINDOW_MONTHS = 6;

/**
 * Periodicidad de la facturación automática. Default confirmado por el asesor: QUARTERLY.
 *
 * SUS DOS ÚNICOS VALORES VÁLIDOS viven en `AdminService.ENUM_SETTING_VALUES`, que es quien
 * rechaza cualquier otro con un 400. Hacía falta porque el lector
 * (`InvoicingScheduleService.getPeriodicity`) interpreta **todo lo que no sea `'MONTHLY'`** como
 * `QUARTERLY`: sin guarda, una cadena mal escrita cambiaba la periodicidad fiscal en silencio.
 */
export const FISCAL_PERIODICITY_SETTING = 'fiscalInvoicingPeriodicity';
export const DEFAULT_FISCAL_PERIODICITY = 'QUARTERLY';
