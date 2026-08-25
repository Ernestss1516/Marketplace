/**
 * LOS AJUSTES DEL ÍNDICE SE ESPERAN, NO SÓLO SE ENCOLAN.
 *
 * POR QUÉ ESTO ES UN TEST UNITARIO Y NO UN e2e. `updateSettings` no aplica nada: ENCOLA una
 * tarea y devuelve su `taskUid`, así que el `await` de la llamada sólo espera a que
 * Meilisearch acepte el encargo. Entre eso y que lo cumpla hay una ventana en la que el
 * índice todavía no conoce los `filterableAttributes` nuevos, y una búsqueda que filtre por
 * uno de ellos responde «attribute X is not filterable» → 500.
 *
 * Eso YA PASÓ: puso `main` en rojo con `search-dynamic-attributes`, y se cerró añadiendo
 * `waitForTask`. Lo que no se puede es PROTEGERLO con un e2e, porque es una CARRERA: en
 * local Meilisearch está ocioso y la gana siempre, así que quitar el `waitForTask` deja los
 * e2e en verde y el runner cargado en rojo. Comprobado al hacer V-4 —que añade `hasVideo` a
 * esos mismos settings—: la mutación «quitar el waitForTask» no mataba ningún e2e.
 *
 * Una carrera no se caza observando el síntoma; se caza afirmando el MECANISMO. Aquí no hay
 * Meilisearch: hay un doble que registra qué se le pidió y en qué orden.
 */
import { SearchService } from './search.service';

/** Lo mínimo de `MeilisearchService` + el índice que `applyFilterableAttributes` toca. */
function servicioConDobles() {
  const llamadas: string[] = [];
  const updateSettings = jest.fn(async (settings: Record<string, unknown>) => {
    llamadas.push('updateSettings');
    return { taskUid: 42, settings };
  });
  const waitForTask = jest.fn(async (uid: number) => {
    llamadas.push(`waitForTask:${uid}`);
    return { status: 'succeeded' };
  });

  const service = Object.create(SearchService.prototype) as {
    applyFilterableAttributes: () => Promise<void>;
    index: unknown;
    meili: unknown;
    attributesResolver: unknown;
    logger: unknown;
    filterableAttributeNames: Set<string>;
  };
  service.index = { updateSettings };
  service.meili = { client: { createIndex: jest.fn(async () => undefined), waitForTask } };
  service.attributesResolver = { getAttributeTypes: jest.fn(async () => new Map()) };
  service.logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
  service.filterableAttributeNames = new Set();

  return { service, updateSettings, waitForTask, llamadas };
}

describe('SearchService — aplicar los ajustes del índice', () => {
  it('ESPERA la tarea de `updateSettings`, y con SU uid', async () => {
    // La barrera del flake. Si alguien quita el `waitForTask`, aquí se pone rojo SIEMPRE —
    // no según lo cargado que esté el runner.
    const { service, waitForTask } = servicioConDobles();

    await service.applyFilterableAttributes();

    expect(waitForTask).toHaveBeenCalledTimes(1);
    expect(waitForTask).toHaveBeenCalledWith(42);
  });

  it('y la espera va DESPUÉS de encolar: no vale esperar otra cosa', async () => {
    const { service, llamadas } = servicioConDobles();

    await service.applyFilterableAttributes();

    expect(llamadas).toEqual(['updateSettings', 'waitForTask:42']);
  });

  it('ROTACIÓN R1 — las marcas del destacado van cada una donde R2 las usa', async () => {
    // `featuredExpiresAt` FILTRABLE (R2 descarta con él los periodos vencidos) y
    // `featuredStartsAt` ORDENABLE (R2 ordena el anillo de rotación por él). Declarar un
    // campo en la constante no sirve de nada si no llega al índice; y cambiarlo de lista
    // dejaría a R2 con un `Invalid facet distribution` o un `not sortable` en producción.
    const { service, updateSettings } = servicioConDobles();

    await service.applyFilterableAttributes();

    const settings = updateSettings.mock.calls[0][0] as {
      filterableAttributes: string[];
      sortableAttributes: string[];
    };
    expect(settings.filterableAttributes).toContain('featuredExpiresAt');
    expect(settings.sortableAttributes).toContain('featuredStartsAt');
  });

  it('ROTACIÓN R1 — `maxTotalHits` se fija, y muy por encima del techo de 1000', async () => {
    // El techo por defecto de Meilisearch (1000) cortaría el anillo de R2: el destacado que
    // cayera más allá de la posición 1000 no saldría nunca. Es el corte que la rotación
    // viene a eliminar, así que se fija en la misma ráfaga que crea los campos.
    const { service, updateSettings } = servicioConDobles();

    await service.applyFilterableAttributes();

    const settings = updateSettings.mock.calls[0][0] as {
      pagination?: { maxTotalHits?: number };
    };
    expect(settings.pagination?.maxTotalHits).toBeGreaterThan(1000);
  });

  it('V-4 — `hasVideo` viaja en los filtrables que se le mandan a Meilisearch', async () => {
    // La otra mitad del hueco: declararlo en la constante no sirve de nada si no llega al
    // índice. El e2e lo comprueba contra Meilisearch de verdad; esto lo fija aquí también,
    // donde no hay red de por medio.
    const { service, updateSettings } = servicioConDobles();

    await service.applyFilterableAttributes();

    const settings = updateSettings.mock.calls[0][0] as { filterableAttributes: string[] };
    expect(settings.filterableAttributes).toContain('hasVideo');
  });
});
