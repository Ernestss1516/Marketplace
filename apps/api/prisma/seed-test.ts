// Minimal static seed for the test database.
// Called once from globalSetup (test/setup-e2e.js) via ts-node.
// Uses upsert / skipDuplicates so it is safe to run multiple times.
// Does NOT create users or listings — those are created per-suite in beforeAll.
//
// Tables seeded here are EXCLUDED from cleanDb (Category, Setting, CreditPack,
// Price, Product) to avoid race conditions when Jest workers run suites in parallel.

import { PrismaClient, Prisma, ProductType } from '@prisma/client';

const prisma = new PrismaClient();

async function seedCategories() {
  const electronica = await prisma.category.upsert({
    where: { slug: 'electronica' },
    create: {
      name: 'Electrónica',
      slug: 'electronica',
      order: 1,
      attributeSchema: [],
    },
    // Reset schema so admin tests always start from a clean slate (prevents
    // accumulation across CI runs when test 2 saves "brand" each time).
    // Reset order:1 in case the prod seed (which has Vehículos at order:1) ran
    // on the test DB and reordered things, making `.first()` non-deterministic.
    update: { attributeSchema: [], order: 1 },
  });

  await prisma.category.upsert({
    where: { slug: 'moviles' },
    create: {
      name: 'Móviles',
      slug: 'moviles',
      order: 1,
      parentId: electronica.id,
      attributeSchema: [
        { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false },
        { name: 'ram', label: 'RAM', type: 'number', unit: 'GB', filterable: true, required: false },
      ],
    },
    update: {},
  });

  // Vehículos hierarchy: parent holds year+km (required, inherited by children).
  // year has cardAttribute:true so "Año: 2022" appears in the listing card (RC5.5).
  const vehiculosSchema = [
    { name: 'year', label: 'Año', type: 'number', filterable: true, required: true, cardAttribute: true },
    { name: 'km', label: 'Kilómetros', type: 'number', unit: 'km', filterable: true, required: true },
  ];
  const cochesSchema = [
    { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false, cardAttribute: true },
  ];

  const vehiculos = await prisma.category.upsert({
    where: { slug: 'vehiculos' },
    create: { name: 'Vehículos', slug: 'vehiculos', order: 2, attributeSchema: vehiculosSchema },
    // Also reset order:2 — the prod seed sets Vehículos to order:1, so if it ran
    // on the test DB, Electrónica and Vehículos would both have order:1 and the
    // admin test's `.first()` selector would be non-deterministic.
    update: { attributeSchema: vehiculosSchema, order: 2 },
  });

  await prisma.category.upsert({
    where: { slug: 'coches' },
    create: { name: 'Coches', slug: 'coches', order: 1, parentId: vehiculos.id, attributeSchema: cochesSchema },
    update: { attributeSchema: cochesSchema },
  });

  console.log('Test seed: categories OK (electronica → moviles, vehiculos → coches)');
}

async function seedSettings() {
  // upsert (not createMany/skipDuplicates): FORCES every value back to its
  // default on each run. Settings are excluded from cleanDb (see helpers/db.ts)
  // because they're static system data shared across suites — but that means
  // a value changed by one suite/spec (e.g. admin-ajustes-numeric.spec.ts in
  // Playwright, which shares this same DB) survives to contaminate the next
  // run if it's ever left un-restored. Forcing the default here is the fix,
  // independent of --runInBand / worker isolation (see estado-tecnico.md).
  const settings: { key: string; value: Prisma.InputJsonValue }[] = [
    { key: 'badWordList', value: [] },
    { key: 'listingExpiryDays', value: 60 },
    { key: 'contactRequiresVerification', value: true },
    { key: 'featuredCreditCost7d', value: 30 },
    { key: 'featuredCreditCost14d', value: 50 },
    { key: 'featuredCreditCost30d', value: 100 },
    { key: 'bumpCreditCost', value: 5 },
    { key: 'proExtraCreditsPercent', value: 20 },
    { key: 'bumpAutoEnabled', value: true },
    { key: 'freeActiveListingLimit', value: 5 },
    { key: 'proActiveListingLimit', value: 20 },
    { key: 'proMonthlyFeaturedQuota', value: 4 },
    { key: 'proQuotaFeaturedDurationDays', value: 7 },
    // Monetización ráfaga 3.
    { key: 'proMonthlyBumpQuota', value: 4 },
    // Monetización ráfaga 4.
    { key: 'proExtraBumpsPercent', value: 20 },
  ];

  for (const s of settings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      create: s,
      update: { value: s.value },
    });
  }

  console.log('Test seed: settings OK (reset to defaults)');
}

