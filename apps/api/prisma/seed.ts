import { PrismaClient, Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

interface AttributeField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  unit?: string;
  options?: string[];
  filterable: boolean;
  required: boolean;
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
    attributeSchema: [],
    children: [
      {
        name: 'Coches',
        slug: 'coches',
        order: 1,
        attributeSchema: [
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: true },
          { name: 'model', label: 'Modelo', type: 'text', filterable: false, required: true },
          { name: 'year', label: 'Año', type: 'number', filterable: true, required: true },
          { name: 'km', label: 'Kilómetros', type: 'number', unit: 'km', filterable: true, required: true },
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
        attributeSchema: [
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: true },
          { name: 'year', label: 'Año', type: 'number', filterable: true, required: true },
          { name: 'km', label: 'Kilómetros', type: 'number', unit: 'km', filterable: true, required: true },
          { name: 'displacement', label: 'Cilindrada', type: 'number', unit: 'cc', filterable: true, required: false },
        ],
      },
      {
        name: 'Furgonetas y camiones',
        slug: 'furgonetas',
        order: 3,
        attributeSchema: [
          { name: 'year', label: 'Año', type: 'number', filterable: true, required: true },
          { name: 'km', label: 'Kilómetros', type: 'number', unit: 'km', filterable: true, required: true },
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
        attributeSchema: [
          { name: 'sqm', label: 'Superficie', type: 'number', unit: 'm²', filterable: true, required: true },
          { name: 'rooms', label: 'Habitaciones', type: 'number', filterable: true, required: true },
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
        attributeSchema: [
          { name: 'sqm', label: 'Superficie', type: 'number', unit: 'm²', filterable: true, required: true },
          { name: 'rooms', label: 'Habitaciones', type: 'number', filterable: true, required: true },
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
        attributeSchema: [
          {
            name: 'brand',
            label: 'Marca',
            type: 'select',
            options: ['Apple', 'Samsung', 'Xiaomi', 'Huawei', 'Google', 'OnePlus', 'Otro'],
            filterable: true,
            required: true,
          },
          { name: 'model', label: 'Modelo', type: 'text', filterable: false, required: false },
          {
            name: 'storage',
            label: 'Almacenamiento',
            type: 'select',
            options: ['16 GB', '32 GB', '64 GB', '128 GB', '256 GB', '512 GB', '1 TB'],
            filterable: true,
            required: false,
          },
          { name: 'color', label: 'Color', type: 'text', filterable: false, required: false },
        ],
      },
      {
        name: 'Ordenadores',
        slug: 'ordenadores',
        order: 2,
        attributeSchema: [
          {
            name: 'type',
            label: 'Tipo',
            type: 'select',
            options: ['Portátil', 'Sobremesa', 'Todo en uno', 'Mini PC'],
            filterable: true,
            required: true,
          },
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false },
          {
            name: 'ram',
            label: 'RAM',
            type: 'select',
            options: ['4 GB', '8 GB', '16 GB', '32 GB', '64 GB'],
            filterable: true,
            required: false,
          },
          { name: 'storage', label: 'Almacenamiento', type: 'text', filterable: false, required: false },
        ],
      },
      {
        name: 'Electrodomésticos',
        slug: 'electrodomesticos',
        order: 3,
        attributeSchema: [
          { name: 'type', label: 'Tipo', type: 'text', filterable: true, required: true },
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
        attributeSchema: [
          {
            name: 'gender',
            label: 'Género',
            type: 'select',
            options: ['Hombre', 'Mujer', 'Unisex', 'Niño', 'Niña'],
            filterable: true,
            required: false,
          },
          {
            name: 'size',
            label: 'Talla',
            type: 'select',
            options: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Otra'],
            filterable: true,
            required: false,
          },
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false },
          { name: 'color', label: 'Color', type: 'text', filterable: false, required: false },
        ],
      },
      {
        name: 'Calzado',
        slug: 'calzado',
        order: 2,
        attributeSchema: [
          {
            name: 'gender',
            label: 'Género',
            type: 'select',
            options: ['Hombre', 'Mujer', 'Unisex', 'Niño', 'Niña'],
            filterable: true,
            required: false,
          },
          { name: 'size', label: 'Talla', type: 'number', filterable: true, required: false },
          { name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false },
          { name: 'color', label: 'Color', type: 'text', filterable: false, required: false },
        ],
      },
      {
        name: 'Accesorios',
        slug: 'accesorios',
        order: 3,
        attributeSchema: [
          { name: 'type', label: 'Tipo', type: 'text', filterable: true, required: false },
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
          { name: 'type', label: 'Tipo', type: 'text', filterable: true, required: false },
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

async function seedCategories() {
  console.log('Seeding categories...');
  for (const cat of CATEGORIES) {
    const parent = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name, order: cat.order, attributeSchema: cat.attributeSchema as unknown as Prisma.InputJsonValue },
      create: { name: cat.name, slug: cat.slug, order: cat.order, attributeSchema: cat.attributeSchema as unknown as Prisma.InputJsonValue },
    });

    if (cat.children) {
      for (const child of cat.children) {
        await prisma.category.upsert({
          where: { slug: child.slug },
          update: {
            name: child.name,
            order: child.order,
            attributeSchema: child.attributeSchema as unknown as Prisma.InputJsonValue,
            parentId: parent.id,
          },
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

async function seedAdmin() {
  console.log('Seeding admin user...');
  const passwordHash = await bcrypt.hash('Admin1234!', BCRYPT_ROUNDS);
  await prisma.user.upsert({
    where: { email: 'admin@marketplace.es' },
    update: { role: Role.ADMIN, emailVerified: true },
    create: {
      email: 'admin@marketplace.es',
      name: 'Admin',
      slug: 'admin',
      passwordHash,
      role: Role.ADMIN,
      emailVerified: true,
    },
  });
  console.log('  ✓ admin@marketplace.es (role: ADMIN)');
}

async function main() {
  await seedCategories();
  await seedAdmin();
  console.log('Seed completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
