/**
 * PÓSTER ANIMADO P2 — EL HOVER, en la tarjeta.
 *
 * Las barreras del componente (docs/diseno-poster-animado.md §9):
 *   · B-6 — **el fallback es un estado NORMAL**: sin sprite la tarjeta pinta exactamente lo
 *           de siempre y no intenta animar nada. Es el caso mayoritario —todos los vídeos
 *           anteriores a P1 tienen la columna a `null` y no se pueden regenerar—, así que
 *           tiene que estar bien pintado, no tratado como una excepción.
 *   · LA PEREZA — la capa **no existe** hasta que el ratón entra. Si existiera desde el
 *           primer render, una parrilla de 24 tarjetas pediría 24 sprites que nadie ha
 *           mirado, que es justo el peso que este diseño evita.
 *   · `isSafeSrc` — una `url()` de CSS **no pasa por `remotePatterns`**, así que ésta es su
 *           única restricción de dominio. Un origen ajeno no se pinta.
 *   · SIGUE SIN HABER `<video>` — el sprite es una imagen; la garantía de la ráfaga 3 no se
 *           toca, y aquí se vuelve a comprobar con la previsualización montada.
 *   · TÁCTIL — **pasar el dedo por encima no arma nada**. Sigue siendo cierto con la previa
 *           en móvil, y ahora es la barrera que la protege: lo que enciende la previsualización
 *           en táctil es un toque DELIBERADO sobre el botón de vídeo, nunca el roce de un dedo
 *           que pasa haciendo scroll. Ese camino se prueba en `previa-video-tap.test.tsx`.
 *
 * ESTE FICHERO CUBRE EL CAMINO DEL RATÓN. El del toque vive aparte a propósito: son dos
 * disparadores con reglas distintas (uno es exclusivo por naturaleza, el otro hay que
 * coordinarlo; uno no se apaga, el otro alterna), y mezclarlos habría dado un fichero donde
 * no se ve cuál de los dos protege cada garantía.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { CardPhotoCarousel } from './CardPhotoCarousel';
import { PREVIEW_FRAMES } from '@/lib/api/video';

afterEach(cleanup);

const SPRITE = 'http://localhost:9000/marketplace-test/listing-previews/x/s.webp';

const base = {
  images: ['http://localhost:9000/marketplace-test/media/a.jpg'],
  title: 'Un anuncio con vídeo',
  sizes: '100px',
};

/**
 * Entrar sobre la tarjeta con un puntero del tipo que se le diga.
 *
 * EL EVENTO SE CONSTRUYE A MANO, y hay dos motivos encadenados para ello — los dos costaron
 * un rojo, así que quedan escritos:
 *
 *  1. **Se dispara `pointerover`, no `pointerenter`.** `pointerenter` no burbujea, así que
 *     React no le pone escuchador: sintetiza `onPointerEnter` a partir de `pointerover`.
 *     Disparar el evento «correcto» no llamaría al manejador.
 *  2. **`fireEvent.pointerOver` no vale en jsdom**, que no implementa `PointerEvent`
 *     (verificado: `typeof PointerEvent === 'undefined'`). El evento que construye sale sin
 *     `pointerType`, y el manejador —que filtra por ahí— no dispara. De ahí el `MouseEvent`
 *     con el nombre correcto y el `pointerType` puesto encima.
 */
const entrar = (el: HTMLElement, pointerType: 'mouse' | 'touch') => {
  const ev = new MouseEvent('pointerover', { bubbles: true });
  Object.defineProperty(ev, 'pointerType', { value: pointerType });
  fireEvent(el, ev);
};

const entrarConRaton = (el: HTMLElement) => entrar(el, 'mouse');

const contenedor = (container: HTMLElement) =>
  container.firstElementChild as HTMLElement;

