/**
 * ROTACIÓN DE DESTACADOS — R3: la PROMESA y la ETIQUETA (§10.1 y §10.2).
 *
 * Dos correcciones de honestidad que no se comprueban mirando píxeles sino TEXTO, porque el
 * defecto era textual: decían cosas que habían dejado de ser verdad.
 *
 *  · §10.1 — el diálogo de compra prometía el bloque INCONDICIONALMENTE («aparece … durante
 *    varios días») cuando el bloque estaba congelado y quien destacaba un anuncio antiguo no
 *    aparecía ni un día. Ahora promete un TURNO, que es lo que R2 entrega.
 *  · §10.2 — «Destacados primero» dejó de destacar nada con la Política de ordenación C. La
 *    etiqueta pasa a decir lo que hace; el VALOR guardado se queda como está, porque vive en
 *    el JSON de los bloques ya publicados.
 */

// `next-auth/react` es ESM-only y next/jest no lo transforma. Aquí no se pinta nada: se
// importan constantes, pero importar `PromocionarDialog` arrastra el módulo entero
// (-> use-api-action -> next-auth). Mismo mock mínimo que el resto de la casa.
jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: null }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
}));

import { SORT_OPTIONS as SORT_PORTADA } from '@/app/(admin)/admin/portada/_components/editors/ListingsHomeBlockEditor';
import { SORT_OPTIONS as SORT_BLOG } from '@/app/(admin)/admin/blog/_components/block-editor/editors/ListingsBlockEditor';
import { PROMESA_DESTACADO, textoDeCompetencia } from './owner/PromocionarDialog';
import type { FeaturedCompetition } from '@/lib/api/billing';

describe('R3 §10.1 — la promesa del diálogo dice lo que se entrega', () => {
  it('promete un TURNO, no permanencia', () => {
    // LA MUTACIÓN QUE ESTO MATA: volver a «aparece en el bloque de promocionados durante
    // varios días». Con el bloque rotando, prometer presencia continua vuelve a ser falso
    // —y es una promesa de PAGO—.
    expect(PROMESA_DESTACADO).toMatch(/turno/i);
    expect(PROMESA_DESTACADO).toMatch(/alternándose/i);
    expect(PROMESA_DESTACADO).not.toMatch(/durante varios días/i);
    expect(PROMESA_DESTACADO).not.toMatch(/siempre|el primero|permanente/i);
  });

  it('y sus DOS mitades son cada una verdad: la etiqueta permanente y el bloque rotatorio', () => {
    // La mitad que sí es incondicional —el badge va en todos los resultados— se puede seguir
    // afirmando sin matices, y se afirma. La otra se dice como lo que es.
    expect(PROMESA_DESTACADO).toMatch(/etiqueta «Destacado» en todos los resultados/i);
    expect(PROMESA_DESTACADO).toMatch(/bloque «Promocionados»/i);
  });
});

describe('R4 — la cifra real: no sólo «rotas», sino «rotas ESTO»', () => {
  const competencia = (
    vigentes: number,
    cuota: Partial<FeaturedCompetition['cuota']> = {},
  ): FeaturedCompetition => ({
    categoria: { name: 'Coches', slug: 'coches' },
    vigentes,
    cuota: {
      candidatos: vigentes + 1,
      grupos: 3,
      siempre: false,
      minutosDeVitrinaAlDia: 480,
      cicloMinutos: 45,
      ...cuota,
    },
  });

  it('dice CUÁNTOS hay y CUÁNTO saldría — la cifra, no la vaguedad', () => {
    const texto = textoDeCompetencia(competencia(11));

    expect(texto).toContain('11 anuncios destacados en Coches');
    expect(texto).toContain('8 h al día');
    expect(texto).toContain('se turnaría');
  });

  it('cuando caben todos dice «siempre», que es lo que pasa', () => {
    const texto = textoDeCompetencia(
      competencia(2, { siempre: true, grupos: 1, minutosDeVitrinaAlDia: 1440 }),
    );

    expect(texto).toContain('2 anuncios destacados');
    expect(texto).toContain('saldría siempre');
    expect(texto).not.toContain('al día'); // no hay reparto que contar
  });

  it('la categoría vacía se dice en castellano, no con un cero', () => {
    const texto = textoDeCompetencia(
      competencia(0, { candidatos: 1, siempre: true, grupos: 1, minutosDeVitrinaAlDia: 1440 }),
    );

    expect(texto).toContain('no hay ningún anuncio destacado');
    expect(texto).toContain('saldría siempre');
  });

  it('el singular no chirría', () => {
    expect(textoDeCompetencia(competencia(1))).toContain('1 anuncio destacado en Coches');
  });

  it('NO promete al minuto: es una estimación de ahora mismo, y se dice', () => {
    // La misma honestidad que el «sobre las HH:00» del bump programado. Prometer exactitud
    // sobre una cifra que cambia en cuanto alguien más destaque sería volver al problema.
    const texto = textoDeCompetencia(competencia(11));
    expect(texto).toMatch(/^Ahora mismo/);
    expect(texto).toContain('unas ');
  });

  it('formatea duraciones que un humano lee, no minutos crudos', () => {
    expect(textoDeCompetencia(competencia(49, { minutosDeVitrinaAlDia: 1440 / 13 }))).toContain(
      '1 h 51 min',
    );
    expect(textoDeCompetencia(competencia(199, { minutosDeVitrinaAlDia: 28.8 }))).toContain(
      '29 min',
    );
  });
});

describe('R3 §10.2 — la etiqueta del orden dice lo que ese orden hace', () => {
  for (const [donde, opciones] of Object.entries({
    portada: SORT_PORTADA,
    blog: SORT_BLOG,
  })) {
    it(`${donde}: ya no se llama «Destacados primero», porque no destaca nada`, () => {
      const etiquetas = opciones.map((o) => o.label);
      expect(etiquetas).not.toContain('Destacados primero');
      expect(etiquetas).toContain('Recientes o reimpulsados');
    });

    it(`${donde}: el VALOR guardado sigue siendo 'featured' — nada que migrar`, () => {
      // LA MUTACIÓN QUE ESTO MATA: renombrar también el valor. Está persistido en el JSON de
      // los bloques ya publicados; cambiarlo dejaría a esos bloques con un orden que el
      // resolutor no reconoce, y obligaría a una migración de contenido para no ganar nada.
      expect(opciones.map((o) => o.value).sort()).toEqual(['featured', 'recent']);
    });
  }
});