async function seedCreditPacks() {
  const existing = await prisma.creditPack.count();
  if (existing > 0) {
    console.log('Test seed: credit packs already present, skipped');
    return;
  }

  const packsProduct = await prisma.product.create({
    data: {
      name: 'Packs de créditos',
      description: 'Paquetes de créditos internos.',
      type: ProductType.ONE_TIME,
    },
  });

  const packs: { name: string; creditAmount: number; amount: string }[] = [
    { name: 'Pack Básico', creditAmount: 50, amount: '4.99' },
    { name: 'Pack Estándar', creditAmount: 150, amount: '9.99' },
    { name: 'Pack Max', creditAmount: 400, amount: '19.99' },
    // Monetización ráfaga 4: "Pack de bumps" (Opción B, highlightBumps)
    // retirado — ver seedBumpPacks().
  ];

  for (const p of packs) {
    const pack = await prisma.creditPack.create({
      data: {
        name: p.name,
        creditAmount: p.creditAmount,
      },
    });
    await prisma.price.create({
      data: {
        productId: packsProduct.id,
        amount: new Prisma.Decimal(p.amount),
        creditPackId: pack.id,
      },
    });
  }
  console.log('Test seed: credit packs OK (Básico/Estándar/Max)');
}

async function seedBumpPacks() {
  const existing = await prisma.bumpPack.count();
  if (existing > 0) {
    console.log('Test seed: bump packs already present, skipped');
    return;
  }

  const packsProduct = await prisma.product.create({
    data: {
      name: 'Packs de bumps',
      description: 'Paquetes de bumps directos.',
      type: ProductType.ONE_TIME,
    },
  });

  // Mismos valores que seed.ts (real), para que los e2e que los ejercen
  // reflejen los packs tal cual los verá el usuario.
  const packs: { name: string; bumpAmount: number; amount: string }[] = [
    { name: 'Pack 5 bumps', bumpAmount: 5, amount: '2.99' },
    { name: 'Pack 15 bumps', bumpAmount: 15, amount: '6.99' },
    { name: 'Pack 40 bumps', bumpAmount: 40, amount: '14.99' },
  ];

  for (const p of packs) {
    const pack = await prisma.bumpPack.create({
      data: { name: p.name, bumpAmount: p.bumpAmount },
    });
    await prisma.price.create({
      data: {
        productId: packsProduct.id,
        amount: new Prisma.Decimal(p.amount),
        bumpPackId: pack.id,
      },
    });
  }
  console.log('Test seed: bump packs OK (5/15/40 bumps)');
}

async function seedFeaturedPrices() {
  // Check if featured listing prices already exist (no creditPackId, durationDays set)
  const existing = await prisma.price.count({
    where: { creditPackId: null, durationDays: { not: null } },
  });
  if (existing > 0) {
    console.log('Test seed: featured listing prices already present, skipped');
    return;
  }

  const featuredProduct = await prisma.product.create({
    data: {
      name: 'Destacado de anuncio',
      description: 'Destaca tu anuncio en los resultados de búsqueda.',
      type: ProductType.ONE_TIME,
    },
  });

  const variants: { durationDays: number; amount: string }[] = [
    { durationDays: 7,  amount: '2.99' },
    { durationDays: 14, amount: '4.99' },
    { durationDays: 30, amount: '7.99' },
  ];

  for (const v of variants) {
    await prisma.price.create({
      data: {
        productId: featuredProduct.id,
        amount: new Prisma.Decimal(v.amount),
        durationDays: v.durationDays,
      },
    });
  }
  console.log('Test seed: featured prices OK (7d/14d/30d)');
}

