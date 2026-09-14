import { fireEvent, render, screen, within } from '@testing-library/react';
import { DialogoFiltrable, type OpcionFiltrable } from './dialogo-filtrable';

/**
 * ══ BUSCADOR · BQ-B — LAS BARRERAS DEL MOLDE ═════════════════════════════════════════
 *
 * Lo que se prueba aquí es el COMPORTAMIENTO del molde, no su aspecto: que filtra, que
 * ordena, que se maneja con el teclado y —sobre todo— **que no existe ningún camino desde
 * el texto tecleado hasta el valor que se emite**. Eso último es una decisión de producto
 * (el backend filtra la provincia con un `=` exacto) y aquí se convierte en un rojo de CI.
 *
 * El aspecto lo miran las capturas; la estructura común entre modelos, la invariancia.
 *
 * ── LAS OPCIONES DE PRUEBA NO SON PROVINCIAS NI CATEGORÍAS, A PROPÓSITO ─────────────
 *
 * El molde no sabe de dominio y estas pruebas tampoco deben saberlo: si usaran `PROVINCIAS`
 * pasarían a medir el adaptador de paso, y el día que alguien colara dominio dentro del
 * molde no habría nada en rojo.
 *
 * ── SE USA `fireEvent` Y NO `user-event` ────────────────────────────────────────────
 *
 * Porque `@testing-library/user-event` no está en el repo y esto no justifica una
 * dependencia nueva. Las filas se eligen con `pointerDown` y no con `click`: el molde
 * escucha ahí a propósito —para que el puntero no saque el foco del campo antes de que el
 * clic llegue—, así que un test que hiciera `click` estaría probando otra cosa.
 */
const OPCIONES: OpcionFiltrable[] = [
  { valor: 'a', etiqueta: 'Alfa', buscable: 'Alfa' },
  { valor: 'b', etiqueta: 'Beta', contexto: 'Alfa ›', nota: 'y 2 hijas', buscable: 'Beta' },
  { valor: 'ab', etiqueta: 'Alfabeto', buscable: 'Alfabeto' },
  // Con barra y acentos: es la forma de las grafías cooficiales (`Alicante/Alacant`).
  { valor: 'g', etiqueta: 'Gamma/Gámmá', buscable: 'Gamma/Gámmá' },
];

const BASE = {
  opciones: OPCIONES,
  valor: '',
  etiquetaVacio: 'Sin elegir',
  opcionLimpiar: 'Todas',
  titulo: 'Elige una cosa',
  marcadorFiltro: 'Filtrar…',
  etiquetaDisparador: 'Cosa',
};

function montar(props: Partial<React.ComponentProps<typeof DialogoFiltrable>> = {}) {
  const onElegir = jest.fn();
  render(<DialogoFiltrable {...BASE} onElegir={onElegir} {...props} />);
  return { onElegir };
}

/** Abre la capa y la devuelve. Todo lo que se mide vive dentro, no en la página. */
async function abrir(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: /Cosa/ }));
  // `findBy` y no `getBy`: la capa llega por `next/dynamic`, así que el primer clic dispara
  // una descarga y el diálogo aparece un tick más tarde. Esperarlo es lo que prueba, de
  // paso, que la carga diferida funciona.
  return screen.findByRole('dialog');
}

const campoDe = (dialogo: HTMLElement) => within(dialogo).getByRole('combobox');

function teclear(dialogo: HTMLElement, texto: string) {
  fireEvent.change(campoDe(dialogo), { target: { value: texto } });
}

/**
 * Las ETIQUETAS de las filas visibles, en orden. La primera es siempre la de limpiar.
 *
 * Se lee el primer `<span>` y no el `textContent` de la fila entera porque una fila puede
 * llevar además nota y contexto, y concatenados dan cadenas como «Betay 2 hijasAlfa ›»
 * que no se parecen a nada que un usuario lea. Lo que esas dos ranuras pintan lo comprueba
 * su propia prueba, más abajo.
 */
function filas(dialogo: HTMLElement): string[] {
  return within(dialogo)
    .getAllByRole('option')
    .map((li) => li.querySelector('span')?.textContent ?? '');
}

const activa = (dialogo: HTMLElement) => within(dialogo).getByRole('option', { selected: true });

