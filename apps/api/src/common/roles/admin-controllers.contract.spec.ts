import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { PATH_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { Role } from '@prisma/client';
import { RolesGuard } from '../guards/roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ROLE_ORDER } from './role-hierarchy';

/**
 * ROLES RÁFAGA 1 — T2 del plan de verificación: **INV-2, «ningún endpoint del
 * backoffice sin piso de rol»** (docs/diseno-roles.md §2.2 y §6.1).
 *
 * HOY PASA EN VERDE. Su valor no es descubrir un agujero —la auditoría verificó
 * que los 15 controladores de admin ya tenían `RolesGuard`— sino que **siga
 * pasando cuando llegue el controlador 16**, y los cuerpos P1-P6 van a añadir
 * varios. Una sección nueva del backoffice cuyo controlador se olvide el guard, o
 * un handler sin piso, rompe CI en vez de quedar abierto en silencio.
 *
 * LOS CONTROLADORES SE DESCUBREN DEL DISCO, NO DE UNA LISTA. Una lista de imports
 * sería otra lista a mano — exactamente el defecto que esta ráfaga cierra: quien
 * añadiera un controlador sin acordarse de meterlo aquí tendría un test en verde
 * que no comprueba nada. Se recorre `src/modules`, se importa cada
 * `*.controller.ts` y se lee la metadata REAL de Nest, la misma que lee el
 * `Reflector` en tiempo de ejecución.
 */

const MODULES_DIR = join(__dirname, '..', '..', 'modules');

function ficherosDeControlador(dir: string): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      encontrados.push(...ficherosDeControlador(ruta));
    } else if (entrada.endsWith('.controller.ts') && !entrada.endsWith('.spec.ts')) {
      encontrados.push(ruta);
    }
  }
  return encontrados;
}

interface ControladorDescubierto {
  fichero: string;
  nombre: string;
  clase: Function;
  ruta: string;
}

function descubrirControladores(): ControladorDescubierto[] {
  const salida: ControladorDescubierto[] = [];
  for (const fichero of ficherosDeControlador(MODULES_DIR)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const modulo = require(fichero.replace(/\.ts$/, '')) as Record<string, unknown>;
    for (const [nombre, exportado] of Object.entries(modulo)) {
      if (typeof exportado !== 'function') continue;
      const ruta = Reflect.getMetadata(PATH_METADATA, exportado) as string | undefined;
      if (typeof ruta !== 'string') continue; // no es un @Controller
      salida.push({
        fichero: fichero.slice(MODULES_DIR.length + 1).replace(/\\/g, '/'),
        nombre,
        clase: exportado,
        ruta,
      });
    }
  }
  return salida;
}

/** Los handlers de un controlador = los métodos del prototipo con metadata de ruta. */
function handlersDe(clase: Function): string[] {
  const proto = clase.prototype as object;
  return Object.getOwnPropertyNames(proto).filter((nombre) => {
    if (nombre === 'constructor') return false;
    const descriptor = Object.getOwnPropertyDescriptor(proto, nombre);
    if (typeof descriptor?.value !== 'function') return false;
    return Reflect.hasMetadata(PATH_METADATA, descriptor.value as object);
  });
}

/** El piso efectivo de un handler, resuelto como lo resuelve `getAllAndOverride`: método, y si no, clase. */
function rolesEfectivos(clase: Function, handler: string): unknown {
  const metodo = (clase.prototype as Record<string, unknown>)[handler] as object;
  const propio = Reflect.getMetadata(ROLES_KEY, metodo);
  return propio ?? Reflect.getMetadata(ROLES_KEY, clase);
}

function tieneRolesGuard(clase: Function): boolean {
  const guards = (Reflect.getMetadata(GUARDS_METADATA, clase) ?? []) as Function[];
  return guards.some((g) => g === RolesGuard);
}

const CONTROLADORES = descubrirControladores();
const DE_ADMIN = CONTROLADORES.filter((c) => c.ruta.startsWith('admin'));
const CON_ROLES = CONTROLADORES.filter(
  (c) =>
    Reflect.getMetadata(ROLES_KEY, c.clase) !== undefined ||
    handlersDe(c.clase).some((h) =>
      Reflect.getMetadata(ROLES_KEY, (c.clase.prototype as Record<string, unknown>)[h] as object) !== undefined,
    ),
);

