import { PrismaClient, Prisma, Role, ProductType, PriceInterval } from '@prisma/client';
import * as bcrypt from 'bcrypt';
// ENCENDER EL VÍDEO — la lista de ajustes vive aparte para que un test pueda mirarla sin
// ejecutar la semilla entera (este fichero tiene un `main()` en la raíz).
import { SEED_SETTINGS } from './seed-settings';
// COOKIES RÁFAGA 3 — el contenido de la política vive aparte por el mismo motivo: para
// que un test pueda comprobar que los huecos siguen marcados sin ejecutar la semilla.
import {
  PAGINA_COOKIES_BLOQUES,
  PAGINA_COOKIES_RUTA,
  PAGINA_COOKIES_SLUG,
  PAGINA_COOKIES_TITULO,
} from './seed-pagina-cookies';
// SEED SEGURO — la credencial del administrador NO vive en este fichero (ni en ninguno).
// La resolución del entorno vive aparte para que la barrera pueda probar sus cuatro
// caminos sin base de datos. Ver docs/auditoria-seed.md §4.2.
import { resolverCredencialAdmin, VAR_PASSWORD_ADMIN } from './seed-admin';
// SEED COMPLETO — lo que una base recién migrada necesita y ningún script podía ya crear.
import { COLUMNAS_PIE, MOTIVOS_CONTACTO, NAV_INICIAL } from './seed-datos-iniciales';

const BCRYPT_ROUNDS = 12;

/**
 * EL CLIENTE SE PASA, NO SE CIERRA SOBRE ÉL — y no es ceremonia.
 *
 * Antes había un `new PrismaClient()` en el módulo y un `main()` en la raíz, así que
 * este fichero no se podía ni importar: mirarlo lo ejecutaba. Es la misma pared con la
 * que ya chocaron `SEED_SETTINGS` y los bloques de la página de cookies, que acabaron
 * en módulos aparte para poder mirarse.
 *
 * Aquí lo que hay que poder mirar no son datos, es el COMPORTAMIENTO: que el rol no se
 * re-fuerce, que las categorías no se reviertan, que re-ejecutar no duplique. Con el
 * cliente como parámetro y la llamada de abajo bajo `require.main`, la barrera ejecuta
 * la semilla ENTERA —dos veces— contra un doble en memoria, sin Postgres y sin red.
 */
type ClienteSemilla = PrismaClient;

interface AttributeField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  unit?: string;
  options?: string[];
  filterable: boolean;
  required: boolean;
  cardAttribute?: boolean;
  /** Select vinculado — name de otro atributo select del que dependen las opciones. */
  dependsOn?: string;
  /** Opciones válidas por valor de `dependsOn`. Solo junto a `dependsOn`. */
  optionsByParent?: Record<string, string[]>;
}

interface CategorySeed {
  name: string;
  slug: string;
  order: number;
  attributeSchema: AttributeField[];
  children?: Omit<CategorySeed, 'children'>[];
}