describe('B-6 — sin sprite, la tarjeta es la de siempre', () => {
  it('con `videoPreviewUrl` ausente no monta la capa, ni siquiera al pasar el ratón', () => {
    const { container } = render(<CardPhotoCarousel {...base} hasVideo />);

    entrarConRaton(contenedor(container));

    // EL CASO MAYORITARIO, y por eso es la primera barrera: todos los vídeos subidos antes
    // de P1 tienen la columna a `null` y NO se pueden regenerar (haría falta decodificar el
    // vídeo en el servidor, o sea ffmpeg). Se ven como siempre.
    expect(screen.queryByTestId('card-video-preview')).not.toBeInTheDocument();
    // Y lo de siempre sigue estando: la foto y el indicador.
    expect(screen.getByTestId('card-tiene-video')).toBeInTheDocument();
  });

  it('con `videoPreviewUrl` a null tampoco — es lo que sirve la API para un anuncio sin vídeo', () => {
    const { container } = render(
      <CardPhotoCarousel {...base} hasVideo={false} videoPreviewUrl={null} />,
    );

    entrarConRaton(contenedor(container));
    expect(screen.queryByTestId('card-video-preview')).not.toBeInTheDocument();
  });
});

describe('La pereza — la imagen se pide al entrar el ratón, no antes', () => {
  it('en el render inicial la capa NO existe, aunque haya sprite', () => {
    render(<CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />);

    // LA DECISIÓN QUE HACE ESTO BARATO. La URL viaja en el payload de la tarjeta —eso son
    // ~100 bytes—, pero el elemento que la referencia no existe todavía, así que el
    // navegador no pide nada. Una parrilla de 24 tarjetas descarga CERO sprites hasta que
    // alguien pasea el cursor. Mismo trato que las fotos 2ª a Nª de este mismo carrusel.
    expect(screen.queryByTestId('card-video-preview')).not.toBeInTheDocument();
  });

  it('al entrar el ratón se monta, con el sprite como variable CSS', () => {
    const { container } = render(
      <CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />,
    );

    entrarConRaton(contenedor(container));

    const capa = screen.getByTestId('card-video-preview');
    // La geometría (`background-size: 500% 100%`), el `steps(5)`, el `@media (hover: hover)`
    // y el `prefers-reduced-motion` viven en `globals.css`: aquí sólo entra la URL, que es
    // lo único que cambia por anuncio.
    expect(capa.className).toContain('sprite-previa');
    expect(capa.getAttribute('style')).toContain(SPRITE);
  });

  it('y NO lleva `data-tap`: la anima el `:hover` del CSS, no la regla del toque', () => {
    const { container } = render(
      <CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />,
    );

    entrarConRaton(contenedor(container));

    // LOS DOS CAMINOS TIENEN QUE SEGUIR SIENDO DISTINGUIBLES. Si el hover marcara también
    // `data-tap`, la animación de escritorio dejaría de depender de `@media (hover: hover)` y
    // pasaría a estar encendida por una regla que vive fuera de esa consulta — o sea, la
    // decisión de producto (b) se habría desactivado sin que nadie tocara la consulta.
    expect(screen.getByTestId('card-video-preview')).not.toHaveAttribute('data-tap');
  });

  it('y no roba el clic: la tarjeta entera sigue siendo un enlace al anuncio', () => {
    const { container } = render(
      <CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />,
    );
    entrarConRaton(contenedor(container));

    expect(screen.getByTestId('card-video-preview').className).toContain('pointer-events-none');
  });
});

describe('Táctil — un dedo que pasa por encima no arma la previsualización', () => {
  it('un `pointerenter` de tipo `touch` no monta nada', () => {
    const { container } = render(
      <CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />,
    );

    entrar(contenedor(container), 'touch');

    /**
     * ESTA BARRERA NO SE RELAJA CON LA PREVIA EN MÓVIL: SE VUELVE SU CIMIENTO.
     *
     * Un toque en táctil dispara `mouseenter`/`pointerover` por compatibilidad, así que sin
     * este filtro **rozar una tarjeta al hacer scroll** bajaría su sprite. En una parrilla de
     * 24, recorrer la página con el dedo las armaría casi todas — los 888 KB que el
     * diagnóstico midió para la opción A (§2), pagados sin que nadie haya pedido nada.
     *
     * Lo que la ráfaga del tap añade NO pasa por aquí: es un `onClick` sobre el BOTÓN de
     * vídeo, un objetivo acotado y un gesto deliberado. Los dos hechos conviven: el roce no
     * arma, el toque sí.
     */
    expect(screen.queryByTestId('card-video-preview')).not.toBeInTheDocument();
  });
});