async function seedProPlans() {
  const existing = await prisma.product.count({ where: { type: ProductType.RECURRING } });

  if (existing === 0) {
    const proProduct = await prisma.product.create({
      data: {
        name: 'Plan Pro',
        description: 'Acceso completo a las funciones Pro: más anuncios activos, estadísticas y prioridad en soporte.',
        type: ProductType.RECURRING,
      },
    });

    await prisma.price.create({
      data: {
        productId: proProduct.id,
        amount: new Prisma.Decimal('9.99'),
        interval: 'MONTH',
        intervalCount: 1,
      },
    });

    await prisma.price.create({
      data: {
        productId: proProduct.id,
        amount: new Prisma.Decimal('89.99'),
        interval: 'YEAR',
        intervalCount: 1,
      },
    });

    console.log('Test seed: pro plans OK (Plan Pro 9,99 €/mes · 89,99 €/año)');
    return;
  }

  // Plans already present — fix YEAR price if it was seeded with the wrong value (79.99 → 89.99).
  const wrongYearPrice = await prisma.price.findFirst({
    where: {
      interval: 'YEAR',
      amount: new Prisma.Decimal('79.99'),
      product: { type: ProductType.RECURRING },
    },
    select: { id: true },
  });
  if (wrongYearPrice) {
    await prisma.price.update({
      where: { id: wrongYearPrice.id },
      data: { amount: new Prisma.Decimal('89.99') },
    });
    console.log('Test seed: pro annual price corrected 79,99 → 89,99 €');
  } else {
    console.log('Test seed: pro plans already present, skipped');
  }
}

/**
 * B1 — tags de ejemplo, parte del ESTADO BASE.
 *
 * Van en el seed (y no creados por cada spec) porque el saneamiento resetea la base a lo
 * que el seed diga: así B2/B3/B4 y sus e2e tienen un vocabulario con el que trabajar sin
 * inventárselo cada vez, y es determinista entre corridas.
 *
 * El reparto ejercita la HERENCIA a propósito: "garantia" y "envio-incluido" cuelgan de
 * `vehiculos` (padre), así que `coches` (hija) los ve heredados; "unico-dueno" cuelga
 * directamente de `coches`, así que sale ANTES que los heredados. "descatalogado" no se
 * asigna a nada: existe en el catálogo pero no se ofrece en ninguna categoría.
 */
async function seedTags() {
  const tags = [
    { slug: 'garantia', name: 'Con garantía', orden: 0 },
    { slug: 'envio-incluido', name: 'Envío incluido', orden: 1 },
    { slug: 'unico-dueno', name: 'Único dueño', orden: 2 },
    { slug: 'descatalogado', name: 'Descatalogado', orden: 3 },
  ];
  for (const t of tags) {
    await prisma.tag.upsert({ where: { slug: t.slug }, create: t, update: { name: t.name, orden: t.orden } });
  }

  const vehiculos = await prisma.category.findUnique({ where: { slug: 'vehiculos' }, select: { id: true } });
  const coches = await prisma.category.findUnique({ where: { slug: 'coches' }, select: { id: true } });
  const porSlug = Object.fromEntries(
    (await prisma.tag.findMany({ where: { slug: { in: tags.map((t) => t.slug) } } })).map((t) => [t.slug, t.id]),
  );

  const asignaciones: { categoryId: string; tagId: string; orden: number }[] = [];
  if (vehiculos) {
    asignaciones.push(
      { categoryId: vehiculos.id, tagId: porSlug['garantia'], orden: 0 },
      { categoryId: vehiculos.id, tagId: porSlug['envio-incluido'], orden: 1 },
    );
  }
  if (coches) {
    asignaciones.push({ categoryId: coches.id, tagId: porSlug['unico-dueno'], orden: 0 });
  }
  for (const a of asignaciones) {
    await prisma.categoryTag.upsert({
      where: { categoryId_tagId: { categoryId: a.categoryId, tagId: a.tagId } },
      create: a,
      update: { orden: a.orden },
    });
  }

  console.log('Test seed: tags OK (vehiculos → garantia+envio-incluido; coches → unico-dueno)');
}