describe('descubrimiento', () => {
  it('encuentra controladores (si esto falla, el resto del fichero no comprueba nada)', () => {
    // Red del propio test: un cambio de estructura de carpetas que dejara el
    // descubrimiento a cero convertiría todos los `it.each` de abajo en no-ops
    // silenciosos, y este fichero pasaría en verde sin comprobar nada.
    expect(CONTROLADORES.length).toBeGreaterThan(20);
    expect(DE_ADMIN.length).toBeGreaterThanOrEqual(15);
  });
});

describe('INV-2 — todo controlador bajo /admin declara piso de rol', () => {
  it.each(DE_ADMIN.map((c) => [c.fichero, c.nombre, c] as const))(
    '%s → %s usa RolesGuard',
    (_fichero, _nombre, controlador) => {
      expect(tieneRolesGuard(controlador.clase)).toBe(true);
    },
  );

  it.each(DE_ADMIN.map((c) => [c.fichero, c.nombre, c] as const))(
    '%s → %s declara piso a nivel de CLASE',
    (_fichero, _nombre, controlador) => {
      // El piso de clase es lo que hace innecesario auditar handler por handler:
      // `getAllAndOverride` cae a la clase cuando el método no declara nada, así
      // que con clase declarada NINGÚN handler puede quedar sin piso por omisión.
      // Un override de método sólo puede SUSTITUIR el piso, nunca quitarlo.
      expect(Reflect.getMetadata(ROLES_KEY, controlador.clase)).toBeDefined();
    },
  );

  it.each(DE_ADMIN.map((c) => [c.fichero, c.nombre, c] as const))(
    '%s → %s: todos sus handlers resuelven a un piso',
    (_fichero, _nombre, controlador) => {
      const handlers = handlersDe(controlador.clase);
      expect(handlers.length).toBeGreaterThan(0);
      for (const handler of handlers) {
        expect(rolesEfectivos(controlador.clase, handler)).toBeDefined();
      }
    },
  );
});

describe('INV-2b — metadata de roles sin RolesGuard no protege nada', () => {
  it.each(CON_ROLES.map((c) => [c.fichero, c.nombre, c] as const))(
    '%s → %s declara roles Y monta RolesGuard',
    (_fichero, _nombre, controlador) => {
      // El fallo que esto atrapa es de los peores: un `@MinRole` puesto con
      // cuidado en un controlador que se olvidó `RolesGuard` en `@UseGuards`. La
      // metadata queda ahí, decorativa, y el endpoint está abierto a cualquier
      // usuario autenticado. Cubre también los controladores del backoffice que
      // NO cuelgan de /admin (p. ej. ModerationController, ruta 'moderation').
      expect(tieneRolesGuard(controlador.clase)).toBe(true);
    },
  );
});

describe('ningún piso vacío — la trampa del RolesGuard', () => {
  it.each(CON_ROLES.map((c) => [c.fichero, c.nombre, c] as const))(
    '%s → %s: sus roles son válidos y no están vacíos',
    (_fichero, _nombre, controlador) => {
      // `RolesGuard` hace `if (!required?.length) return true` — es decir, una
      // lista VACÍA abre el endpoint a todo el mundo. `@MinRole` con un rol fuera
      // de la escalera produce exactamente eso (`rolesFrom` devuelve []), así que
      // el fail-closed de la escalera se volvería fail-OPEN aquí. Se afirma que
      // no ocurre en ningún sitio.
      const objetivos: unknown[] = [Reflect.getMetadata(ROLES_KEY, controlador.clase)];
      for (const handler of handlersDe(controlador.clase)) {
        objetivos.push(rolesEfectivos(controlador.clase, handler));
      }
      for (const roles of objetivos) {
        if (roles === undefined) continue;
        expect(Array.isArray(roles)).toBe(true);
        const lista = roles as Role[];
        expect(lista.length).toBeGreaterThan(0);
        for (const role of lista) expect(ROLE_ORDER).toContain(role);
      }
    },
  );
});