const CATEGORIES: CategorySeed[] = [
  {
    name: 'Vehículos',
    slug: 'vehiculos',
    order: 1,
    // RC5.2b: year+km moved here from the three children (common to all).
    // Effective schema for each child = [year, km] (inherited) + own fields.
    // listing.attributes is unchanged; only where the schema is DEFINED moves.
    attributeSchema: [
      { name: 'year', label: 'Año', type: 'number', filterable: true, required: true, cardAttribute: true },
      { name: 'km', label: 'Kilómetros', type: 'number', unit: 'km', filterable: true, required: true },
    ],
    children: [
      {
        name: 'Coches',
        slug: 'coches',
        order: 1,
        // year + km inherited from Vehículos. Effective = [year, km, brand, model, fuel, gearbox, power].
        // Card shows: "Año: 2022 · Marca: Toyota"
        // brand/model: selects vinculados (dependsOn/optionsByParent) — catálogo real,
        // no el caso mínimo de demostración de la ráfaga del mecanismo. Las claves de
        // model.optionsByParent son EXACTAMENTE brand.options (mismos strings) — es la
        // coherencia que el mecanismo exige entre los dos atributos.
        attributeSchema: [
          {
            name: 'brand',
            label: 'Marca',
            type: 'select',
            options: ['Seat', 'Volkswagen', 'Toyota', 'Renault', 'Peugeot', 'BMW'],
            filterable: true,
            required: true,
            cardAttribute: true,
          },
          {
            name: 'model',
            label: 'Modelo',
            type: 'select',
            dependsOn: 'brand',
            optionsByParent: {
              Seat: ['Ibiza', 'León', 'Arona', 'Ateca'],
              Volkswagen: ['Golf', 'Polo', 'Passat', 'Tiguan'],
              Toyota: ['Corolla', 'Yaris', 'RAV4', 'Auris'],
              Renault: ['Clio', 'Megane', 'Captur'],
              Peugeot: ['208', '308', '3008'],
              BMW: ['Serie 1', 'Serie 3', 'X1', 'X3'],
            },
            filterable: true,
            required: true,
          },
          {
            name: 'fuel',
            label: 'Combustible',
            type: 'select',
            options: ['Gasolina', 'Diésel', 'Eléctrico', 'Híbrido', 'GLP'],
            filterable: true,
            required: true,
          },
          {
            name: 'gearbox',
            label: 'Cambio',
            type: 'select',
            options: ['Manual', 'Automático'],
            filterable: true,
            required: false,
          },
          { name: 'power', label: 'Potencia', type: 'number', unit: 'CV', filterable: false, required: false },
        ],
      },
      {
        name: 'Motos',
        slug: 'motos',
        order: 2,
        // year + km inherited from Vehículos. Effective = [year, km, brand, displacement].
        // Card shows: "Año: X · Marca: Y"
        attributeSchema: [
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: true, cardAttribute: true },
          { name: 'displacement', label: 'Cilindrada', type: 'number', unit: 'cc', filterable: true, required: false },
        ],
      },
      {
        name: 'Furgonetas y camiones',
        slug: 'furgonetas',
        order: 3,
        // year + km inherited from Vehículos. Effective = [year, km, fuel].
        attributeSchema: [
          {
            name: 'fuel',
            label: 'Combustible',
            type: 'select',
            options: ['Gasolina', 'Diésel', 'Eléctrico'],
            filterable: true,
            required: false,
          },
        ],
      },
    ],
  },
  {
    name: 'Inmuebles',
    slug: 'inmuebles',
    order: 2,
    attributeSchema: [],
    children: [
      {
        name: 'Pisos y apartamentos',
        slug: 'pisos',
        order: 1,
        // Card shows: "80 m² · 3 hab"
        attributeSchema: [
          { name: 'sqm', label: 'Superficie', type: 'number', unit: 'm²', filterable: true, required: true, cardAttribute: true },
          { name: 'rooms', label: 'Habitaciones', type: 'number', filterable: true, required: true, cardAttribute: true },
          { name: 'bathrooms', label: 'Baños', type: 'number', filterable: true, required: false },
          { name: 'floor', label: 'Planta', type: 'number', filterable: false, required: false },
          { name: 'elevator', label: 'Ascensor', type: 'boolean', filterable: true, required: false },
          { name: 'garage', label: 'Garaje', type: 'boolean', filterable: true, required: false },
        ],
      },
      {
        name: 'Casas y chalets',
        slug: 'casas',
        order: 2,
        // Card shows: "120 m² · 4 hab"
        attributeSchema: [
          { name: 'sqm', label: 'Superficie', type: 'number', unit: 'm²', filterable: true, required: true, cardAttribute: true },
          { name: 'rooms', label: 'Habitaciones', type: 'number', filterable: true, required: true, cardAttribute: true },
          { name: 'bathrooms', label: 'Baños', type: 'number', filterable: false, required: false },
          { name: 'garage', label: 'Garaje', type: 'boolean', filterable: true, required: false },
          { name: 'pool', label: 'Piscina', type: 'boolean', filterable: true, required: false },
          { name: 'garden', label: 'Jardín', type: 'boolean', filterable: false, required: false },
        ],
      },
      {
        name: 'Locales y oficinas',
        slug: 'locales',
        order: 3,
        attributeSchema: [
          { name: 'sqm', label: 'Superficie', type: 'number', unit: 'm²', filterable: true, required: true },
          { name: 'floor', label: 'Planta', type: 'number', filterable: false, required: false },
        ],
      },
    ],
  },
  {
    name: 'Tecnología',
    slug: 'tecnologia',
    order: 3,
    attributeSchema: [],
    children: [
      {
        name: 'Móviles y smartphones',
        slug: 'moviles',
        order: 1,
        // Card shows: "Apple · 128 GB"
        attributeSchema: [
          {
            name: 'brand',
            label: 'Marca',
            type: 'select',
            options: ['Apple', 'Samsung', 'Xiaomi', 'Huawei', 'Google', 'OnePlus', 'Otro'],
            filterable: true,
            required: true,
            cardAttribute: true,
          },
          { name: 'model', label: 'Modelo', type: 'text', filterable: false, required: false },
          {
            name: 'storage',
            label: 'Almacenamiento',
            type: 'select',
            options: ['16 GB', '32 GB', '64 GB', '128 GB', '256 GB', '512 GB', '1 TB'],
            filterable: true,
            required: false,
            cardAttribute: true,
          },
          { name: 'color', label: 'Color', type: 'text', filterable: false, required: false },
        ],
      },
      {
        name: 'Ordenadores',
        slug: 'ordenadores',
        order: 2,
        // Card shows: "Portátil · 16 GB"
        attributeSchema: [
          {
            name: 'itemType',
            label: 'Tipo',
            type: 'select',
            options: ['Portátil', 'Sobremesa', 'Todo en uno', 'Mini PC'],
            filterable: true,
            required: true,
            cardAttribute: true,
          },
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false },
          {
            name: 'ram',
            label: 'RAM',
            type: 'select',
            options: ['4 GB', '8 GB', '16 GB', '32 GB', '64 GB'],
            filterable: true,
            required: false,
            cardAttribute: true,
          },
          { name: 'storage', label: 'Almacenamiento', type: 'text', filterable: false, required: false },
        ],
      },
      {
        name: 'Electrodomésticos',
        slug: 'electrodomesticos',
        order: 3,
        // Card shows: "Tipo de electrodoméstico"
        attributeSchema: [
          { name: 'itemType', label: 'Tipo', type: 'text', filterable: true, required: true, cardAttribute: true },
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false },
        ],
      },
    ],
  },
  {
    name: 'Moda',
    slug: 'moda',
    order: 4,
    attributeSchema: [],
    children: [
      {
        name: 'Ropa',
        slug: 'ropa',
        order: 1,
        // Card shows: "Mujer · M"
        attributeSchema: [
          {
            name: 'gender',
            label: 'Género',
            type: 'select',
            options: ['Hombre', 'Mujer', 'Unisex', 'Niño', 'Niña'],
            filterable: true,
            required: false,
            cardAttribute: true,
          },
          {
            name: 'size',
            label: 'Talla',
            type: 'select',
            options: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Otra'],
            filterable: true,
            required: false,
            cardAttribute: true,
          },
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false },
          { name: 'color', label: 'Color', type: 'text', filterable: false, required: false },
        ],
      },
      {
        name: 'Calzado',
        slug: 'calzado',
        order: 2,
        // Card shows: "Mujer · 38"
        attributeSchema: [
          {
            name: 'gender',
            label: 'Género',
            type: 'select',
            options: ['Hombre', 'Mujer', 'Unisex', 'Niño', 'Niña'],
            filterable: true,
            required: false,
            cardAttribute: true,
          },
          {
            name: 'size',
            label: 'Talla',
            type: 'select',
            options: ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45'],
            filterable: true,
            required: false,
            cardAttribute: true,
          },
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false },
          { name: 'color', label: 'Color', type: 'text', filterable: false, required: false },
        ],
      },
      {
        name: 'Accesorios',
        slug: 'accesorios',
        order: 3,
        attributeSchema: [
          { name: 'itemType', label: 'Tipo', type: 'text', filterable: true, required: false },
          { name: 'brand', label: 'Marca', type: 'text', filterable: false, required: false },
        ],
      },
    ],
  },
  {
    name: 'Hogar y jardín',
    slug: 'hogar',
    order: 5,
    attributeSchema: [],
    children: [
      {
        name: 'Muebles',
        slug: 'muebles',
        order: 1,
        attributeSchema: [
          { name: 'itemType', label: 'Tipo', type: 'text', filterable: true, required: false },
          { name: 'material', label: 'Material', type: 'text', filterable: false, required: false },
          { name: 'color', label: 'Color', type: 'text', filterable: false, required: false },
        ],
      },
      {
        name: 'Decoración',
        slug: 'decoracion',
        order: 2,
        attributeSchema: [],
      },
      {
        name: 'Jardín',
        slug: 'jardin',
        order: 3,
        attributeSchema: [],
      },
    ],
  },
  {
    name: 'Servicios',
    slug: 'servicios',
    order: 6,
    attributeSchema: [],
    children: [
      {
        name: 'Reformas y construcción',
        slug: 'reformas',
        order: 1,
        attributeSchema: [
          { name: 'specialty', label: 'Especialidad', type: 'text', filterable: true, required: false },
          { name: 'experience', label: 'Años de experiencia', type: 'number', filterable: false, required: false },
        ],
      },
      {
        name: 'Transporte y mudanzas',
        slug: 'transporte',
        order: 2,
        attributeSchema: [
          { name: 'vehicleType', label: 'Tipo de vehículo', type: 'text', filterable: false, required: false },
        ],
      },
      {
        name: 'Clases y formación',
        slug: 'clases',
        order: 3,
        attributeSchema: [
          { name: 'subject', label: 'Materia', type: 'text', filterable: true, required: false },
          {
            name: 'modality',
            label: 'Modalidad',
            type: 'select',
            options: ['Presencial', 'Online', 'Ambas'],
            filterable: true,
            required: false,
          },
        ],
      },
    ],
  },
];

