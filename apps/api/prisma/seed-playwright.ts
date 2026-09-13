// Playwright-specific seed: creates the e2e test users.
// Called once by apps/web/e2e/global-setup.ts before any Playwright test runs.
// Uses upsert so it is safe to run multiple times (idempotent).
//
// Users created:
//   seller-e2e@example.com      (emailVerified: true) — publishes the listing in the test
//   buyer-e2e@example.com       (emailVerified: true) — searches and contacts the seller
//   pro-e2e@example.com         (emailVerified: true) — has an active PRO_SUBSCRIPTION
//   admin-e2e@example.com       (role: ADMIN)          — backoffice admin E2E tests
//   moderator-e2e@example.com   (role: MODERATOR)      — backoffice moderator E2E tests
//   editor-e2e@example.com      (role: EDITOR)         — backoffice editor E2E tests
//   role-target-e2e@example.com (role: USER, reset each seed) — target for role-assignment UI test
//
// Password for all: Test1234! (bcrypt cost 4)

import {
  PrismaClient,
  Prisma,
  ProductType,
  SubscriptionStatus,
  EntitlementType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Test1234!', 4);

  await prisma.user.upsert({
    where: { email: 'seller-e2e@example.com' },
    create: {
      email: 'seller-e2e@example.com',
      passwordHash,
      name: 'Vendedor E2E',
      slug: 'vendedor-e2e',
      emailVerified: true,
    },
    // Reset location/phone so prefill tests always start from a known-empty state.
    update: { passwordHash, emailVerified: true, city: null, province: null, postalCode: null, phone: null },
  });

  await prisma.user.upsert({
    where: { email: 'buyer-e2e@example.com' },
    create: {
      email: 'buyer-e2e@example.com',
      passwordHash,
      name: 'Comprador E2E',
      slug: 'comprador-e2e',
      emailVerified: true,
    },
    update: { passwordHash, emailVerified: true },
  });

  // Pro user: needs a Subscription + PRO_SUBSCRIPTION Entitlement
  const proUser = await prisma.user.upsert({
    where: { email: 'pro-e2e@example.com' },
    create: {
      email: 'pro-e2e@example.com',
      passwordHash,
      name: 'Usuario Pro E2E',
      slug: 'usuario-pro-e2e',
      emailVerified: true,
    },
    update: { passwordHash, emailVerified: true },
  });

  // Look up the RECURRING monthly price seeded by seed-test.ts
  const proPrice = await prisma.price.findFirst({
    where: {
      active: true,
      interval: 'MONTH',
      product: { type: ProductType.RECURRING, active: true },
    },
    select: { id: true },
  });

  if (proPrice) {
    // Check if there's already a subscription for this user to stay idempotent
    const existingSub = await prisma.subscription.findFirst({
      where: { userId: proUser.id, status: SubscriptionStatus.ACTIVE },
      select: { id: true },
    });

    if (!existingSub) {
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);

      const subscription = await prisma.subscription.create({
        data: {
          userId: proUser.id,
          priceId: proPrice.id,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          gatewaySubscriptionId: 'sub_test_pro_e2e_playwright',
        },
      });

      await prisma.entitlement.create({
        data: {
          userId: proUser.id,
          type: EntitlementType.PRO_SUBSCRIPTION,
          subscriptionId: subscription.id,
          startsAt: now,
          // expiresAt null = valid until the cron revokes it
        },
      });
    }

    console.log('Playwright seed: pro-e2e subscription + entitlement OK');
  } else {
    console.warn(
      'Playwright seed: no RECURRING price found — run seed-test.ts first (seedProPlans)',
    );
  }

  // ── ACTIVE listing for seller-e2e (needed by RF.11 spec) ──────────────────
  const sellerUser = await prisma.user.findUnique({
    where: { email: 'seller-e2e@example.com' },
    select: { id: true },
  });
  const category = await prisma.category.findFirst({ select: { id: true } });

  if (sellerUser && category) {
    await prisma.listing.upsert({
      where: { slug: 'listing-rf11-e2e' },
      create: {
        title: 'Anuncio RF.11 E2E',
        slug: 'listing-rf11-e2e',
        description: 'Anuncio para pruebas de destacado y bump.',
        price: 50,
        currency: 'EUR',
        priceType: 'FIXED',
        type: 'PRODUCT',
        // condition es obligatorio para PRODUCT en EditarWizard.validateStep('datos') —
        // sin él, el wizard de edición nunca puede avanzar más allá de "Datos" (bug de
        // fixture hallado en H8 Bloque C2: el test de prefill-ubicacion.spec.ts que edita
        // este listing quedaba bloqueado ahí, sin llegar nunca a "Ubicación").
        condition: 'GOOD',
        status: 'ACTIVE',
        sellerId: sellerUser.id,
        categoryId: category.id,
        publishedAt: new Date(),
        city: 'Madrid',
        province: 'Madrid',
      },
      update: { status: 'ACTIVE', city: 'Madrid', province: 'Madrid', condition: 'GOOD' },
    });
    console.log('Playwright seed: listing-rf11-e2e OK');

    // Reset accumulated active listings (except RF.11) to EXPIRED so they do not
    // count against the free-tier active-listing limit during the current test run.
    // Without this, each CI run adds listings and eventually hits the limit of 5,
    // causing ForbiddenException in publishListing → wizard shows submitError → no redirect.
    const { count: deactivated } = await prisma.listing.updateMany({
      where: { sellerId: sellerUser.id, slug: { not: 'listing-rf11-e2e' }, status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    });
    if (deactivated > 0) {
      console.log(`Playwright seed: reset ${deactivated} accumulated active listings to EXPIRED`);
    }

    // BORRADO B2 — un anuncio ARCHIVADO, que es el único estado desde el que el
    // staff puede eliminar. Tiene el suyo propio y no se reutiliza ninguno de los
    // otros a propósito: el test lo BORRA, y llevarse por delante
    // `listing-rf11-e2e` (destacado, bump, prefill) dejaría media batería sin
    // fixture. El `upsert` lo repone en cada run, así que el test puede destruirlo
    // sin dejar la base peor de como la encontró.
    //
    // ARCHIVED no cuenta para la cuota de activos, así que tampoco interfiere con
    // el reseteo de arriba.
    await prisma.listing.upsert({
      where: { slug: 'listing-archivado-e2e' },
      create: {
        title: 'Anuncio Archivado E2E',
        slug: 'listing-archivado-e2e',
        description: 'Anuncio archivado para probar el borrado de staff (B2).',
        price: 30,
        currency: 'EUR',
        priceType: 'FIXED',
        type: 'PRODUCT',
        condition: 'GOOD',
        status: 'ARCHIVED',
        sellerId: sellerUser.id,
        categoryId: category.id,
      },
      update: { status: 'ARCHIVED' },
    });
    console.log('Playwright seed: listing-archivado-e2e OK');
  }

  // ── ACTIVE listing for pro-e2e (needed by H8.5b spec: destacar por cuota) ────
  if (category) {
    await prisma.listing.upsert({
      where: { slug: 'listing-pro-e2e' },
      create: {
        title: 'Anuncio Pro E2E',
        slug: 'listing-pro-e2e',
        description: 'Anuncio del usuario Pro para pruebas de destacado por cuota.',
        price: 75,
        currency: 'EUR',
        priceType: 'FIXED',
        type: 'PRODUCT',
        status: 'ACTIVE',
        sellerId: proUser.id,
        categoryId: category.id,
        publishedAt: new Date(),
        city: 'Madrid',
        province: 'Madrid',
      },
      update: { status: 'ACTIVE', city: 'Madrid', province: 'Madrid' },
    });
    console.log('Playwright seed: listing-pro-e2e OK');
  }

  // ── Raise free-tier listing limit for E2E tests ─────────────────────────────
  // The default limit (5) is hit within a single CI run: RF.11 seed (1) +
  // categoria-meili (3) + flujo-critico (1) = 5 → wizard-herencia throws
  // ForbiddenException in publishListing → no redirect → waitForURL times out.
  // In tests we don't test the limit feature itself, so set it high enough to
  // never be a concern.
  await prisma.setting.upsert({
    where: { key: 'freeActiveListingLimit' },
    create: { key: 'freeActiveListingLimit', value: 100 },
    update: { value: 100 },
  });

  // ── Y los topes TOTALES, por encima de los de activos ───────────────────────
  //
  // NO ES DECORACIÓN: desde la regla #1 de la puerta hay una invariante,
  // `total > activos`, que `AdminService.updateSetting` comprueba en las dos
  // direcciones. Con los totales sin configurar (defaults 10 y 40) y el límite
  // de activos subido a 100 aquí arriba, el entorno de Playwright quedaba
  // INCOHERENTE, y se notó de la peor manera posible: `admin-ajustes-numeric`
  // baja el límite de activos a 7, y al RESTAURARLO a 100 el backend lo
  // rechazaba con un 400 correcto. La spec dejaba el límite en 7 y toda spec
  // posterior que publicara más de siete anuncios moría con un
  // ACTIVE_LIMIT_REACHED que no tenía nada que ver con lo que probaba.
  //
  // La guarda hacía lo que debe; lo que faltaba era que este entorno fuera
  // coherente. Se suben los dos topes MUY por encima de los de activos, por el
  // mismo motivo que el de arriba: aquí no se prueban los límites.
  for (const [key, value] of [
    ['freeTotalListingLimit', 500],
    ['proTotalListingLimit', 500],
  ] as const) {
    await prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  // ── Emisor fiscal ───────────────────────────────────────────────────────────
  // Sin este Setting, POST /billing/facturas responde 400 ISSUER_NOT_CONFIGURED
  // (ver InvoicingService.getFrozenIssuer) y `tickets-admin.spec.ts` moría antes
  // de llegar a lo que de verdad prueba: que un MODERATOR no ve los tickets de
  // facturación y un ADMIN sí. No es un fallo del producto —se niega, con razón,
  // a emitir una factura sin emisor configurado— sino una pieza del entorno que
  // faltaba: las suites de backend (admin-invoicing, invoicing-cron,
  // invoicing-manual) se lo configuran ellas mismas, y Playwright no tenía nada
  // equivalente.
  //
  // Se siembra AQUÍ y no en `seedSettings()` de seed-test.ts a propósito: ese
  // seed lo comparten las dos baterías, y `admin-invoicing.e2e-spec.ts` BORRA
  // esta clave para gobernar su propio escenario. Dejarlo en el seed exclusivo
  // de Playwright evita tocar las condiciones de la batería de backend.
  //
  // Mismos valores que usan las suites de backend, para que un importe/emisor
  // distinto no haga divergir lo que se ve en cada batería.
  await prisma.setting.upsert({
    where: { key: 'fiscalIssuer' },
    create: {
      key: 'fiscalIssuer',
      value: {
        taxId: 'B12345678',
        fiscalName: 'Marketplace S.L.',
        address: 'Av. de la Plataforma 2',
        city: 'Madrid',
        postalCode: '28001',
        province: 'Madrid',
        country: 'ES',
      },
    },
    update: {
      value: {
        taxId: 'B12345678',
        fiscalName: 'Marketplace S.L.',
        address: 'Av. de la Plataforma 2',
        city: 'Madrid',
        postalCode: '28001',
        province: 'Madrid',
        country: 'ES',
      },
    },
  });
  console.log('Playwright seed: fiscalIssuer OK');

  // ── Admin and moderator users for role-separation E2E tests ──────────────────
  await prisma.user.upsert({
    where: { email: 'admin-e2e@example.com' },
    create: {
      email: 'admin-e2e@example.com',
      passwordHash,
      name: 'Admin E2E',
      slug: 'admin-e2e',
      emailVerified: true,
      role: 'ADMIN',
    },
    update: { passwordHash, emailVerified: true, role: 'ADMIN' },
  });

  await prisma.user.upsert({
    where: { email: 'moderator-e2e@example.com' },
    create: {
      email: 'moderator-e2e@example.com',
      passwordHash,
      name: 'Moderador E2E',
      slug: 'moderador-e2e',
      emailVerified: true,
      role: 'MODERATOR',
    },
    update: { passwordHash, emailVerified: true, role: 'MODERATOR' },
  });

  await prisma.user.upsert({
    where: { email: 'editor-e2e@example.com' },
    create: {
      email: 'editor-e2e@example.com',
      passwordHash,
      name: 'Editor E2E',
      slug: 'editor-e2e',
      emailVerified: true,
      role: 'EDITOR',
    },
    update: { passwordHash, emailVerified: true, role: 'EDITOR' },
  });

  // Target user for the /admin/usuarios role-assignment Playwright test — role is
  // always reset to USER on seed so the repeated-role-change test is idempotent
  // regardless of what a previous run left it as.
  await prisma.user.upsert({
    where: { email: 'role-target-e2e@example.com' },
    create: {
      email: 'role-target-e2e@example.com',
      passwordHash,
      name: 'Role Target E2E',
      slug: 'role-target-e2e',
      emailVerified: true,
      role: 'USER',
    },
    update: { passwordHash, emailVerified: true, role: 'USER' },
  });

  // MODERACIÓN M4 — target for the /admin/usuarios "requires review" toggle test.
  // Its own user (not role-target-e2e) so two specs never fight over the same row,
  // and `requiresReview` is reset to false on seed so the test is idempotent.
  await prisma.user.upsert({
    where: { email: 'review-target-e2e@example.com' },
    create: {
      email: 'review-target-e2e@example.com',
      passwordHash,
      name: 'Review Target E2E',
      slug: 'review-target-e2e',
      emailVerified: true,
      role: 'USER',
    },
    update: { passwordHash, emailVerified: true, requiresReview: false },
  });

  console.log(
    'Playwright seed: admin-e2e + moderator-e2e + editor-e2e + role-target-e2e + review-target-e2e OK',
  );

  // ── Test report for moderator E2E tests ───────────────────────────────────────
  // The report is always reset to PENDING so the moderator action test is repeatable.
  const buyerUser = await prisma.user.findUnique({
    where: { email: 'buyer-e2e@example.com' },
    select: { id: true },
  });
  const testListing = await prisma.listing.findUnique({
    where: { slug: 'listing-rf11-e2e' },
    select: { id: true },
  });

  if (buyerUser && testListing) {
    await prisma.report.deleteMany({
      where: { reporterId: buyerUser.id, listingId: testListing.id, reason: 'SPAM' },
    });
    await prisma.report.create({
      data: {
        reporterId: buyerUser.id,
        listingId: testListing.id,
        reason: 'SPAM',
        description: 'Reporte de prueba para tests Playwright de moderación',
        status: 'PENDING',
      },
    });
    console.log('Playwright seed: test SPAM report OK');
  }

  // ── Movimiento facturable + datos fiscales para seller-e2e ────────────────
  // Atención al usuario R7 — `tickets-admin.spec.ts` necesita un ticket con una
  // FACTURA enlazada para ejercer en el navegador la puerta ADMIN-only (el
  // MODERATOR no lo ve ni lo abre). Emitir una factura exige dos cosas que el
  // seed no tenía: datos fiscales del usuario y al menos una Transaction
  // SUCCEEDED sin facturar. Se siembran aquí, de forma IDEMPOTENTE.
  //
  // Ningún otro spec depende del estado fiscal de seller-e2e (comprobado), y las
  // suites e2e de backend truncan User CASCADE en su propio cleanDb, así que
  // este dato no las alcanza.
  if (sellerUser) {
    await prisma.user.update({
      where: { id: sellerUser.id },
      data: {
        fiscalTaxId: '12345678Z',
        fiscalName: 'Vendedor E2E',
        fiscalEntityType: 'INDIVIDUAL',
        fiscalAddress: 'C/ Prueba 1',
        fiscalCity: 'Madrid',
        fiscalPostalCode: '28001',
        fiscalProvince: 'Madrid',
        fiscalCountry: 'ES',
      },
    });

    const anyPrice = await prisma.price.findFirst({ select: { id: true } });
    if (anyPrice) {
      // OJO — la condición es "¿queda algo FACTURABLE?", no "¿hay alguna
      // Transaction?". `tickets-admin.spec.ts` EMITE una factura en cada corrida,
      // y al emitirla la Transaction queda enlazada a una InvoiceLine y deja de
      // ser facturable. Con el guard ingenuo (`status: 'SUCCEEDED'` a secas) la
      // segunda corrida no sembraba nada y la emisión fallaba con 409
      // NO_INVOICEABLE_MOVEMENTS — el clásico "verde la primera vez, rojo al
      // repetir sin resetear la BD" (mismo principio que el reset de `phone` en
      // el seed para prefill-telefono.spec.ts).
      const yaHay = await prisma.transaction.findFirst({
        where: { userId: sellerUser.id, status: 'SUCCEEDED', invoiceLine: { is: null } },
        select: { id: true },
      });
      if (!yaHay) {
        await prisma.transaction.create({
          data: {
            userId: sellerUser.id,
            priceId: anyPrice.id,
            amountGross: 12.1,
            amountNet: 10,
            taxAmount: 2.1,
            taxRate: 0.21,
            status: 'SUCCEEDED',
            gateway: 'REDSYS',
          },
        });
      }
      console.log('Playwright seed: seller-e2e fiscal data + billable transaction OK');
    }
  }

  console.log('Playwright seed: seller-e2e + buyer-e2e + pro-e2e OK');

  await seedContenidoEditorial();
}

/**
 * ══ ESCAPARATE · RÁFAGA B — UN ARTÍCULO Y UNA PÁGINA, DETERMINISTAS ══════════════════
 *
 * Ver `docs/diseno-escaparate.md` §3.2.
 *
 * ── EL HUECO QUE ESTO TAPA ──────────────────────────────────────────────────────────
 *
 * Ni `seed-test.ts` ni este fichero creaban un solo `Post`. Consecuencia: **`/blog/[slug]`
 * y `/paginas/[slug]` no tenían nada que enseñar**, así que no se les podía extender ni la
 * invariancia ni la batería visual — y son dos de las tres superficies que el escaparate
 * va a repintar enteras. Sin contenido no hay red, y sin red no se toca.
 *
 * (La única `PAGE` que existe en algún seed es la política de cookies, y nace en `DRAFT`
 * a propósito: el público no la ve. No sirve para esto.)
 *
 * ── POR QUÉ AQUÍ Y NO EN `seed-test.ts` ─────────────────────────────────────────────
 *
 * Porque `Post.authorId` es obligatorio y `seed-test.ts` **no crea usuarios** — corre
 * ANTES que este fichero, precisamente para sembrar lo estático antes que las cuentas.
 * El autor tiene que existir, así que el contenido editorial vive donde viven sus autores.
 *
 * ── QUÉ LOS HACE DETERMINISTAS, QUE ES TODO EL PUNTO ────────────────────────────────
 *
 * Una captura que cambia sola no es una red: es ruido con coste de CI. Así que:
 *
 *  · **`publishedAt` FIJO**, y a las 12:00 UTC. La ficha lo pinta con
 *    `toLocaleDateString('es-ES')`, así que una fecha «ahora» daría una captura distinta
 *    cada día. Las 12:00 y no las 00:00 porque el servidor formatea en SU huso: a
 *    medianoche, cualquier huso al oeste retrocede el día y la captura cambia de texto
 *    sin que nadie haya tocado nada.
 *  · **Ni una imagen.** Sin `coverUrl` y sin bloques `image`/`imageText`. Una imagen
 *    obliga a que exista el objeto en MinIO y a que cargue a tiempo; si falta, la captura
 *    fotografía un roto. Los idiomas visuales que el escaparate repinta —tarjeta, caja,
 *    filete, acordeón, botón— no necesitan ninguna.
 *  · **Ni un bloque que consulte fuera.** Nada de `listings`: su contenido sale de
 *    Meilisearch y su orden, de la ventana de rotación de 15 minutos
 *    (`docs/diseno-rotacion-destacados.md`). Dos capturas a distinto lado de una ventana
 *    saldrían distintas — un rojo que no significa nada.
 *
 * ── LA MUESTRA ES POR IDIOMA VISUAL, NO POR TIPO DE BLOQUE ──────────────────────────
 *
 * No están los 16 tipos, y no es pereza: es el mismo criterio con el que la batería visual
 * eligió sus pantallas («por COBERTURA DE IDIOMA VISUAL, no de rutas»). Están los gestos
 * que la ráfaga C va a cambiar: el párrafo, la cita, los pasos numerados, el acordeón, la
 * tabla, las tarjetas de enlace y el CTA — que es el que se convierte en banda.
 *
 * ⚠ SI SE TOCA ESTO, CAMBIAN LAS CAPTURAS. Es contenido de una barrera visual, no datos
 * de relleno: añadir un bloque o cambiar una palabra pone en rojo `publico-blog-articulo`
 * y `publico-pagina`, y hay que regenerar los baselines a propósito.
 */
const BLOG_SLUG = 'guia-comprar-bici-segunda-mano';
const PAGINA_SLUG = 'como-comprar-con-seguridad';
const PUBLICADO_EL = new Date('2026-01-15T12:00:00.000Z');

async function seedContenidoEditorial() {
  const autor = await prisma.user.findUnique({
    where: { email: 'editor-e2e@example.com' },
    select: { id: true },
  });
  if (!autor) {
    throw new Error('Playwright seed: falta editor-e2e — el contenido editorial no tiene autor');
  }

  const articulo = {
    type: 'POST' as const,
    title: 'Qué mirar antes de comprar una bici de segunda mano',
    excerpt:
      'Cuadro, transmisión y frenos cuentan la vida entera de una bicicleta. Aprende a leerlos en cinco minutos.',
    tags: ['guias', 'bicicletas'],
    status: 'PUBLISHED' as const,
    publishedAt: PUBLICADO_EL,
    authorId: autor.id,
    blocks: [
      {
        id: 'art-intro',
        type: 'text',
        markdown:
          'Una bicicleta usada cuenta su vida en tres sitios: el **cuadro**, la ' +
          'transmisión y los frenos. Mirarlos lleva cinco minutos y evita casi todos los ' +
          'disgustos.\n\nNo hace falta ser mecánico. Hace falta saber dónde mirar.',
      },
      {
        id: 'art-cita',
        type: 'quote',
        text: 'Si el precio es la mitad de lo que vale y el vendedor tiene prisa, el problema no es el precio.',
        author: 'Equipo de confianza y seguridad',
      },
      {
        id: 'art-pasos',
        type: 'steps',
        title: 'La revisión de cinco minutos',
        items: [
          {
            title: 'El cuadro, a contraluz',
            description:
              'Busca grietas en las uniones y bultos en la pintura. Una soldadura repasada se ve.',
          },
          {
            title: 'La transmisión, girando',
            description:
              'Los dientes gastados tienen forma de ola. Si la cadena salta al pedalear fuerte, hay que cambiarla entera.',
          },
          {
            title: 'Los frenos, apretando',
            description:
              'La maneta no debe tocar el manillar. En disco, mira el grosor de la pastilla.',
          },
        ],
      },
      {
        id: 'art-faq',
        type: 'faq',
        title: 'Preguntas frecuentes',
        items: [
          {
            question: '¿Merece la pena una bici sin factura?',
            answer:
              'Sí, siempre que el número de cuadro no esté borrado. Un número limado es motivo para irse.',
          },
          {
            question: '¿Cuánto se puede regatear?',
            answer: 'Lo que cueste reparar lo que has encontrado, ni un euro más.',
          },
        ],
      },
      {
        id: 'art-cta',
        type: 'cta',
        label: 'Ver bicicletas cerca de ti',
        href: '/busqueda',
        style: 'primary',
      },
    ] as unknown as Prisma.InputJsonValue,
  };

  const pagina = {
    type: 'PAGE' as const,
    title: 'Cómo comprar con seguridad',
    excerpt: 'Seis hábitos que evitan casi todos los problemas en una compraventa entre particulares.',
    tags: [],
    status: 'PUBLISHED' as const,
    publishedAt: PUBLICADO_EL,
    authorId: autor.id,
    blocks: [
      {
        id: 'pag-intro',
        type: 'text',
        markdown:
          'Comprar de segunda mano es, casi siempre, una transacción sin sobresaltos. Los ' +
          'problemas se concentran en un puñado de patrones repetidos, y todos ellos se ' +
          'detectan **antes de pagar**.',
      },
      {
        id: 'pag-cita',
        type: 'quote',
        text: 'Un vendedor honesto no pondrá ninguna pega en quedar en un sitio público.',
        author: 'Equipo de confianza y seguridad',
      },
      {
        id: 'pag-pasos',
        type: 'steps',
        title: 'Antes de pagar',
        items: [
          {
            title: 'Queda en un sitio público',
            description: 'Una cafetería, una gasolinera, la puerta de una comisaría.',
          },
          {
            title: 'Comprueba el artículo encendido',
            description: 'Si lleva batería o pantalla, que funcione delante de ti.',
          },
          {
            title: 'Paga cuando lo tengas en la mano',
            description: 'Nunca por adelantado, y nunca por un medio que no se pueda reclamar.',
          },
        ],
      },
      { id: 'pag-sep', type: 'separator' },
      {
        id: 'pag-tabla',
        type: 'table',
        headers: ['Señal', 'Qué suele significar'],
        rows: [
          ['Precio muy por debajo del mercado', 'El artículo no existe o no es lo que dice'],
          ['Prisa por cerrar', 'No quiere que lo mires con calma'],
          ['Solo acepta pago por adelantado', 'No hay artículo que entregar'],
        ],
      },
      {
        id: 'pag-faq',
        type: 'faq',
        title: 'Preguntas frecuentes',
        items: [
          {
            question: '¿Puedo pedir el número de serie antes de quedar?',
            answer: 'Sí, y una negativa sin explicación es una respuesta en sí misma.',
          },
          {
            question: '¿Qué hago si algo no encaja?',
            answer: 'Denunciar el anuncio lleva veinte segundos y lo revisa una persona.',
          },
        ],
      },
      {
        id: 'pag-hub',
        type: 'hub',
        title: 'Sigue leyendo',
        links: [
          {
            label: 'Cómo publicar un anuncio',
            href: '/publicar',
            description: 'Fotos, descripción y precio en un par de minutos.',
          },
          {
            label: 'Buscar por categoría',
            href: '/busqueda',
            description: 'Filtra por provincia, precio y estado.',
          },
        ],
      },
      {
        id: 'pag-cta',
        type: 'cta',
        label: 'Denunciar un anuncio',
        href: '/contacto',
        style: 'primary',
      },
    ] as unknown as Prisma.InputJsonValue,
  };

  for (const [slug, datos] of [
    [BLOG_SLUG, articulo],
    [PAGINA_SLUG, pagina],
  ] as const) {
    // `update` COMPLETO y no un `create`-si-no-existe: es una fila estática compartida
    // por toda la corrida y un spec podría haberla editado. Mismo criterio que
    // `seedHomepageConfig` en seed-test.ts — «un PATCH de un spec sobreviviría para
    // contaminar la corrida siguiente».
    await prisma.post.upsert({
      where: { slug },
      create: { slug, ...datos },
      update: datos,
    });
  }

  console.log(`Playwright seed: contenido editorial OK (/blog/${BLOG_SLUG}, /paginas/${PAGINA_SLUG})`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
