import { Prisma } from '@prisma/client';

/**
 * LOS AJUSTES QUE LA SEMILLA CREA, y por qué viven en su propio fichero.
 *
 * Estaban dentro de `seedSettings()` en `seed.ts`, que es un script con un `main()` en la
 * raíz: importarlo para mirar la lista habría ejecutado la semilla entera. Sacarlos aquí los
 * hace INSPECCIONABLES sin efectos secundarios, y eso es lo que permite que un test afirme
 * que el interruptor del vídeo existe y nace apagado.
 *
 * Hacía falta porque el defecto que este fichero cierra fue exactamente ése: `videoEnabled`
 * llevaba desde su ráfaga en el whitelist del backend y NO en la semilla, y nadie lo notó
 * porque no había nada que pudiera notarlo. Ver docs/auditoria-pro-video.md §2.0.
 *
 * `createMany` + `skipDuplicates` en el llamante: sólo se insertan las claves que no
 * existen. Un valor que un administrador ya haya cambiado desde el backoffice NUNCA se pisa.
 */
export const SEED_SETTINGS: { key: string; value: Prisma.InputJsonValue }[] = [
  { key: 'badWordList', value: [] },
  { key: 'listingExpiryDays', value: 60 },
  { key: 'contactRequiresVerification', value: true },
  // Bump automático (D7) — interruptor de emergencia; ver SETTING_KEYS.
  { key: 'bumpAutoEnabled', value: true },
  // RF.4: costes de créditos — configurables desde el backoffice sin despliegue.
  { key: 'featuredCreditCost7d', value: 30 },
  { key: 'featuredCreditCost14d', value: 50 },
  { key: 'featuredCreditCost30d', value: 100 },
  { key: 'bumpCreditCost', value: 5 },
  // RF.7: límites de anuncios activos por plan — configurables sin despliegue.
  { key: 'freeActiveListingLimit', value: 5 },
  { key: 'proActiveListingLimit', value: 20 },
  // RF.10 Bonus Pro: porcentaje de créditos extra para usuarios Pro al comprar un pack.
  { key: 'proExtraCreditsPercent', value: 20 },
  // H8.1: destacados gratis/mes que otorga la cuota de Pro (reseteo derivado, sin cron).
  { key: 'proMonthlyFeaturedQuota', value: 4 },
  // H8.5a: fixed duration of a featured grant paid from the quota (the user
  // chooses duration only when paying with credits).
  { key: 'proQuotaFeaturedDurationDays', value: 7 },
  // Monetización ráfaga 3: bumps gratis/mes que otorga la cuota de Pro —
  // mismo periodo que proMonthlyFeaturedQuota (misma Subscription), reseteo
  // derivado, sin cron.
  { key: 'proMonthlyBumpQuota', value: 4 },
  // Monetización ráfaga 4: bonus de bumps extra para Pro al comprar un
  // BumpPack — Setting propia, NO se reutiliza proExtraCreditsPercent
  // (son beneficios distintos, calibrables por separado).
  { key: 'proExtraBumpsPercent', value: 20 },

  // ── ENCENDER EL VÍDEO — los interruptores que existían sin fila ─────────
  //
  // Los tres estaban en el whitelist del backend y NO en esta semilla, así que en
  // producción no existían: el vídeo Pro llevaba construido desde su ráfaga y era
  // inalcanzable, porque nadie podía encenderlo. Ahora nacen aquí, con el MISMO valor
  // que ya se aplicaba sin fila — sembrarlos no cambia el comportamiento de nada, sólo
  // los hace visibles y conmutables desde /admin/ajustes.
  //
  // `bumpAutoEnabled` ya estaba sembrado (arriba, en true). Ver
  // docs/auditoria-pro-video.md §2.0.

  // VÍDEO PRO — NACE APAGADO, Y ES LA DECISIÓN, NO UN DESCUIDO. La feature cuesta
  // almacenamiento y ancho de banda desde el primer vídeo (video.service.ts), así que
  // encenderla tiene que ser un acto explícito de un administrador. Lo que arregla
  // sembrarla no es el valor: es que el interruptor EXISTA para poder darle.
  { key: 'videoEnabled', value: false },
  // PUERTA ráfaga 2 — apagada, igual que nacía sin fila: es la única regla capaz de
  // frenar anuncios publicados hace años sin que su dueño haya tocado nada, y
  // encenderla debe ir precedida del recuento de `pnpm gate-impact-report`.
  { key: 'attributeRevalidationEnabled', value: false },
  // D3 — tope de programaciones de bump activas por usuario. Mismo número que
  // DEFAULT_MAX_SCHEDULES_PER_USER, que es el que se aplicaba sin fila.
  { key: 'maxBumpSchedulesPerUser', value: 10 },
];
