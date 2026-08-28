import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * NOTIFICACIONES A1 — LA PUERTA ÚNICA: NADIE CREA UNA `Notification` POR SU CUENTA.
 *
 * ── QUÉ FALLO CIERRA, Y POR QUÉ HACE FALTA UN TEST PARA ESO ─────────────────
 *
 * `NotificationsService.createNotification()` empareja cada `type` con la forma
 * exacta de su `data` (`DataByType`), y desde A1 está además obligado a cubrir
 * `NotificationType` entero. Esa barrera es buena, pero **sólo protege a quien
 * pasa por ella**: `prisma.notification.create()` estaba a un import de distancia.
 *
 * Y SE RODEÓ DOS VECES. Las dos con el mismo desenlace: un aviso que el front no
 * sabía pintar y que le salía al usuario como «Nueva notificación», sin texto y
 * sin enlace.
 *
 *   · `INVOICING_PENDING_FISCAL_DATA` — el propio comentario que lo arregló en
 *     `notification-content.ts` dejó escrito que volvería a pasar.
 *   · `DATA_EXPORT_READY` — creado con Prisma directo, nunca llegó al registro de
 *     tipos, y avisaba de un ZIP **que caduca** sin decir qué era ni llevar a la
 *     descarga.
 *
 * ── POR QUÉ ESTO Y NO EL COMPILADOR ─────────────────────────────────────────
 *
 * Se intentó primero, que era lo preferible, y NO SE PUEDE: `PrismaClient` declara
 * `notification` como *accessor*, y TypeScript rechaza redeclararlo en una
 * subclase con cualquier forma de propiedad (TS2610) — comprobado con `declare`,
 * con `readonly` y por fusión de interfaz sobre `PrismaService`. Sustituirlo por un
 * getter tampoco vale: Prisma crea los delegates como propiedades **de instancia**,
 * así que `super.notification` sería `undefined` en ejecución.
 *
 * Tampoco valía una regla de lint: `apps/api` no tiene ESLint configurado, y una
 * regla de lint se apaga con un comentario en la línea de al lado.
 *
 * Así que la barrera vive aquí. No es el compilador, pero cumple la propiedad que
 * importa y que es la que faltaba: **el olvido no se puede fusionar**. Mismo
 * molde que `admin-controllers.contract.spec.ts`, que vigila que ningún
 * controlador de backoffice se quede sin piso de rol.
 *
 * ── SE RECORRE EL DISCO, NO UNA LISTA ───────────────────────────────────────
 *
 * Una lista de ficheros a revisar sería otra lista a mano —justo el defecto que
 * esto cierra—: quien añadiera un módulo nuevo tendría un test en verde que no
 * comprueba nada.
 */

const SRC = join(__dirname, '..', '..');

/** El fichero que SÍ puede crearlas: es la puerta. */
const PUERTA = join('modules', 'notifications', 'notifications.service.ts');

/**
 * Todas las vías por las que Prisma puede insertar una fila. Cerrar sólo `create`
 * dejaría `createMany` y `upsert` abiertos, que es la misma clase de hueco.
 */
const CREACION = ['create', 'createMany', 'createManyAndReturn', 'upsert'];

/**
 * `<algo>.notification.<vía de creación>(`.
 *
 * Cubre `this.prisma.`, `prisma.` y `tx.` (dentro de una `$transaction`), que son
 * las tres formas en las que se accede al cliente en este proyecto.
 */
const CREACION_DIRECTA = new RegExp(`\\.notification\\s*\\.\\s*(?:${CREACION.join('|')})\\s*\\(`);

/**
 * Los comentarios NO cuentan. Sin esto, el propio texto que explica el fallo —que
 * necesita nombrar `prisma.notification.create()` para poder contarlo— haría fallar
 * la comprobación, y el arreglo obvio sería dejar de explicarlo. Se vacía el
 * comentario en vez de borrar la línea para que los números de línea del informe
 * sigan señalando al sitio correcto.
 */
function sinComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

function ficherosTs(dir: string): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      encontrados.push(...ficherosTs(ruta));
    } else if (entrada.endsWith('.ts') && !entrada.endsWith('.spec.ts')) {
      encontrados.push(ruta);
    }
  }
  return encontrados;
}

describe('Notificaciones — la puerta única (A1)', () => {
  it('nadie crea una Notification fuera de NotificationsService.createNotification()', () => {
    const infractores: string[] = [];

    for (const fichero of ficherosTs(SRC)) {
      const relativo = relative(SRC, fichero);
      if (relativo === PUERTA) continue;

      const lineas = sinComentarios(readFileSync(fichero, 'utf8')).split('\n');
      lineas.forEach((linea, i) => {
        if (CREACION_DIRECTA.test(linea)) {
          infractores.push(`${relativo.split(sep).join('/')}:${i + 1} → ${linea.trim()}`);
        }
      });
    }

    expect(infractores).toEqual([]);
  });

  /**
   * El guardián se guarda a sí mismo: si alguien renombra o mueve la puerta, el
   * `continue` de arriba dejaría de excluir nada y este test pasaría a ser un
   * verde que no comprueba nada. Aquí se exige que la puerta exista Y que dentro
   * haya de verdad una creación — que es lo que la hace la puerta.
   */
  it('la puerta sigue estando donde se la excluye, y sigue siendo la que crea', () => {
    const puerta = sinComentarios(readFileSync(join(SRC, PUERTA), 'utf8'));
    expect(CREACION_DIRECTA.test(puerta)).toBe(true);
  });
});
