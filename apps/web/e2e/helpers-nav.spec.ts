// Guarda de `e2e/helpers/nav.ts` — la única pieza de infraestructura de test que
// TOLERA un bug ajeno (el wedge del router de Next, #57565, sin fix upstream).
//
// Existe por una razón concreta: **la tolerancia solo es aceptable mientras sea
// visible**. Si alguien quita el `console.log` de la recuperación, el helper
// seguiría pasando los tests y nadie se enteraría de que el wedge ha pasado de
// ocasional a constante — un verde mudo escondiendo un router roto. Este fichero
// clava las tres propiedades: que recarga, que cuenta bien, y que lo dice.
//
// Con DOBLES, no con un navegador: el wedge real es estocástico y provocarlo por
// la red resultó poco fiable (abortando solo la RSC payload, Next cae a
// navegación dura y el clic funciona igual; abortando el destino entero, el
// segundo clic se queda sin página utilizable). Lo que se comprueba aquí es el
// camino del helper, y eso se comprueba mejor de forma determinista. Que la
// recarga sirva de algo contra el wedge REAL lo mide la batería completa.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { clicarYEsperarUrl } from './helpers/nav';

function dobles(fallosAntesDeConmutar: number) {
  const traza: string[] = [];
  let clics = 0;
  const page = {
    async waitForURL() {
      if (clics <= fallosAntesDeConmutar) throw new Error('no conmutó');
    },
    async reload() {
      traza.push('reload');
    },
  } as unknown as Page;
  const chip = {
    async click() {
      clics++;
      traza.push(`click#${clics}`);
    },
  } as unknown as Locator;
  return { page, chip, traza };
}

test('con la bandera puesta, recarga entre intentos y lo registra', async () => {
  const { page, chip, traza } = dobles(2); // los dos primeros clics no conmutan
  const lineas: string[] = [];
  const original = console.log;
  console.log = (...a: unknown[]) => lineas.push(a.join(' '));
  try {
    await clicarYEsperarUrl(page, chip, () => true, {
      timeout: 10_000,
      porIntento: 100,
      recargarEntreIntentos: true,
    });
  } finally {
    console.log = original;
  }

  // Clic → falla → recarga → clic → falla → recarga → clic → conmuta.
  expect(traza).toEqual(['click#1', 'reload', 'click#2', 'reload', 'click#3']);
  expect(lineas).toContain('[clicarYEsperarUrl] recuperado tras 2 recarga(s)');
});

test('sin la bandera, reintenta el clic pero NO recarga ni ensucia el log', async () => {
  const { page, chip, traza } = dobles(1);
  const lineas: string[] = [];
  const original = console.log;
  console.log = (...a: unknown[]) => lineas.push(a.join(' '));
  try {
    await clicarYEsperarUrl(page, chip, () => true, { timeout: 10_000, porIntento: 100 });
  } finally {
    console.log = original;
  }

  expect(traza).toEqual(['click#1', 'click#2']);
  expect(lineas).toEqual([]);
});

test('a la primera no recarga ni imprime nada', async () => {
  const { page, chip, traza } = dobles(0);
  const lineas: string[] = [];
  const original = console.log;
  console.log = (...a: unknown[]) => lineas.push(a.join(' '));
  try {
    await clicarYEsperarUrl(page, chip, () => true, {
      timeout: 10_000,
      porIntento: 100,
      recargarEntreIntentos: true,
    });
  } finally {
    console.log = original;
  }

  expect(traza).toEqual(['click#1']);
  expect(lineas).toEqual([]);
});
