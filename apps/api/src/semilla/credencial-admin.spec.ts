/**
 * BARRERA — LA CREDENCIAL DEL ADMINISTRADOR NO ESTÁ EN EL CÓDIGO, Y SIN ELLA NO SE CREA NADA.
 *
 * Ver docs/auditoria-seed.md §4.2 y `prisma/seed-admin.ts`.
 *
 * ─── QUÉ DEFIENDE, EXACTAMENTE ──────────────────────────────────────────────────
 *
 * El defecto que cerró esta ráfaga era una contraseña de administrador escrita en
 * `seed.ts`. Un defecto así **no se nota**: la semilla funciona, el despliegue sale
 * verde, y lo que queda es una cuenta con acceso a todo cuya contraseña está en un
 * fichero que cualquiera puede leer. No hay ninguna prueba de producto que se ponga roja
 * por eso, y por eso hace falta ésta.
 *
 * ─── POR QUÉ MIRA EL TEXTO DEL FICHERO ──────────────────────────────────────────
 *
 * El primer caso lee el fuente y comprueba que `bcrypt.hash` **nunca** recibe una cadena
 * literal. Es deliberado que sea así de burdo: cualquier forma de volver a meter una
 * contraseña en el código pasa por ahí, y la prueba se lee igual de bien dentro de seis
 * meses que hoy. Comprobar sólo el comportamiento no bastaría — una constante nueva con
 * otro nombre seguiría siendo una credencial pública.
 *
 * Los demás casos prueban la función pura: los cuatro caminos, sin base de datos.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  LONGITUD_MINIMA_PASSWORD,
  VAR_EMAIL_ADMIN,
  VAR_PASSWORD_ADMIN,
  resolverCredencialAdmin,
  sugerirPassword,
} from '../../prisma/seed-admin';

const DIR_SEMILLA = join(__dirname, '..', '..', 'prisma');
const FICHEROS_SEMILLA = ['seed.ts', 'seed-admin.ts', 'seed-datos-iniciales.ts', 'seed-settings.ts'];

const leer = (fichero: string) => readFileSync(join(DIR_SEMILLA, fichero), 'utf8');

describe('BARRERA 1 — cero credenciales en el código', () => {
  it('ningún fichero de la semilla pasa una cadena literal a bcrypt.hash', () => {
    // Las tres formas de escribir una cadena en TypeScript. Si alguien vuelve a poner
    // `bcrypt.hash('loquesea', ROUNDS)`, este caso se pone rojo.
    const literalABcrypt = /bcrypt\s*\.\s*hash\s*\(\s*['"`]/;

    for (const fichero of FICHEROS_SEMILLA) {
      expect(literalABcrypt.test(leer(fichero))).toBe(false);
    }
  });

  it('la semilla saca la contraseña del entorno y de ningún otro sitio', () => {
    const fuente = leer('seed.ts');
    // El único `bcrypt.hash` que queda recibe lo que resolvió el entorno.
    expect(fuente).toContain('bcrypt.hash(credencial.password');
    // Y el correo tampoco está clavado: se busca el administrador POR ROL.
    expect(fuente).not.toContain('admin@marketplace.es\'');
  });
});

describe('BARRERA 1 (fail-safe) — sin credencial no se crea administrador', () => {
  it('sin ninguna de las dos variables, no hay credencial', () => {
    const r = resolverCredencialAdmin({});
    expect(r.estado).toBe('sin-configurar');
  });

  it('con sólo el correo, tampoco — y el aviso dice cuál falta', () => {
    const r = resolverCredencialAdmin({ [VAR_EMAIL_ADMIN]: 'admin@ejemplo.test' });
    expect(r.estado).toBe('sin-configurar');
    if (r.estado !== 'sin-configurar') throw new Error('inalcanzable');
    expect(r.aviso).toContain(VAR_PASSWORD_ADMIN);
    // El que SÍ está no debe aparecer como si faltara: media configuración es el caso
    // típico y el más frustrante de depurar si el aviso miente.
    expect(r.aviso).not.toContain(`falta ${VAR_EMAIL_ADMIN}`);
  });

  it('con sólo la contraseña, tampoco', () => {
    const r = resolverCredencialAdmin({ [VAR_PASSWORD_ADMIN]: 'a'.repeat(20) });
    expect(r.estado).toBe('sin-configurar');
  });

  it('una contraseña más corta que el mínimo se rechaza, no se acepta «por ser dev»', () => {
    const corta = 'a'.repeat(LONGITUD_MINIMA_PASSWORD - 1);
    const r = resolverCredencialAdmin({
      NODE_ENV: 'development',
      [VAR_EMAIL_ADMIN]: 'admin@ejemplo.test',
      [VAR_PASSWORD_ADMIN]: corta,
    });
    expect(r.estado).toBe('invalida');
  });

  it('un correo que no es un correo se rechaza', () => {
    const r = resolverCredencialAdmin({
      [VAR_EMAIL_ADMIN]: 'no-es-un-correo',
      [VAR_PASSWORD_ADMIN]: 'a'.repeat(20),
    });
    expect(r.estado).toBe('invalida');
  });

  it('con las dos bien, hay credencial — y la contraseña llega TAL CUAL', () => {
    // Sin recortar: un espacio al final es parte de la contraseña, y «arreglárselo» al
    // operador haría que la que funciona no sea la que él escribió.
    const password = `  ${'x'.repeat(20)} `;
    const r = resolverCredencialAdmin({
      [VAR_EMAIL_ADMIN]: '  admin@ejemplo.test  ',
      [VAR_PASSWORD_ADMIN]: password,
    });
    expect(r).toEqual({ estado: 'ok', email: 'admin@ejemplo.test', password });
  });
});

describe('BARRERA 6 — desarrollo cómodo, producción segura', () => {
  const sinVariables = (nodeEnv: string) => {
    const r = resolverCredencialAdmin({ NODE_ENV: nodeEnv });
    if (r.estado !== 'sin-configurar') throw new Error('debería faltar la credencial');
    return r.aviso;
  };

  it('en desarrollo el aviso trae la línea lista para pegar, con las dos variables', () => {
    const aviso = sinVariables('development');
    expect(aviso).toContain('apps/api/.env');
    expect(aviso).toContain(`${VAR_EMAIL_ADMIN}=`);
    expect(aviso).toContain(`${VAR_PASSWORD_ADMIN}=`);
  });

  it('la contraseña que sugiere es distinta cada vez — es generada, no una constante', () => {
    // Si alguien sustituyera el generador por un valor fijo «para que sea reproducible»,
    // habría reintroducido exactamente el defecto que esta ráfaga cerró.
    expect(sinVariables('development')).not.toEqual(sinVariables('development'));
    expect(sugerirPassword()).not.toEqual(sugerirPassword());
    expect(sugerirPassword().length).toBeGreaterThanOrEqual(LONGITUD_MINIMA_PASSWORD);
  });

  it('en producción el aviso NO imprime ninguna contraseña', () => {
    // Lo último que debe hacer un despliegue es dejar un secreto en los registros del
    // arranque, ni siquiera uno sugerido.
    const aviso = sinVariables('production');
    expect(aviso).not.toContain('apps/api/.env');
    expect(aviso).toContain('entorno del despliegue');
    expect(aviso).toContain(String(LONGITUD_MINIMA_PASSWORD));
  });

  it('en los dos entornos el RESULTADO es el mismo: no se crea ningún administrador', () => {
    // La separación dev/prod está en la AYUDA, no en la seguridad. No existe ningún
    // entorno en el que la semilla invente una cuenta.
    for (const entorno of ['development', 'test', 'production', undefined]) {
      const r = resolverCredencialAdmin(entorno ? { NODE_ENV: entorno } : {});
      expect(r.estado).toBe('sin-configurar');
    }
  });
});