describe('isSafeSrc — una `url()` de CSS no pasa por `remotePatterns`', () => {
  it('un sprite de un dominio AJENO no se pinta', () => {
    const { container } = render(
      <CardPhotoCarousel
        {...base}
        hasVideo
        videoPreviewUrl="https://atacante.example.com/listing-previews/x/s.webp"
      />,
    );

    entrarConRaton(contenedor(container));

    // `next/image` valida el dominio por `remotePatterns`, pero esto NO es un `<img>`: es un
    // `background-image` en CSS, que se salta esa comprobación entera — el mismo agujero que
    // tiene un `<video src>` y que `ListingGallery` cierra a mano por el mismo motivo. Sin
    // esta validación, cualquier URL guardada en la columna acabaría siendo una petición del
    // navegador del visitante a un tercero.
    expect(screen.queryByTestId('card-video-preview')).not.toBeInTheDocument();
  });

  it('y uno de NUESTRO almacenamiento sí', () => {
    const { container } = render(
      <CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />,
    );
    entrarConRaton(contenedor(container));
    expect(screen.getByTestId('card-video-preview')).toBeInTheDocument();
  });
});

/**
 * LA MITAD QUE VIVE EN CSS, comprobada sobre el fichero.
 *
 * jsdom no evalúa consultas de medios ni hojas de estilo, así que **nada de lo que se
 * renderiza aquí puede probar que la animación sólo existe en escritorio**. Y es justamente
 * la decisión de producto (b): quitar `@media (hover: hover)` no rompería ni un test de los
 * de arriba, y el móvil empezaría a bajar un sprite por tarjeta en la vista de más tráfico —
 * cientos de KB en la red más cara — sin que nada se pusiera rojo.
 *
 * Así que se mira el fichero, que es donde vive el defecto. Molde de la barrera de
 * migraciones de `ultima-ip-orden.e2e-spec.ts`, y por el mismo motivo.
 */
