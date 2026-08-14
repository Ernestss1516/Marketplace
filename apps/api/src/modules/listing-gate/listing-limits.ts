import { ListingStatus } from '@prisma/client';

/**
 * LOS DOS LÍMITES DE ANUNCIOS, JUNTOS — porque su relación es una invariante y
 * mantenerlos en ficheros distintos es cómo se rompen las invariantes.
 *
 * SON DOS REGLAS SEPARADAS QUE CONVIVEN, y cuentan universos distintos:
 *
 *  · LÍMITE DE ACTIVOS (RF.7, existe desde siempre y está encendido): cuántos
 *    anuncios puede tener EN EL MERCADO a la vez. Cuenta sólo `ACTIVE`. Es un
 *    límite de EXPOSICIÓN: pausar o vender libera plaza al instante.
 *
 *  · LÍMITE TOTAL (nuevo, nace apagado): cuántos anuncios puede TENER, se estén
 *    mostrando o no. Cuenta todo menos `ARCHIVED` y `SOLD`. Es un límite de
 *    ACUMULACIÓN: frena el borrador número mil, que no ocupa escaparate pero sí
 *    ocupa base de datos, índices y trabajo de moderación.
 *
 * No es uno parametrizado dos veces: cuentan cosas distintas, se aplican en
 * momentos distintos (uno al activar, otro al crear) y pueden tener mensajes y
 * topes distintos. Fusionarlos obligaría a que un cambio en cualquiera de los dos
 * razonamientos arrastrara al otro.
 */

/** Topes por defecto cuando el `Setting` no tiene fila. Los de siempre. */
export const DEFAULT_FREE_ACTIVE_LIMIT = 5;
export const DEFAULT_PRO_ACTIVE_LIMIT = 20;

/**
 * Topes TOTALES por defecto: el DOBLE de los de activos.
 *
 * El factor 2 no es una cifra de producto sino la traducción de la política:
 * «puedes tener en la recámara tanto como tienes en el escaparate». Un vendedor
 * gratuito con sus 5 activos puede además llevar 5 borradores, pausados o
 * caducados; uno Pro, 20. Los números finales se ajustan con `Setting` cuando M2
 * diga a cuánta gente afectan de verdad.
 */
export const DEFAULT_FREE_TOTAL_LIMIT = DEFAULT_FREE_ACTIVE_LIMIT * 2;
export const DEFAULT_PRO_TOTAL_LIMIT = DEFAULT_PRO_ACTIVE_LIMIT * 2;

/** Las claves de `Setting`. Editables desde el backoffice, todas con lector. */
export const FREE_ACTIVE_LIMIT_SETTING = 'freeActiveListingLimit';
export const PRO_ACTIVE_LIMIT_SETTING = 'proActiveListingLimit';
export const FREE_TOTAL_LIMIT_SETTING = 'freeTotalListingLimit';
export const PRO_TOTAL_LIMIT_SETTING = 'proTotalListingLimit';

/** El interruptor de la regla de límite total. Sin fila, APAGADA. */
export const TOTAL_LIMIT_RULE_ENABLED_SETTING = 'totalListingLimitEnabled';

/**
 * QUÉ CUENTA HACIA EL TOTAL: todo lo que el vendedor todavía «tiene».
 *
 * `ARCHIVED` y `SOLD` quedan fuera, y ésa es la mitad útil de la regla: es lo que
 * convierte el tope en algo con salida. Un vendedor que llega al límite no está
 * atrapado —archiva lo que ya no le interesa o marca vendido lo que vendió, y
 * recupera hueco— en vez de tener que borrar historial. Los dos son estados
 * TERMINALES, así que ese hueco no se puede recuperar dos veces.
 *
 * Se declara como lista y no como «not in (ARCHIVED, SOLD)» a propósito: un
 * estado NUEVO en el enum no entra aquí solo, hay que decidirlo. Con la negación,
 * cualquier estado futuro contaría sin que nadie lo hubiera pensado.
 */
export const ESTADOS_QUE_CUENTAN_AL_TOTAL: ListingStatus[] = [
  ListingStatus.DRAFT,
  ListingStatus.PENDING_REVIEW,
  ListingStatus.ACTIVE,
  ListingStatus.RESERVED,
  ListingStatus.PAUSED,
  ListingStatus.EXPIRED,
  ListingStatus.REJECTED,
];
