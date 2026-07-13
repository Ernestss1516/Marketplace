import { parseSearchQuery } from './search-query.parser';

const noAttributes = async () => new Map();

describe('parseSearchQuery — condition no aplica a SERVICE (auditoría de filtros, Bug B)', () => {
  it('type=SERVICE + condition → error incluido en el 400 combinado', async () => {
    await expect(
      parseSearchQuery({ type: 'SERVICE', condition: 'NEW' }, noAttributes),
    ).rejects.toMatchObject({
      response: { message: expect.arrayContaining([expect.stringContaining('condition no aplica')]) },
    });
  });

  it('type=PRODUCT + condition → no lanza', async () => {
    const result = await parseSearchQuery({ type: 'PRODUCT', condition: 'NEW' }, noAttributes);
    expect(result.dto.type).toBe('PRODUCT');
    expect(result.dto.condition).toBe('NEW');
  });

  it('condition sin type → no lanza (el guard solo actúa junto a type=SERVICE)', async () => {
    const result = await parseSearchQuery({ condition: 'NEW' }, noAttributes);
    expect(result.dto.condition).toBe('NEW');
  });

  it('type=SERVICE sin condition → no lanza', async () => {
    const result = await parseSearchQuery({ type: 'SERVICE' }, noAttributes);
    expect(result.dto.type).toBe('SERVICE');
  });
});