describe('El CSS — la decisión (b) y la accesibilidad, sobre el fichero', () => {
  const css = readFileSync(
    join(__dirname, '..', '..', 'app', 'globals.css'),
    'utf8',
  );

  // Red del propio test: si el fichero se moviera, esto no puede pasar en verde afirmando
  // que ha revisado unas reglas que no ha leído.
  it('la hoja de estilos contiene las reglas del sprite', () => {
    expect(css).toContain('.sprite-previa');
    expect(css).toContain('@keyframes sprite-play');
  });

  /**
   * A QUÉ PROFUNDIDAD ESTÁ UN SELECTOR: 0 = nivel superior, 1 = dentro de una consulta.
   *
   * SE CUENTAN LLAVES Y NO SE BUSCAN CADENAS, y eso costó un rojo que no llegó a existir: la
   * primera versión de estas dos barreras comprobaba que la regla del toque apareciera
   * *después* del bloque del hover, y **la mutación de meterla dentro de la consulta pasó en
   * verde** — porque «después de la llave que cierra el selector interno» lo cumplen las dos
   * posiciones. Lo que distingue dentro de fuera no es el orden, es el anidamiento.
   *
   * Los comentarios se quitan antes: este fichero está lleno de prosa con llaves dentro
   * (`${...}`, ejemplos de código), y cualquiera de ellas descuadraría la cuenta.
   */
  const profundidadDe = (selector: string) => {
    const limpio = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const hasta = limpio.slice(0, limpio.indexOf(selector));
    expect(hasta.length).toBeGreaterThan(0); // el selector existe de verdad
    return (hasta.match(/\{/g) ?? []).length - (hasta.match(/\}/g) ?? []).length;
  };

  it('la animación DEL RATÓN sigue DENTRO de `hover: hover` y `pointer: fine`', () => {
    const bloque = css.slice(css.indexOf('.sprite-previa'));
    expect(bloque).toMatch(/@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/);
    // Y la regla que anima está DENTRO de esa consulta, no suelta al lado.
    const dentro = bloque.slice(bloque.search(/@media\s*\(hover:\s*hover\)/));
    expect(dentro.slice(0, 400)).toContain('animation: sprite-play');
    // Anidada: es lo que mantiene el camino de escritorio exactamente donde estaba.
    expect(profundidadDe('.group:hover .sprite-previa')).toBe(1);
  });

  /**
   * LA REGLA DEL TOQUE, Y POR QUÉ SE COMPRUEBA QUE ESTÁ **FUERA** DE LA CONSULTA.
   *
   * Es el único sitio donde la previa en móvil puede vivir: dentro de `@media (hover: hover)`
   * no se aplicaría nunca en un teléfono, que es el dispositivo entero para el que se hizo.
   * Si alguien la metiera ahí «por simetría», todo seguiría verde en los tests de render —la
   * capa se monta igual, el atributo se pone igual—, el sprite se descargaría… y se quedaría
   * invisible con `opacity: 0`. El peor de los dos mundos, y sin un solo rojo.
   *
   * jsdom no evalúa consultas de medios, así que este fichero es el único que puede cazarlo.
   */
  it('la animación DEL TOQUE existe y vive FUERA de la consulta de hover', () => {
    const regla = css.slice(css.indexOf(".sprite-previa[data-tap='true']"));
    expect(regla).toContain('animation: sprite-play');

    // Profundidad 0 — nivel superior. Si estuviera dentro de cualquier `@media`, sería 1.
    expect(profundidadDe(".sprite-previa[data-tap='true']")).toBe(0);
  });

  it('`steps(N)` casa con el número de fotogramas que la captura dibuja', () => {
    // Si divergieran, la ventana se pararía a mitad de un fotograma. Son la misma constante
    // vista desde los dos lados: quien dibuja la tira y quien la recorre.
    expect(css).toContain(`steps(${PREVIEW_FRAMES})`);
    expect(css).toContain(`background-size: ${PREVIEW_FRAMES * 100}% 100%`);
  });

  it('y `prefers-reduced-motion` la apaga', () => {
    // Una animación en bucle bajo el cursor es exactamente el caso que esa consulta cubre.
    // Apagarla deja el primer fotograma, que es una imagen válida — no algo mutilado.
    const reduccion = css.slice(css.lastIndexOf('prefers-reduced-motion'));
    // Por la clase BASE, así que apaga los dos gestos con una sola regla: el camino del
    // toque nació respetando la preferencia sin que hubiera que acordarse de él.
    expect(reduccion).toContain('.sprite-previa');
    expect(reduccion).toContain('animation: none');
  });
});

describe('La garantía de la ráfaga 3, intacta con la previsualización montada', () => {
  it('CERO BYTES DE VÍDEO: sigue sin montarse ningún `<video>` en una tarjeta', () => {
    const { container } = render(
      <CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />,
    );
    entrarConRaton(contenedor(container));

    // ES LA FRASE ENTERA DE ESTA VÍA: lo que se enseña al pasar el ratón es una IMAGEN, no
    // un trozo del `.mp4`. Por eso el póster animado no traiciona el diseño del vídeo —
    // `preload="none"` se respeta por construcción, porque no hay nada que precargar.
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('source')).toBeNull();
  });

  it('el indicador de vídeo sigue visible POR ENCIMA de la previsualización', () => {
    const { container } = render(
      <CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />,
    );
    entrarConRaton(contenedor(container));

    // Lo que el indicador anuncia («esto tiene vídeo») sigue siendo cierto mientras se
    // anima, y de hecho es entonces cuando más se entiende. Taparlo con la propia
    // previsualización habría sido el error fácil.
    expect(screen.getByTestId('card-tiene-video')).toBeInTheDocument();
    expect(screen.getByTestId('card-video-preview')).toBeInTheDocument();
  });
});
