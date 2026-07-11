import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Validador de URL compartido para contenido guardado en BD que acaba en un
 * atributo `href`/`src` real (FooterItem.url, bloques de contenido).
 *
 * Regla: ruta relativa que empieza por "/", o URL absoluta con protocolo
 * http:/https:. NUNCA javascript:, data:, ni otro esquema — ese es
 * precisamente el vector que un `<a href>`/`<img src>` sin validar abriría.
 *
 * Exportada como función pura (usada en FooterService, un chequeo cruzado
 * fuera de DTO) Y como decorador `@IsSafeContentUrl()` (usada en los DTOs de
 * bloques — cta.href, hub.links[].href — mismo sitio donde vive cualquier
 * otro chequeo de un único campo, `@IsUrl`/`@Matches` no alcanzan a expresar
 * "relativa O absoluta http/https" en una sola regla).
 */
export function isSafeContentUrl(value: string): boolean {
  if (value.startsWith('/')) return true;
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Variante estricta: SOLO URL absoluta http/https, rechaza rutas relativas.
 * Usada donde "interno" y "externo" ya son dos ramas separadas (p. ej.
 * FooterItemType.EXTERNAL) — ahí una ruta relativa colada en la rama externa
 * sería un error de datos, no un caso válido más.
 */
export function isAbsoluteHttpUrl(value: string): boolean {
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Restringe a nuestro propio storage (R2/MinIO) — mismo criterio que
 * `coverUrl` y las imágenes insertadas en el editor Markdown ("upload-only,
 * no external URLs"). Usado por el bloque `image`: a diferencia de
 * `cta`/`hub` (que sí pueden enlazar fuera), una imagen de bloque solo puede
 * venir del endpoint de upload propio.
 *
 * Lee `S3_PUBLIC_URL` directamente de `process.env` (mismo estilo que
 * `RevalidateService`, que lee `APP_URL`/`REVALIDATE_SECRET` sin pasar por
 * `ConfigService` — es una función pura, no un provider inyectable).
 */
export function isOwnStorageUrl(value: string): boolean {
  const publicUrl = process.env.S3_PUBLIC_URL;
  if (!publicUrl) return false;
  return value.startsWith(publicUrl);
}

/** Decorador class-validator para `isSafeContentUrl` — ver el comentario de esa función. */
export function IsSafeContentUrl(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isSafeContentUrl',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && isSafeContentUrl(value);
        },
        defaultMessage(): string {
          return `${propertyName} debe ser una ruta relativa ("/...") o una URL absoluta http/https`;
        },
      },
    });
  };
}

/** Decorador class-validator para `isOwnStorageUrl` — ver el comentario de esa función. */
export function IsOwnStorageUrl(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isOwnStorageUrl',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && isOwnStorageUrl(value);
        },
        defaultMessage(): string {
          return `${propertyName} debe ser una URL de nuestro propio almacenamiento (subida vía upload)`;
        },
      },
    });
  };
}