/**
 * LAS CATEGORÍAS SE CREAN, PERO NO SE REVIERTEN — `update: {}`, y es el cambio entero.
 *
 * Ver docs/auditoria-seed.md §5.1.
 *
 * Esto era `update: { name, order, attributeSchema, parentId }`, es decir: **cada
 * `db seed` devolvía el árbol a lo que dijera este fichero**. Y `/admin/categorias`
 * deja renombrar, reordenar, reparentar y editar el `attributeSchema`, así que un
 * administrador que ajustara «Coches» perdía el ajuste en el siguiente despliegue, sin
 * aviso y sin rastro. El `attributeSchema` es el más caro de perder: arrastra consigo
 * los `filterableAttributes` del índice de Meilisearch.
 *
 * Era, además, la ÚNICA parte de esta semilla que pisaba trabajo de un administrador.
 * Todo lo demás ya respetaba la misma doctrina, escrita tres veces en este fichero: los
 * ajustes con `skipDuplicates`, la portada con su guarda de `updatedById`, y la página
 * de cookies, que si existe ni se mira.
 *
 * LO QUE SE PIERDE, dicho claro: cambiar `CATEGORIES` aquí ya no refresca las
 * categorías de una base que ya las tiene. Es la mitad buena del trato — «refrescar el
 * árbol canónico» es una decisión consciente, no un efecto lateral de desplegar —, pero
 * conviene saberlo: para propagar un cambio del árbol a una base ya sembrada hay que
 * hacerlo desde el backoffice o con una migración de datos.
 *
 * El `upsert` se mantiene (en vez de un «buscar y crear si falta») porque su `where`
 * único sobre el `slug` hace imposible crear dos: dos ejecuciones simultáneas no pueden
 * duplicar una categoría.
 */