// RP.1 — fila única de portada. upsert que FUERZA los valores por defecto en
// cada corrida, mismo motivo que seedSettings() aquí arriba: es una fila
// estática compartida entre suites y excluida de cleanDb (helpers/db.ts), así
// que un PATCH de un spec sobreviviría para contaminar la corrida siguiente.
async function seedHomepageConfig() {
  const defaults = {
    heroStaticTitle: 'Compra y vende de segunda mano',
    heroRotatingOptions: [],
    heroRotationMs: 3000,
    heroSubtitle: null,
    // Mismos bloques que siembra seed.ts: la portada de test debe reproducir la
    // real, o los specs que leen la home medirían otra página.
    blocks: [
      {
        id: 'seed-search',
        type: 'search',
        eyebrow: 'Miles de anuncios cerca de ti',
        showPopularCategories: true,
        popularCount: 6,
      },
      {
        id: 'seed-cta-publicar',
        type: 'cta',
        label: '¿Tienes algo que vender? Publica gratis',
        href: '/publicar',
        style: 'outline',
      },
      {
        id: 'seed-listings',
        type: 'listings',
        title: 'Recién publicados',
        limit: 8,
        sort: 'recent',
        showAllLink: true,
      },
      {
        id: 'seed-steps',
        type: 'steps',
        title: 'Cómo funciona',
        columns: [
          {
            audienceTitle: 'Para compradores',
            icon: 'search',
            steps: [
              { title: 'Busca lo que necesitas', description: 'Usa el buscador o explora por categorías hasta encontrarlo.' },
              { title: 'Contacta con el vendedor', description: 'Pregunta tus dudas por mensajería interna, sin dar tu teléfono.' },
              { title: 'Queda y valora', description: 'Cierra el trato en persona y deja tu opinión al vendedor.' },
            ],
            cta: { label: 'Buscar ahora →', href: '/busqueda' },
          },
          {
            audienceTitle: 'Para vendedores',
            icon: 'upload',
            steps: [
              { title: 'Publica gratis', description: 'Sube fotos y describe tu artículo en un par de minutos.' },
              { title: 'Gestiona tus mensajes', description: 'Responde a los interesados desde tu bandeja de mensajes.' },
              { title: 'Destaca tu anuncio (opcional)', description: 'Dale más visibilidad si quieres vender más rápido.' },
            ],
            cta: { label: 'Publicar anuncio →', href: '/publicar' },
          },
        ],
      },
      {
        id: 'seed-trust',
        type: 'grid',
        columns: 4,
        items: [
          { media: { kind: 'icon', name: 'shield-check' }, title: 'Anuncios moderados' },
          { media: { kind: 'icon', name: 'message-circle' }, title: 'Mensajería sin compartir tu teléfono' },
          { media: { kind: 'icon', name: 'star' }, title: 'Valoraciones entre usuarios' },
          { media: { kind: 'icon', name: 'sparkles' }, title: 'Publicar es gratis' },
        ],
      },
    ],
  };
  await prisma.homepageConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...defaults },
    update: defaults,
  });
  console.log('Test seed: homepage config OK (reset to defaults)');
}

async function main() {
  await seedCategories();
  await seedTags();
  await seedSettings();
  await seedHomepageConfig();
  await seedCreditPacks();
  await seedBumpPacks();
  await seedFeaturedPrices();
  await seedProPlans();
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
