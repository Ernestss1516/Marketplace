/**
 * LOS TRES ESTILOS DE BANNER ANTE EL SISTEMA DE ESTILO — las barreras de color.
 *
 * Diagnóstico en docs/diagnostico-estilos-banner-por-modelo.md. Lo que esta ráfaga
 * cambió, en una frase: promo dejó de tomar prestado `--success` —que significa «ha
 * ido bien» en otros doce sitios— y tiene su propio `--promo`, el único de los tres
 * que cada modelo afina.
 *
 * ── QUÉ SE PUEDE COMPROBAR AQUÍ Y QUÉ NO ────────────────────────────────────────
 *
 * jsdom no aplica Tailwind ni resuelve variables CSS: aquí no hay color, hay CLASES.
 * Así que estas pruebas vigilan lo que sí es verificable sin navegador y es justo lo
 * que se rompería —que una clase de color vuelva a estar escrita a mano, que dos
 * estilos compartan token, que la forma deje de ser común—, y los COLORES de verdad,
 * resueltos y medidos por modelo, los vigilan dos sitios que sí pueden:
 *
 *   · `apps/api/.../contraste-modelos.spec.ts` — mide promo en cada modelo y cada
 *     versión, con las mismas dos parejas que info y aviso. Es lo que convierte
 *     «cada modelo elige su magenta» en algo comprobado.
 *   · `e2e/estilos-banner-por-modelo.spec.ts` — los pinta en un navegador con cada
 *     modelo puesto y compara los píxeles resueltos.
 */

import { render, screen } from '@testing-library/react';
import { BannerList } from './BannerList';
import type { Banner, BannerVariant } from '@/lib/api/banners';

jest.mock('next/link', () => {
  return function MockLink({ href, children }: { href: string; children: React.ReactNode }) {
    return <a href={href}>{children}</a>;
  };
});

function banner(variant: BannerVariant): Banner {
  return {
    id: `b-${variant}`,
    title: `Título ${variant}`,
    text: 'Texto',
    linkUrl: null,
    linkText: null,
    placements: ['HOME'],
    variant,
    shareable: false,
    shareText: null,
    active: true,
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2030-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const LOS_TRES: BannerVariant[] = ['INFO', 'PROMO', 'WARNING'];

/** Las clases del banner de ese estilo, ya renderizado. */
function clasesDe(variant: BannerVariant): string[] {
  const { unmount } = render(<BannerList banners={[banner(variant)]} />);
  const clases = screen.getByTestId('banner').className.split(/\s+/);
  unmount();
  return clases;
}

/** Sólo las que pintan color (fondo, trazo o letra). */
function clasesDeColor(variant: BannerVariant): string[] {
  return clasesDe(variant).filter((c) => /^(bg|text|border)-/.test(c) && c !== 'border');
}

beforeEach(() => localStorage.clear());

// ─────────────────────────────────────────────────────────────────────────────
// BARRERA 1 — los tres por tokens, ninguno con un color escrito a mano
// ─────────────────────────────────────────────────────────────────────────────

describe('BARRERA 1 — los tres estilos pintan con tokens, no con colores fijos', () => {
  /**
   * La lista negra son las FAMILIAS DE PALETA de Tailwind. Una clase como `bg-amber-50`
   * o `text-blue-700` es un color escrito a mano: no pasa por el registro de modelos, así
   * que ningún modelo puede cambiarla y ninguna versión oscura puede darle la vuelta.
   *
   * Es exactamente el defecto que esta ráfaga encontró en la previa de `/admin/estilo`
   * (`border-amber-500/50 bg-amber-500/10 text-amber-600`, dentro del panel que existe
   * para enseñar el modelo). Aquí se impide que vuelva, en los banners.
   */
  const PALETA_CRUDA =
    /^(bg|text|border)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(\/\d+)?$/;

  for (const variant of LOS_TRES) {
    it(`${variant}: ninguna clase de color es de la paleta cruda`, () => {
      const crudas = clasesDeColor(variant).filter((c) => PALETA_CRUDA.test(c));
      expect(crudas).toEqual([]);
    });
  }

  it('cada estilo usa el token de SU intención, y promo ya no el de «éxito»', () => {
    // El caso que motivó la ráfaga: PROMO decía `bg-success`, que significa «ha ido
    // bien». Si alguien lo devuelve ahí, esto cae.
    expect(clasesDeColor('INFO').sort()).toEqual(
      ['bg-info', 'border-info-border', 'text-info-foreground'].sort(),
    );
    expect(clasesDeColor('PROMO').sort()).toEqual(
      ['bg-promo', 'border-promo-border', 'text-promo-foreground'].sort(),
    );
    expect(clasesDeColor('WARNING').sort()).toEqual(
      ['bg-warning', 'border-warning-border', 'text-warning-foreground'].sort(),
    );
  });

  it('PROMO no toca NINGUNA clase de la familia `success`', () => {
    expect(clasesDe('PROMO').filter((c) => c.includes('success'))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BARRERA 3 — los tres diferenciados entre sí
// ─────────────────────────────────────────────────────────────────────────────

describe('BARRERA 3 — el usuario distingue info de promo y de aviso', () => {
  it('los tres usan familias de token DISTINTAS, sin solaparse', () => {
    const familias = LOS_TRES.map(
      (v) => clasesDeColor(v).find((c) => c.startsWith('bg-'))!.replace('bg-', ''),
    );
    expect(familias).toEqual(['info', 'promo', 'warning']);
    expect(new Set(familias).size).toBe(3);
  });

  it('ningún par de estilos comparte una sola clase de color', () => {
    // El estado anterior —promo con los tokens de éxito— habría pasado esta prueba, y por
    // eso no basta ella sola: lo que la completa es la BARRERA 1, que exige que el token
    // sea el de SU intención, y el contraste del backend, que exige que el color se vea.
    for (const [a, b] of [
      ['INFO', 'PROMO'],
      ['INFO', 'WARNING'],
      ['PROMO', 'WARNING'],
    ] as const) {
      const comunes = clasesDeColor(a).filter((c) => clasesDeColor(b).includes(c));
      expect({ par: `${a}/${b}`, comunes }).toEqual({ par: `${a}/${b}`, comunes: [] });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BARRERA 5 — la frontera: estructura común, sabor por tokens
// ─────────────────────────────────────────────────────────────────────────────

describe('BARRERA 5 — reviste, no reorganiza', () => {
  it('los tres comparten EXACTAMENTE la misma forma; sólo cambia el color', () => {
    // Quitadas las clases de color, las tres cadenas tienen que ser la misma. Si un
    // estilo se ganara un `p-6`, un `rounded-xl` o un `border-2` propio, dejaría de ser
    // revestir para pasar a reorganizar — y esto lo caza.
    const formas = LOS_TRES.map((v) =>
      clasesDe(v)
        .filter((c) => !clasesDeColor(v).includes(c))
        .sort()
        .join(' '),
    );
    expect(new Set(formas).size).toBe(1);
    expect(formas[0]).toContain('rounded-md');
    expect(formas[0]).toContain('border');
  });

  it('la forma NO lleva ningún color: el estilo no puede colarlo por ahí', () => {
    const forma = clasesDe('INFO').filter((c) => !clasesDeColor('INFO').includes(c));
    expect(forma.filter((c) => /^(bg|text|border)-/.test(c))).toEqual([]);
  });
});
