/**
 * BORRADO DE CUENTAS C4 — la duración por defecto de una suspensión.
 *
 * FICHERO PROPIO Y NO UNA CONSTANTE SUELTA EN `admin.service.ts`: la clave la
 * escribe quien suspende y la leerá quien la configure desde el backoffice, que
 * son dos sitios distintos. Mismo criterio que `listing-limits.ts`, donde los
 * topes y sus claves viven juntos y lejos de sus lectores.
 *
 * NACE SIN SEMBRAR, y eso es la decisión: `seed.ts` no la crea. Mientras el
 * ajuste no exista, `suspendUser` sin `days` produce una suspensión INDEFINIDA —
 * exactamente lo que era toda suspensión antes de C4. Así esta ráfaga no cambia
 * ni una conducta el día que se despliega: añade la capacidad y deja la decisión
 * de activarla en manos de quien administra.
 *
 * Un valor `<= 0` o no numérico se trata como «no configurado» (ver
 * `AdminService.leerDuracionPorDefectoDeSuspension`): un cero no es una
 * suspensión de cero días, es alguien intentando desactivar el ajuste.
 */
export const DEFAULT_SUSPENSION_DAYS_SETTING = 'defaultSuspensionDays';
