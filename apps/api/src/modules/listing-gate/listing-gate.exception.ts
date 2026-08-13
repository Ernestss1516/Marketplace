import { HttpException, HttpStatus } from '@nestjs/common';
import type { GateReason } from './listing-gate.types';

/**
 * PUERTA — RÁFAGA 1. El rechazo, con VARIOS motivos.
 *
 * PAYLOAD ADITIVO, y eso es lo que lo hace seguro de desplegar:
 *   { message, code, reasons: [...] }
 * `message` y `code` son exactamente lo que el cliente ya lee hoy (`apiFetch`
 * los extrae a `ApiError`), así que **todo el frontend actual sigue funcionando
 * sin tocarlo**. `reasons` es lo único nuevo.
 *
 * POR QUÉ VARIOS Y NO UNO, que era el idioma del repo (los `assert*` lanzan al
 * primer fallo): porque la política `needsRevalidation` de la ráfaga 2 no
 * funciona con uno solo. Un anuncio marcado puede incumplir tres cosas a la vez;
 * hacer que el vendedor las descubra de una en una —corregir, reintentar,
 * descubrir la siguiente— convierte el aviso en un juego de adivinanzas, cuando
 * existe precisamente para darle un camino de salida.
 *
 * EL CÓDIGO HTTP LO ELIGE QUIEN LANZA, y se preservan los actuales: la cuota
 * sigue siendo 403 y los atributos serán 422 (ráfaga 2). No es cosmético — el
 * cliente ramifica por `statusCode` Y por `code`, así que cambiar un 403 por un
 * 422 rompería el frontend en silencio.
 */
export class ListingGateException extends HttpException {
  constructor(
    readonly reasons: GateReason[],
    status: HttpStatus,
    /** Resumen para quien sólo lee `message` — es decir, todo el cliente de hoy. */
    message: string,
    /** Código estable de la familia del fallo. */
    code: string,
  ) {
    super({ message, code, reasons }, status);
  }
}
