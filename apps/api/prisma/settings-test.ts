import { Prisma } from '@prisma/client';

/**
 * LOS AJUSTES DE LA SEMILLA DE TEST, en su propio módulo y por una razón concreta.
 *
 * Vive aquí y no dentro de `seed-test.ts` por lo mismo que `SEED_SETTINGS` salió de
 * `seed.ts`: **`seed-test.ts` es un script con un `main()` de nivel superior**, así
 * que importarlo para mirar la lista EJECUTA LA SEMILLA ENTERA.
 *
 * No es teórico: la barrera de fin de corrida
 * (`test/verificar-aislamiento-settings.ts`) se escribió importando la lista de
 * `seed-test.ts`, y al arrancar volvía a sembrar los ajustes — o sea, **reparaba la
 * contaminación justo antes de ir a buscarla**. Una barrera que arregla el defecto
 * que viene a medir siempre sale verde. Se vio porque el `Test seed: ... OK` salía
 * por consola después de «Ran all test suites», que es donde no pinta nada.
 *
 * Con la lista aquí, mirarla no tiene efectos secundarios, que es la única forma de
 * que la barrera signifique algo.
 */
export const SETTINGS_SEMILLA_TEST: { key: string; value: Prisma.InputJsonValue }[] = [
  { key: 'badWordList', value: [] },
  { key: 'listingExpiryDays', value: 60 },
  { key: 'contactRequiresVerification', value: true },
  { key: 'featuredCreditCost7d', value: 30 },
  { key: 'featuredCreditCost14d', value: 50 },
  { key: 'featuredCreditCost30d', value: 100 },
  { key: 'bumpCreditCost', value: 5 },
  { key: 'proExtraCreditsPercent', value: 20 },
  { key: 'bumpAutoEnabled', value: true },
  // Vídeo Pro — encendido SOLO en la semilla de test, para que las baterías puedan
  // ejercitar la feature. En producción el ajuste no se siembra: sin fila está APAGADA, y
  // encenderla debe ser un acto explícito porque cuesta almacenamiento desde el primer
  // vídeo. Los casos de «apagada» se prueban apagándola dentro del propio test.
  { key: 'videoEnabled', value: true },
  { key: 'freeActiveListingLimit', value: 5 },
  { key: 'proActiveListingLimit', value: 20 },
  { key: 'proMonthlyFeaturedQuota', value: 4 },
  { key: 'proQuotaFeaturedDurationDays', value: 7 },
  // Monetización ráfaga 3.
  { key: 'proMonthlyBumpQuota', value: 4 },
  // Monetización ráfaga 4.
  { key: 'proExtraBumpsPercent', value: 20 },
];