async function seedCategories(prisma: ClienteSemilla) {
  console.log('Seeding categories...');
  for (const cat of CATEGORIES) {
    const parent = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: { name: cat.name, slug: cat.slug, order: cat.order, attributeSchema: cat.attributeSchema as unknown as Prisma.InputJsonValue },
    });

    if (cat.children) {
      for (const child of cat.children) {
        await prisma.category.upsert({
          where: { slug: child.slug },
          update: {},
          create: {
            name: child.name,
            slug: child.slug,
            order: child.order,
            attributeSchema: child.attributeSchema as unknown as Prisma.InputJsonValue,
            parentId: parent.id,
          },
        });
        console.log(`  ✓ ${parent.name} > ${child.name}`);
      }
    } else {
      console.log(`  ✓ ${parent.name}`);
    }
  }
}

/**
 * EL ADMINISTRADOR — SIN NINGUNA CREDENCIAL EN EL CÓDIGO, Y SIN INVENTARSE NINGUNA.
 *
 * Ver `seed-admin.ts` para el porqué y docs/auditoria-seed.md §4.2 para el defecto que
 * cierra (`Admin1234!` escrito aquí, en un repositorio que alguien puede leer).
 *
 * ─── DOS REGLAS, Y LAS DOS SE VEN EN ESTAS LÍNEAS ───────────────────────────────
 *
 * 1. **Sin credencial configurada no se crea nada.** No hay defecto de desarrollo, no se
 *    genera una cuenta «provisional»: se avisa de qué falta, con qué poner y dónde, y la
 *    semilla SIGUE. El resto (categorías, ajustes, catálogo) es válido y no tiene por qué
 *    caerse con esto; fallar entero dejaría media base sembrada por un dato que se
 *    arregla en diez segundos.
 *
 * 2. **`update: {}` — el rol NO se re-fuerza.** Antes era
 *    `update: { role: ADMIN, emailVerified: true }`, así que si alguien degradaba esa
 *    cuenta a propósito, el siguiente despliegue la volvía a hacer administradora en
 *    silencio. Una semilla no revoca decisiones de seguridad de un operador. Si la fila
 *    existe, no se toca: ni el rol, ni la verificación, ni —como ya ocurría— la
 *    contraseña.
 */
async function seedAdmin(prisma: ClienteSemilla, env: NodeJS.ProcessEnv) {
  console.log('Seeding admin user...');

  const credencial = resolverCredencialAdmin(env);
  if (credencial.estado !== 'ok') {
    console.warn(`  ⚠ ${credencial.aviso}`);
    return;
  }

  const existente = await prisma.user.findUnique({
    where: { email: credencial.email },
    select: { id: true },
  });
  if (existente) {
    // Ni rol ni contraseña ni verificación: lo que haya encima manda.
    console.log(`  ✓ ${credencial.email} ya existe, intacto (rol y contraseña sin tocar)`);
    return;
  }

  const passwordHash = await bcrypt.hash(credencial.password, BCRYPT_ROUNDS);
  await prisma.user.upsert({
    where: { email: credencial.email },
    update: {},
    create: {
      email: credencial.email,
      name: 'Admin',
      // El slug sale del correo y no es 'admin' fijo: dos instancias con correos
      // distintos no deben pelearse por el mismo slug, que es único.
      slug: slugDesdeEmail(credencial.email),
      passwordHash,
      role: Role.ADMIN,
      emailVerified: true,
    },
  });
  console.log(`  ✓ ${credencial.email} creado (role: ADMIN), contraseña de ${VAR_PASSWORD_ADMIN}`);
}

/**
 * Un slug a partir del correo: la parte local, sin nada que no sea letra, número o guion.
 * `admin@marketplace.local` → `admin`. Con un respaldo por si la parte local fuera toda
 * símbolos, porque `User.slug` es obligatorio y único.
 */
function slugDesdeEmail(email: string): string {
  const base = email
    .split('@')[0]
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'admin';
}

async function seedSettings(prisma: ClienteSemilla) {
  console.log('Seeding settings...');
  // createMany + skipDuplicates: only inserts keys that don't exist yet.
  // Values that an admin has already changed via the backoffice are NEVER overwritten.
  const { count } = await prisma.setting.createMany({
    data: SEED_SETTINGS,
    skipDuplicates: true,
  });
  if (count > 0) {
    console.log(`  ✓ ${count} setting(s) created`);
  } else {
    console.log('  ✓ settings already present, skipped');
  }
}

