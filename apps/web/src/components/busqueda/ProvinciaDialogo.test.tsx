import { fireEvent, render, screen, within } from '@testing-library/react';
import { ProvinciaDialogo } from './ProvinciaDialogo';
import { PROVINCIAS } from '@/lib/provincias';

/**
 * ══ BUSCADOR · BQ-B — EL DIÁLOGO DE UBICACIÓN ════════════════════════════════════════
 *
 * ⚠ LO QUE ESTE FICHERO EXISTE PARA VIGILAR ES **EL FORMATO EXACTO DE LA PROVINCIA**.
 *
 * `SearchService` filtra con un `=` exacto (`province = "…"`) contra el string que quedó
 * guardado en `Listing.province`, que es el mismo de `lib/provincias.ts`. Una errata o una
 * variación de mayúsculas o tildes da **cero resultados en silencio** — ni error, ni aviso,
 * ni pista: una página de búsqueda vacía. Es el defecto que `FilterPanel` ya cerró
 * cambiando su campo de texto libre por un `<select>`, y que el diálogo no puede reabrir.
 *
 * La garantía no es de disciplina sino de forma: el molde llama a `onElegir` **sólo desde
 * el manejador de una fila**. Aquí se comprueba el resultado de esa forma con las grafías
 * cooficiales, que son donde más fácil sería equivocarse.
 */

const campoDe = (dialogo: HTMLElement) => within(dialogo).getByRole('combobox');

const etiquetas = (dialogo: HTMLElement) =>
  within(dialogo)
    .getAllByRole('option')
    .map((li) => li.querySelector('span')?.textContent ?? '');

async function montar(valor = '') {
  const onElegir = jest.fn();
  render(<ProvinciaDialogo valor={valor} onElegir={onElegir} />);
  fireEvent.click(screen.getByRole('button', { name: /Provincia/ }));
  // La capa llega por `next/dynamic`: aparece un tick después del clic.
  return { onElegir, dialogo: await screen.findByRole('dialog') };
}

describe('ProvinciaDialogo — la lista', () => {
  it('ofrece las 52 provincias más la fila de «Toda España»', async () => {
    const { dialogo } = await montar();
    expect(PROVINCIAS).toHaveLength(52);
    expect(etiquetas(dialogo)).toHaveLength(PROVINCIAS.length + 1);
    expect(etiquetas(dialogo)[0]).toBe('Toda España');
  });

  it('el disparador dice «Toda España» mientras no hay provincia', async () => {
    render(<ProvinciaDialogo valor="" onElegir={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Provincia' })).toHaveTextContent('Toda España');
  });

  it('con provincia elegida, el disparador y el nombre accesible la dicen', async () => {
    render(<ProvinciaDialogo valor="Alicante/Alacant" onElegir={jest.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Provincia: Alicante/Alacant' }),
    ).toHaveTextContent('Alicante/Alacant');
  });
});

describe('ProvinciaDialogo — las grafías cooficiales', () => {
  /** Las cinco entradas con grafía doble, por las dos mitades y sin acentos. */
  it.each([
    ['ali', 'Alicante/Alacant'],
    ['alac', 'Alicante/Alacant'],
    ['alava', 'Araba/Álava'],
    ['castello', 'Castellón/Castelló'],
    ['valen', 'Valencia/València'],
    ['valencia', 'Valencia/València'],
  ])('«%s» encuentra «%s»', async (tecleado, esperada) => {
    const { dialogo } = await montar();
    fireEvent.change(campoDe(dialogo), { target: { value: tecleado } });
    expect(etiquetas(dialogo)).toContain(esperada);
  });

  /**
   * El desempate por longitud, con un caso real: «ala» casa con `Araba/Álava` y con
   * `Alicante/Alacant` sólo por contención, y gana el más corto.
   */
  it('«ala» pone Araba/Álava antes que Alicante/Alacant', async () => {
    const { dialogo } = await montar();
    fireEvent.change(campoDe(dialogo), { target: { value: 'ala' } });
    const lista = etiquetas(dialogo).slice(1); // sin la fila de limpiar
    expect(lista.indexOf('Araba/Álava')).toBeLessThan(lista.indexOf('Alicante/Alacant'));
  });
});

describe('ProvinciaDialogo — el valor que se envía', () => {
  /**
   * ⚠ LA BARRERA. Se teclea «alac» —que no es ninguna provincia— y lo que sale es la
   * entrada EXACTA de `PROVINCIAS`, con su barra y su mayúscula. Si algún día alguien
   * conectara el texto a la salida, esto se pondría rojo aquí y no en una búsqueda vacía
   * en producción.
   */
  it('emite la entrada EXACTA de PROVINCIAS, no lo que se tecleó', async () => {
    const { dialogo, onElegir } = await montar();
    fireEvent.change(campoDe(dialogo), { target: { value: 'alac' } });
    fireEvent.pointerDown(within(dialogo).getByRole('option', { name: /Alicante/ }));

    expect(onElegir).toHaveBeenCalledWith('Alicante/Alacant');
    expect(onElegir).not.toHaveBeenCalledWith('alac');
    // Y lo emitido es, literalmente, una de las 52: no una cadena parecida.
    expect(PROVINCIAS as readonly string[]).toContain(onElegir.mock.calls[0][0]);
  });

  it('teclear no emite nada: el campo filtra, no es el campo del valor', async () => {
    const { dialogo, onElegir } = await montar();
    fireEvent.change(campoDe(dialogo), { target: { value: 'madr' } });
    fireEvent.change(campoDe(dialogo), { target: { value: 'madrid' } });
    expect(onElegir).not.toHaveBeenCalled();
  });

  it('«Toda España» borra la provincia con la cadena vacía', async () => {
    const { dialogo, onElegir } = await montar('Madrid');
    fireEvent.pointerDown(within(dialogo).getByRole('option', { name: 'Toda España' }));
    expect(onElegir).toHaveBeenCalledWith('');
  });
});