describe('DialogoFiltrable — el disparador', () => {
  it('sin selección muestra el texto de reposo', async () => {
    montar();
    expect(screen.getByRole('button', { name: 'Cosa' })).toHaveTextContent('Sin elegir');
  });

  /**
   * Un `aria-label` PISA el contenido del botón: sin el valor dentro del nombre accesible,
   * un lector de pantalla diría «Cosa» y nunca «Beta» — que es justo lo que el `<select>`
   * al que sustituye sí decía.
   */
  it('con selección, el valor entra en el nombre accesible y no sólo en el texto', async () => {
    montar({ valor: 'b' });
    expect(screen.getByRole('button', { name: 'Cosa: Beta' })).toHaveTextContent('Beta');
  });

  /**
   * El asidero que BQ-A prometió conservar: `getByLabel('Categoría')` —aquí «Cosa»— sigue
   * encontrando el control después de cambiar el `<select>` por un diálogo.
   */
  it('conserva el aria-label del <select> que sustituye', async () => {
    montar();
    expect(screen.getByLabelText('Cosa')).toBeInTheDocument();
  });

  /** Vive dentro de un `<form>`: si fuera `submit`, abrirlo enviaría la búsqueda. */
  it('es type="button", no submit', async () => {
    montar();
    expect(screen.getByRole('button', { name: 'Cosa' })).toHaveAttribute('type', 'button');
  });

  it('no monta el contenido del diálogo hasta que se abre (el LCP no lo paga)', async () => {
    montar();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('DialogoFiltrable — el filtro', () => {
  it('se abre mostrando la lista ENTERA, sin mínimo de caracteres', async () => {
    montar();
    expect(filas(await abrir())).toHaveLength(OPCIONES.length + 1); // + la fila de limpiar
  });

  it('el foco va al campo de filtro, no al primer botón de la capa', async () => {
    montar();
    const dialogo = await abrir();
    expect(campoDe(dialogo)).toHaveFocus();
  });

  it('recorta la lista según se escribe', async () => {
    montar();
    const dialogo = await abrir();
    // «Alfabeto» NO casa: lleva «beto», no «beta». Es contención literal, no difusa.
    teclear(dialogo, 'beta');
    expect(filas(dialogo)).toEqual(['Todas', 'Beta']);
  });

  /**
   * Las dos ranuras que el `<select>` no podía tener: un `<option>` es sólo texto, así que
   * la ruta y la cuenta de subcategorías había que concatenarlas o perderlas. Aquí van en
   * sus propios nodos, atenuadas — y es lo que sustituye al literal «Todo en Vehículos»
   * (decisión 6 del diseño).
   */
  it('pinta el contexto y la nota de una fila, sin meterlos en la etiqueta', async () => {
    montar();
    const dialogo = await abrir();
    const beta = within(dialogo).getByRole('option', { name: /Beta/ });
    expect(beta.querySelector('span')).toHaveTextContent('Beta');
    expect(beta).toHaveTextContent('y 2 hijas');
    expect(beta).toHaveTextContent('Alfa ›');
  });

  /**
   * El orden no es alfabético: lo que EMPIEZA por lo tecleado va antes que lo que sólo lo
   * contiene, y a igualdad gana lo más corto. «alfa» tiene que dar Alfa antes que
   * Alfabeto, o el filtro se sentiría aleatorio.
   */
  it('ordena startsWith primero y desempata por longitud', async () => {
    montar();
    const dialogo = await abrir();
    teclear(dialogo, 'alfa');
    expect(filas(dialogo)).toEqual(['Todas', 'Alfa', 'Alfabeto']);
  });

  /** Es lo que hace que «alac» encuentre `Alicante/Alacant` y «valen», `Valencia/València`. */
  it('ignora acentos: la normalización NFD llega al molde', async () => {
    montar();
    const dialogo = await abrir();
    teclear(dialogo, 'gamma/gamma');
    expect(filas(dialogo)).toEqual(['Todas', 'Gamma/Gámmá']);
  });

  it('sin coincidencias avisa, y deja la fila de limpiar en pie', async () => {
    montar();
    const dialogo = await abrir();
    teclear(dialogo, 'zzzz');
    expect(within(dialogo).getByText('Nada coincide.')).toBeInTheDocument();
    expect(filas(dialogo)).toEqual(['Todas']);
  });

  /**
   * La fila de limpiar es una ACCIÓN, no un resultado: esconderla al teclear obligaría a
   * borrar el texto para poder limpiar (decisión B del §13 del diseño).
   */
  it('la fila de limpiar no se filtra nunca', async () => {
    montar();
    const dialogo = await abrir();
    teclear(dialogo, 'beta');
    expect(filas(dialogo)[0]).toBe('Todas');
  });

  /** La red de la decisión 4: si el nombre no casa con nada, se reintenta sobre la ruta. */
  it('cae al buscable amplio SÓLO cuando el buscable no casa con nada', async () => {
    render(
      <DialogoFiltrable
        {...BASE}
        opciones={[
          {
            valor: 'c',
            etiqueta: 'Coches',
            buscable: 'Coches',
            buscableAmplio: 'Vehículos › Coches',
          },
        ]}
        onElegir={jest.fn()}
      />,
    );
    const dialogo = await abrir();

    // «vehiculos» no está en el nombre; sin la red, esto sería «Nada coincide».
    teclear(dialogo, 'vehiculos');
    expect(filas(dialogo)).toEqual(['Todas', 'Coches']);

    // Y la red NO se cuela cuando el nombre sí casa.
    teclear(dialogo, 'coch');
    expect(filas(dialogo)).toEqual(['Todas', 'Coches']);
  });
});

describe('DialogoFiltrable — elegir', () => {
  /**
   * ⚠ LA BARRERA QUE MÁS IMPORTA. El backend filtra la provincia con un `=` EXACTO, así
   * que emitir texto tecleado daría cero resultados en silencio. Aquí se afirma que no hay
   * camino: se teclea mucho y `onElegir` no se llama ni una vez.
   */
  it('teclear NO emite valor: el campo filtra, no es el campo del valor', async () => {
    const { onElegir } = montar();
    const dialogo = await abrir();
    teclear(dialogo, 'G');
    teclear(dialogo, 'Ga');
    teclear(dialogo, 'Gamma');
    expect(onElegir).not.toHaveBeenCalled();
  });

  it('elegir una fila emite su VALOR, no lo que se escribió', async () => {
    const { onElegir } = montar();
    const dialogo = await abrir();
    teclear(dialogo, 'gam');
    fireEvent.pointerDown(within(dialogo).getByRole('option', { name: /Gamma/ }));
    expect(onElegir).toHaveBeenCalledWith('g');
    expect(onElegir).toHaveBeenCalledTimes(1);
  });

  it('la fila de limpiar emite la cadena vacía', async () => {
    const { onElegir } = montar({ valor: 'b' });
    const dialogo = await abrir();
    fireEvent.pointerDown(within(dialogo).getByRole('option', { name: 'Todas' }));
    expect(onElegir).toHaveBeenCalledWith('');
  });

  it('elegir cierra la capa', async () => {
    montar();
    const dialogo = await abrir();
    fireEvent.pointerDown(within(dialogo).getByRole('option', { name: 'Alfa' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('DialogoFiltrable — el teclado', () => {
  /**
   * Decisión 5: al abrir sin texto se resalta la opción YA ELEGIDA, para que `Enter` nada
   * más abrir no haga algo sorprendente.
   */
  it('al abrir resalta la opción elegida', async () => {
    montar({ valor: 'ab' });
    expect(activa(await abrir())).toHaveTextContent('Alfabeto');
  });

  it('sin selección resalta la primera fila', async () => {
    montar();
    expect(activa(await abrir())).toHaveTextContent('Todas');
  });

  it('con texto resalta la primera COINCIDENCIA, no la fila de limpiar', async () => {
    montar();
    const dialogo = await abrir();
    teclear(dialogo, 'beta');
    expect(activa(dialogo)).toHaveTextContent('Beta');
  });

  it('las flechas mueven el resaltado y Enter elige', async () => {
    const { onElegir } = montar();
    const dialogo = await abrir();
    const campo = campoDe(dialogo);
    fireEvent.keyDown(campo, { key: 'ArrowDown' });
    fireEvent.keyDown(campo, { key: 'ArrowDown' });
    fireEvent.keyDown(campo, { key: 'Enter' });
    // Limpiar → Alfa → Beta.
    expect(onElegir).toHaveBeenCalledWith('b');
  });

  /** Se detienen en los extremos: ciclar en una lista larga se lee como un salto. */
  it('la flecha arriba se detiene en la primera fila, no cicla', async () => {
    const { onElegir } = montar();
    const dialogo = await abrir();
    const campo = campoDe(dialogo);
    fireEvent.keyDown(campo, { key: 'ArrowUp' });
    fireEvent.keyDown(campo, { key: 'ArrowUp' });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect(onElegir).toHaveBeenCalledWith('');
  });

  it('el campo declara la fila activa con aria-activedescendant', async () => {
    montar();
    const dialogo = await abrir();
    const campo = campoDe(dialogo);
    fireEvent.keyDown(campo, { key: 'ArrowDown' });
    expect(activa(dialogo)).toHaveTextContent('Alfa');
    expect(campo).toHaveAttribute('aria-activedescendant', activa(dialogo).id);
  });
});