async function seedBillingCatalog(prisma: ClienteSemilla) {
  console.log('Seeding billing catalog...');
  const existing = await prisma.product.count();
  if (existing > 0) {
    console.log('  ✓ billing catalog already present, skipped');
    return;
  }

  const featured = await prisma.product.create({
    data: {
      name: 'Destacado de anuncio',
      description: 'Destaca tu anuncio en los resultados de búsqueda durante un período fijo.',
      type: ProductType.ONE_TIME,
    },
  });

  await prisma.price.createMany({
    data: [
      { productId: featured.id, amount: new Prisma.Decimal('2.99'), durationDays: 7 },
      { productId: featured.id, amount: new Prisma.Decimal('4.99'), durationDays: 14 },
      { productId: featured.id, amount: new Prisma.Decimal('7.99'), durationDays: 30 },
    ],
  });
  console.log('  ✓ Product: Destacado de anuncio (7/14/30 días)');

  const pro = await prisma.product.create({
    data: {
      name: 'Plan Pro',
      description: 'Accede a funciones avanzadas: más anuncios activos, más fotos y badge Pro.',
      type: ProductType.RECURRING,
    },
  });

  await prisma.price.createMany({
    data: [
      { productId: pro.id, amount: new Prisma.Decimal('9.99'), interval: PriceInterval.MONTH, intervalCount: 1 },
      { productId: pro.id, amount: new Prisma.Decimal('89.99'), interval: PriceInterval.YEAR, intervalCount: 1 },
    ],
  });
  console.log('  ✓ Product: Plan Pro (mensual/anual)');
}

