import { test, expect } from '@playwright/test';

/**
 * E4a — EL TEMA TIENE QUE ESTAR EN EL HTML DE LA PRIMERA RESPUESTA.
 *
 * ── POR QUÉ SE PIDE EL HTML CRUDO Y NO SE MIRA LA PÁGINA ──────────────────────────
 *
 * Con `page.goto()` no se puede distinguir un `<style>` que venía en la respuesta de
 * uno que ha inyectado JavaScript después de hidratar: los dos acaban en el DOM. Y esa
 * diferencia es EXACTAMENTE lo que hay que probar, porque un tema que llega por JS
 * produce un instante con los colores por defecto y luego un repintado — el salto que
 * la frontera prohíbe (§6) y, con él, CLS en la ruta de más tráfico.
 *
 * `request.get()` trae el HTML tal como sale del servidor, sin ejecutar una línea de
 * JavaScript. Si el bloque está ahí, está antes del primer píxel pintado.
 *
 * ── EL SELECTOR IMPORTA ───────────────────────────────────────────────────────────
 *
 * Se comprueba `html:root` y no `:root`: entre custom properties de igual
 * especificidad gana la última declarada, y el orden en que Next coloca el CSS y los
 * `<style>` de un Server Component no está garantizado. `html:root` gana por
 * especificidad, que no depende del orden. (Corrige la nota (a) del §3.4 del diseño,
 * que pedía lo contrario.)
 */
test.describe('El tema del Modelo 0 viaja en la primera respuesta', () => {
  test('el HTML del servidor ya trae el bloque de variables', async ({ request }) => {
    const res = await request.get('/');
    expect(res.ok()).toBe(true);
    const html = await res.text();

    // La etiqueta, con su marca. Si esto falla, o el backend no respondió (y entonces
    // manda `globals.css`, que es el respaldo correcto pero no lo que se prueba aquí)
    // o alguien movió la emisión al cliente.
    expect(html).toContain('data-estilo="modelo"');

    // El selector que gana por especificidad.
    expect(html).toContain('html:root{');

    // Y los valores del Modelo 0, que son los de `globals.css`. Se comprueban tres de
    // familias distintas —marca, rampa neutra y un eje T3— para que el test no pase
    // por casualidad con un bloque a medias.
    expect(html).toContain('--primary:221.2 83.2% 53.3%');
    expect(html).toContain('--border:214.3 31.8% 91.4%');
    expect(html).toContain('--icon-stroke:2');
  });

  test('el endpoint público sirve el tema resuelto, sin sesión', async ({ request }) => {
    // Tiene que ser público: el layout raíz lo resuelve para la primera visita anónima,
    // cuando todavía no hay sesión que presentar.
    const res = await request.get('http://localhost:3001/api/estilo');
    expect(res.ok()).toBe(true);

    const body = (await res.json()) as {
      modelo: string;
      tokens: Record<string, string>;
      avisos: unknown[];
    };
    expect(body.modelo).toBe('modelo-0');
    expect(body.tokens.primary).toBe('221.2 83.2% 53.3%');
    // El aviso del trazo (1,23:1 sobre blanco) se informa pero no bloquea — ver
    // `avisosContraste` en el backend.
    expect(Array.isArray(body.avisos)).toBe(true);
  });
});
