import { Logger } from '@nestjs/common';
import { FilterableAttributesResolver } from './filterable-attributes.resolver';
import { PrismaService } from '../../infra/prisma/prisma.service';

function makeResolver(categories: Array<{ attributeSchema: unknown }>) {
  const prisma = {
    category: { findMany: jest.fn().mockResolvedValue(categories) },
  } as unknown as PrismaService;
  return { resolver: new FilterableAttributesResolver(prisma), prisma };
}

describe('FilterableAttributesResolver', () => {
  it('incluye los atributos filterable:true de todas las categorías (padres y hojas)', async () => {
    const { resolver } = makeResolver([
      { attributeSchema: [{ name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false }] },
      { attributeSchema: [{ name: 'year', label: 'Año', type: 'number', filterable: true, required: true }] },
    ]);

    const types = await resolver.getAttributeTypes();

    expect(types.get('brand')).toBe('text');
    expect(types.get('year')).toBe('number');
  });

  it('excluye atributos con filterable:false', async () => {
    const { resolver } = makeResolver([
      { attributeSchema: [{ name: 'model', label: 'Modelo', type: 'text', filterable: false, required: true }] },
    ]);

    const types = await resolver.getAttributeTypes();

    expect(types.has('model')).toBe(false);
  });

  it('excluye estructuralmente nombres reservados aunque una categoría los marque filterable:true', async () => {
    const { resolver } = makeResolver([
      { attributeSchema: [{ name: 'type', label: 'Tipo', type: 'text', filterable: true, required: false }] },
      { attributeSchema: [{ name: 'price', label: 'Precio', type: 'number', filterable: true, required: false }] },
    ]);

    const types = await resolver.getAttributeTypes();

    expect(types.has('type')).toBe(false);
    expect(types.has('price')).toBe(false);
  });

  it('ante conflicto de type entre categorías para el mismo name, conserva el primero y avisa (no rompe)', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { resolver } = makeResolver([
      { attributeSchema: [{ name: 'size', label: 'Talla', type: 'select', filterable: true, required: false }] },
      { attributeSchema: [{ name: 'size', label: 'Talla', type: 'number', filterable: true, required: false }] },
    ]);

    const types = await resolver.getAttributeTypes();

    expect(types.get('size')).toBe('select');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('tolera attributeSchema vacío o ausente', async () => {
    const { resolver } = makeResolver([
      { attributeSchema: [] },
      { attributeSchema: null },
    ]);

    const types = await resolver.getAttributeTypes();

    expect(types.size).toBe(0);
  });

  it('memoiza: una segunda llamada no vuelve a consultar Prisma', async () => {
    const { resolver, prisma } = makeResolver([]);

    await resolver.getAttributeTypes();
    await resolver.getAttributeTypes();

    expect(prisma.category.findMany).toHaveBeenCalledTimes(1);
  });
});