async function seedCreditPacks(prisma: ClienteSemilla) {
  console.log('Seeding credit packs...');
  const existing = await prisma.creditPack.count();
  if (existing > 0) {
    console.log('  ✓ credit packs already present, skipped');
    return;
  }

  // Credit pack Prices need a Product to satisfy the non-nullable productId FK.
  const packsProduct = await prisma.product.create({
    data: {
      name: 'Packs de créditos',
      description: 'Paquetes de créditos internos para destacar anuncios y bumps.',
      type: ProductType.ONE_TIME,
    },
  });

  const packs: {
    name: string;
    description: string;
    creditAmount: number;
    amount: string;
  }[] = [
    { name: 'Pack Básico', description: '50 créditos para empezar.', creditAmount: 50, amount: '4.99' },
    { name: 'Pack Estándar', description: '150 créditos con mejor relación calidad-precio.', creditAmount: 150, amount: '9.99' },
    { name: 'Pack Max', description: '400 créditos para usuarios frecuentes.', creditAmount: 400, amount: '19.99' },
    // Monetización ráfaga 4: retirado el "Pack de bumps" (Opción B, ráfaga 2
    // — créditos con highlightBumps). Sustituido por BumpPack, ver
    // seedBumpPacks(). En bases de datos ya sembradas, ese CreditPack se
    // desactiva vía migración de datos (20260716090500_deactivate_
    // highlightbumps_pack), no aquí — el seed no toca datos existentes.
  ];

  for (const p of packs) {
    const pack = await prisma.creditPack.create({
      data: {
        name: p.name,
        description: p.description,
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
    console.log(`  ✓ ${p.name} (${p.creditAmount} cr / ${p.amount} €)`);
  }
}

async function seedBumpPacks(prisma: ClienteSemilla) {
  console.log('Seeding bump packs...');
  const existing = await prisma.bumpPack.count();
  if (existing > 0) {
    console.log('  ✓ bump packs already present, skipped');
    return;
  }

  // Bump pack Prices need a Product to satisfy the non-nullable productId FK
  // — producto propio, distinto de "Packs de créditos" (moneda distinta).
  const packsProduct = await prisma.product.create({
    data: {
      name: 'Packs de bumps',
      description: 'Paquetes de bumps directos para subir tus anuncios.',
      type: ProductType.ONE_TIME,
    },
  });

  const packs: { name: string; description: string; bumpAmount: number; amount: string }[] = [
    { name: 'Pack 5 bumps', description: '5 bumps para dar un empujón puntual.', bumpAmount: 5, amount: '2.99' },
    { name: 'Pack 15 bumps', description: '15 bumps con mejor relación calidad-precio.', bumpAmount: 15, amount: '6.99' },
    { name: 'Pack 40 bumps', description: '40 bumps para vendedores activos.', bumpAmount: 40, amount: '14.99' },
  ];

  for (const p of packs) {
    const pack = await prisma.bumpPack.create({
      data: { name: p.name, description: p.description, bumpAmount: p.bumpAmount },
    });
    await prisma.price.create({
      data: {
        productId: packsProduct.id,
        amount: new Prisma.Decimal(p.amount),
        bumpPackId: pack.id,
      },
    });
    console.log(`  ✓ ${p.name} (${p.bumpAmount} bumps / ${p.amount} €)`);
  }
}

// Fila ÚNICA de la configuración de portada. Desde RP.6 la portada la pinta
// ENTERA el motor, así que esta lista ES la portada: lo que no esté aquí, no se
// ve. Reproduce EXACTAMENTE lo que la home pintaba a mano y EN EL MISMO ORDEN.
//
//   hero      — mismo <h1>, sin opciones rotativas y sin subtítulo (el rotativo
//               está implementado y probado, solo no sembrado; lo activa el
//               admin cuando quiera).
//   search    — el buscador, su eyebrow ("Miles de anuncios cerca de ti") y los
//               chips "Populares", con el mismo tope de 6 que tenía la constante
//               POPULAR_CATEGORY_COUNT.
//   cta       — "¿Tienes algo que vender? Publica gratis".
//   listings  — "Recién publicados" (de todo el sitio, sin categoría).
//   steps     — "Cómo funciona" (las dos audiencias, tal cual).
//   grid      — la fila de cuatro señales de confianza.
//
// La REJILLA de categorías no está aquí y no es un olvido: la pinta la página
// como fallback justo antes del primer bloque `listings`, que es su sitio de
// siempre (ver (home)/page.tsx). No se puede sembrar como `categoryCarousel`
// porque cada categoría necesita una FOTO SUBIDA que nadie ha subido todavía
// (`imageUrl` es @IsOwnStorageUrl, no admite una URL inventada). Lo monta el
// admin desde /admin/portada — el bloque, su editor y su upload están hechos y
// probados. Ver docs/estado-tecnico.md.
//
// `searchTable` TAMPOCO se siembra, y esta vez no por imposibilidad técnica —sus
// dos pestañas sin configuración se sembrarían perfectamente— sino por decisión:
// **la portada tras RP.6 es EXACTAMENTE la de antes**. Una semilla no añade
// secciones que nadie ha pedido. El bloque existe, funciona y es configurable;
// aparece cuando un admin lo añade desde /admin/portada, igual que el carrusel.
const HOMEPAGE_SEED_BLOCKS = [
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
          {
            title: 'Busca lo que necesitas',
            description: 'Usa el buscador o explora por categorías hasta encontrarlo.',
          },
          {
            title: 'Contacta con el vendedor',
            description: 'Pregunta tus dudas por mensajería interna, sin dar tu teléfono.',
          },
          {
            title: 'Queda y valora',
            description: 'Cierra el trato en persona y deja tu opinión al vendedor.',
          },
        ],
        cta: { label: 'Buscar ahora →', href: '/busqueda' },
      },
      {
        audienceTitle: 'Para vendedores',
        icon: 'upload',
        steps: [
          {
            title: 'Publica gratis',
            description: 'Sube fotos y describe tu artículo en un par de minutos.',
          },
          {
            title: 'Gestiona tus mensajes',
            description: 'Responde a los interesados desde tu bandeja de mensajes.',
          },
          {
            title: 'Destaca tu anuncio (opcional)',
            description: 'Dale más visibilidad si quieres vender más rápido.',
          },
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
      {
        media: { kind: 'icon', name: 'message-circle' },
        title: 'Mensajería sin compartir tu teléfono',
      },
      { media: { kind: 'icon', name: 'star' }, title: 'Valoraciones entre usuarios' },
      { media: { kind: 'icon', name: 'sparkles' }, title: 'Publicar es gratis' },
    ],
  },
];

async function seedHomepageConfig(prisma: ClienteSemilla) {
  console.log('Seeding homepage config...');
  const existing = await prisma.homepageConfig.findUnique({ where: { id: 'singleton' } });

  if (!existing) {
    await prisma.homepageConfig.create({
      data: {
        id: 'singleton',
        heroStaticTitle: 'Compra y vende de segunda mano',
        heroRotatingOptions: [],
        heroRotationMs: 3000,
        blocks: HOMEPAGE_SEED_BLOCKS,
      },
    });
    console.log('  ✓ homepage config (fila única creada)');
    return;
  }

  // BACKFILL del camino de actualización, y hace falta en CADA ráfaga que pase
  // algo de la portada a bloque: la página deja de pintarlo a mano, así que una
  // instalación anterior se quedaría sin ese trozo. Pasó en RP.2 (el buscador) y
  // vuelve a pasar en RP.4 ("Cómo funciona" y las señales de confianza).
  //
  // LA CONDICIÓN ES `updatedById === null`, no "el array está vacío" como en
  // RP.2. Es una señal EXACTA de "esta portada no la ha tocado nunca un admin":
  // el seed la deja a null y HomepageService.update SIEMPRE escribe el id de
  // quien guarda. La heurística del array vacío ya no valdría —tras RP.2 la
  // fila tiene un bloque— y además nunca supo distinguir "recién sembrada" de
  // "un admin la vació a propósito".
  //
  // En cuanto alguien ha guardado UNA vez desde el backoffice, esto no vuelve a
  // tocar nada, aunque falten bloques de la semilla: eso ya es una decisión
  // suya. Mismo espíritu que el `skipDuplicates` de seedSettings.
  if (existing.updatedById === null) {
    await prisma.homepageConfig.update({
      where: { id: 'singleton' },
      data: { blocks: HOMEPAGE_SEED_BLOCKS },
    });
    console.log('  ✓ homepage config (bloques de la semilla al día; nunca editada por un admin)');
    return;
  }

  console.log('  ✓ homepage config editada por un admin, intacta');
}

/**
 * COOKIES RÁFAGA 3 — LA PÁGINA DE COOKIES, EN BORRADOR Y ESPERANDO SU TEXTO.
 *
 * Ver `seed-pagina-cookies.ts` para el contenido y el porqué de sembrarla.
 *
 * ─── SÓLO SE CREA SI NO EXISTE, Y NUNCA SE PISA ─────────────────────────────────
 *
 * Es el mismo criterio que `seedSettings` («un valor que un administrador ya haya
 * cambiado NUNCA se pisa») y que `seedHomepageConfig`. Aquí pesa más que en ningún otro
 * sitio: lo que puede haber encima es el texto que escribió la asesoría legal, y
 * machacarlo en un despliegue sería destruir trabajo que nadie más tiene.
 *
 * Por eso ni siquiera se comprueba si está publicada o en borrador: si la fila existe,
 * este código no la toca.
 */
async function seedPaginaCookies(prisma: ClienteSemilla) {
  console.log('Seeding cookie policy page...');

  const existente = await prisma.post.findUnique({
    where: { slug: PAGINA_COOKIES_SLUG },
    select: { id: true, status: true },
  });
  if (existente) {
    console.log(`  ✓ página de cookies ya presente (${existente.status}), intacta`);
    return;
  }

  // El autor es un administrador de la instancia: `Post.authorId` es obligatorio, y esta
  // página es configuración de la instancia, no contenido editorial de nadie.
  //
  // SE BUSCA POR ROL, no por un correo fijo. Antes era `admin@marketplace.es`, el correo
  // que esta misma semilla clavaba en el código; ahora el correo del administrador lo
  // decide el entorno (ver `seedAdmin`), así que preguntar por uno concreto no
  // encontraría nada. `orderBy: createdAt` para que la elección sea estable entre
  // ejecuciones y no dependa del orden que devuelva Postgres.
  const admin = await prisma.user.findFirst({
    where: { role: Role.ADMIN },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!admin) {
    console.log('  ⚠ no hay ningún administrador: la página de cookies se creará en el próximo seed');
    return;
  }

  await prisma.post.create({
    data: {
      type: 'PAGE',
      title: PAGINA_COOKIES_TITULO,
      slug: PAGINA_COOKIES_SLUG,
      excerpt: 'Qué cookies usamos, para qué, y cómo cambiar tu decisión.',
      blocks: PAGINA_COOKIES_BLOQUES,
      // DRAFT, Y ES EL MECANISMO ENTERO: el público no la ve, no entra en el sitemap, y
      // el banner sigue con su detalle inline en vez de enlazar a un 404. Publicar es el
      // acto que dice «el texto legal ya está».
      status: 'DRAFT',
      publishedAt: null,
      authorId: admin.id,
    },
  });

  console.log(`  ✓ página de cookies creada en BORRADOR (${PAGINA_COOKIES_RUTA})`);
  console.log('    Le faltan el texto de asesoría y 4 datos que hay que medir en navegador.');
  console.log('    Está marcado dentro de la propia página.');
}

/**
 * LOS MOTIVOS DE CONTACTO — sin ellos el formulario público se apaga solo.
 *
 * Ver `seed-datos-iniciales.ts` y docs/auditoria-seed.md §3.1. Los creaba
 * `contact-reason-backfill`, que ya NO puede correr en una base nueva: lee una columna
 * que su propia migración de retirada borró.
 *
 * GUARDA POR RECUENTO y no `upsert`: `ContactReason.nombre` no es único (dos motivos
 * pueden llamarse igual si al admin le conviene), así que no hay clave natural sobre la
 * que hacer `upsert`. Mismo idioma que `seedCreditPacks`: si ya hay alguno, esto no es
 * asunto de la semilla — el admin ya los gestiona desde el backoffice, y crear «los seis
 * de fábrica» junto a los suyos sería justo lo que nadie quiere.
 */
async function seedMotivosContacto(prisma: ClienteSemilla) {
  console.log('Seeding contact reasons...');
  const existentes = await prisma.contactReason.count();
  if (existentes > 0) {
    console.log('  ✓ contact reasons already present, skipped');
    return;
  }

  await prisma.contactReason.createMany({ data: MOTIVOS_CONTACTO });
  console.log(`  ✓ ${MOTIVOS_CONTACTO.length} motivo(s) de contacto`);
}

/**
 * EL PIE DE PÁGINA — las columnas configurables.
 *
 * Misma guarda por recuento y mismo motivo (no hay clave natural en `FooterColumn`), y
 * el mismo criterio de fondo: en cuanto alguien ha tocado el pie desde `/admin/footer`,
 * la semilla no vuelve a opinar.
 *
 * ─── O ENTERO O NADA, Y ESTO LO ENSEÑÓ LA BASE DE VERDAD ────────────────────────
 *
 * Los ítems `PAGE` se declaran por slug, así que hay que resolverlos contra páginas que
 * existan (`FooterItem.pageId` es `onDelete: Restrict`: apuntar a una fila inexistente
 * sería un error de clave ajena a mitad de la semilla).
 *
 * La primera versión se saltaba el ítem que no pudiera resolver y seguía. Parecía la
 * opción prudente y era la peor, como se vio al sembrar una base recién migrada SIN
 * credencial de administrador: sin admin no hay quien firme la página de cookies, así
 * que la página no se creaba, el pie nacía con una columna «Legal» **vacía**, y la
 * guarda por recuento de la pasada siguiente —la que ya sí creaba la página— veía un
 * pie existente y no la tocaba. Resultado: el enlace a la política no aparecía nunca,
 * y justo en el caso en el que más importa, que es el despliegue de dos pasos.
 *
 * Así que si falta algún destino, **no se siembra nada** y se aplaza a la siguiente
 * ejecución, igual que hace la propia página de cookies cuando no encuentra autor. Una
 * semilla a medias es peor que una semilla pendiente: la pendiente se arregla sola en
 * la pasada siguiente, la que quedó a medias no se arregla nunca.
 */
async function seedPie(prisma: ClienteSemilla) {
  console.log('Seeding footer columns...');
  const existentes = await prisma.footerColumn.count();
  if (existentes > 0) {
    console.log('  ✓ footer already present, skipped');
    return;
  }

  // Todos los destinos ANTES de escribir nada.
  const paginaPorSlug = new Map<string, string>();
  for (const columna of COLUMNAS_PIE) {
    for (const item of columna.items) {
      if (item.tipo !== 'PAGE' || paginaPorSlug.has(item.slugPagina)) continue;
      const pagina = await prisma.post.findUnique({
        where: { slug: item.slugPagina },
        select: { id: true },
      });
      if (!pagina) {
        console.log(
          `  ⚠ todavía no existe /paginas/${item.slugPagina}: el pie se sembrará en el próximo seed`,
        );
        return;
      }
      paginaPorSlug.set(item.slugPagina, pagina.id);
    }
  }

  for (const [indice, columna] of COLUMNAS_PIE.entries()) {
    const creada = await prisma.footerColumn.create({
      data: { name: columna.name, order: indice },
    });

    for (const [orden, item] of columna.items.entries()) {
      await prisma.footerItem.create({
        data:
          item.tipo === 'PAGE'
            ? {
                columnId: creada.id,
                label: item.label,
                order: orden,
                type: 'PAGE',
                pageId: paginaPorSlug.get(item.slugPagina)!,
              }
            : { columnId: creada.id, label: item.label, order: orden, type: 'INTERNAL', url: item.url },
      });
    }

    console.log(`  ✓ columna «${columna.name}» (${columna.items.length} enlace(s))`);
  }
}

/**
 * LA BARRA DE NAVEGACIÓN.
 *
 * Sin filas no se pinta NADA: `MainNav` devuelve `null` con el árbol vacío («GATE
 * TOTAL», MainNav.tsx:73), así que una instancia nueva arrancaba sin barra. No es un
 * error —es una degradación limpia y deliberada— pero tampoco es el estado en el que
 * debe nacer una plataforma.
 *
 * Misma guarda por recuento: en cuanto hay un `NavItem`, la barra es del admin.
 */
async function seedNav(prisma: ClienteSemilla) {
  console.log('Seeding main nav...');
  const existentes = await prisma.navItem.count();
  if (existentes > 0) {
    console.log('  ✓ nav already present, skipped');
    return;
  }

  await prisma.navItem.createMany({
    data: NAV_INICIAL.map((n) => ({
      label: n.label,
      order: n.order,
      type: 'INTERNAL' as const,
      url: n.url,
      // `visibleOn: []` = en todas las páginas. Es el defecto del modelo; va explícito
      // para que se lea aquí y no haya que ir al schema a saberlo.
      visibleOn: [],
    })),
  });
  console.log(`  ✓ ${NAV_INICIAL.length} entrada(s) de navegación`);
}

/**
 * EL ORDEN IMPORTA EN DOS SITIOS, y sólo en dos:
 *
 *  · `seedPaginaCookies` va después de `seedAdmin` porque `Post.authorId` es
 *    obligatorio y esa página la firma el administrador de la instancia.
 *  · `seedPie` va después de `seedPaginaCookies` porque una de sus columnas enlaza esa
 *    página por su `slug`, y hay que poder encontrarla.
 *
 * El resto es independiente entre sí.
 */
export async function sembrar(prisma: ClienteSemilla, env: NodeJS.ProcessEnv = process.env) {
  await seedCategories(prisma);
  await seedAdmin(prisma, env);
  await seedSettings(prisma);
  await seedHomepageConfig(prisma);
  await seedPaginaCookies(prisma);
  await seedMotivosContacto(prisma);
  await seedPie(prisma);
  await seedNav(prisma);
  await seedBillingCatalog(prisma);
  await seedCreditPacks(prisma);
  await seedBumpPacks(prisma);
  console.log('Seed completed.');
}

async function main() {
  // El cliente se construye AQUÍ y no en el módulo: así importar este fichero no abre
  // nada ni exige un `DATABASE_URL`, que es lo que permite que la barrera lo ejecute
  // contra un doble en memoria. Ver la nota de `ClienteSemilla`.
  const prisma = new PrismaClient();
  try {
    await sembrar(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

// `require.main === module`: la semilla se ejecuta cuando alguien la EJECUTA
// (`prisma db seed` → `ts-node prisma/seed.ts`), no cuando alguien la importa.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
