import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import type { DetectableText, Detection, Detector } from '../detection.types';
import { esPhonePattern, normalizarTelefono } from '../phone-format';

export const FLAGGED_PHONES_SETTING = 'flaggedPhones';

/**
 * A2 — TELÉFONOS MARCADOS: «este número concreto ya nos ha dado problemas».
 *
 * ─── CONVIVE CON `PhoneDetector`, NO LO SUSTITUYE ────────────────────────────────────
 *
 * Son dos preguntas distintas, y las dos existen:
 *
 *   · `PHONE` (heurístico) — **«hay un teléfono FUERA de su sitio»**. Es evasión: la
 *     plataforma ofrece `Listing.phone`, servido tras `JwtAuthGuard`, y escribir el número
 *     en la descripción lo hace visible sin identificarse. Dispara con CUALQUIER teléfono,
 *     así que tiene falsos positivos —una referencia de nueve dígitos que empieza por 6-9— y
 *     por eso sigue avisando.
 *   · `PHONE_LIST` (esto) — **«ESE número está marcado»**. Es reincidencia. Su criterio no
 *     es una heurística: es una lista que alguien escribió a mano.
 *
 * Retirar el heurístico habría matado la detección de evasión, que es el único caso de uso
 * que el punto 6 llegó a justificar desde el dominio. Convivir sale barato porque el
 * mecanismo de dos modos ya está: el heurístico se queda en `WARN`, donde sus falsos
 * positivos no le cuestan un anuncio a nadie, y esta lista puede ascender.
 *
 * ─── EL RECONOCEDOR ES EL MISMO. LO ÚNICO QUE CAMBIA ES EL CRITERIO ──────────────────
 *
 * `phone-format.ts` reconoce y canoniza; los dos detectores lo usan. Escribir aquí un
 * segundo patrón «parecido» habría producido el clásico: uno que encuentra una cosa y otro
 * que encuentra otra, divergiendo en silencio. Hay una barrera que lo afirma —todo lo que el
 * patrón reconoce, el normalizador lo canoniza— y esto se apoya en ella.
 *
 * ─── LOS TRES CAMPOS, Y LA ASIMETRÍA CON EL HEURÍSTICO ───────────────────────────────
 *
 * Esto mira **título, descripción Y `Listing.phone`**. El heurístico mira sólo los dos
 * primeros, y la diferencia es la definición de cada uno:
 *
 *   · un número marcado lo está **esté donde esté** — también en su campo legítimo;
 *   · un número en su propio campo **no esquiva nada**, así que el heurístico que persigue
 *     evasión no tiene nada que decir ahí. Si lo mirara, avisaría de que el vendedor usó el
 *     canal correcto.
 *
 * ─── LA LISTA SE GUARDA TAL COMO SE ESCRIBE ──────────────────────────────────────────
 *
 * Se canoniza AL COMPARAR, no al guardar, y es la lección de la ráfaga C: `rule` tiene que
 * ser reconocible para quien escribió la regla. Además, guardar sólo lo canonizable obligaría
 * a descartar en silencio lo que no lo sea — y entonces no habría nada que marcar como inerte
 * en la pantalla de ajustes, que es justo el aviso que evita una lista que no filtra.
 */
@Injectable()
export class PhoneListDetector implements Detector {
  readonly id = 'PHONE_LIST' as const;

  constructor(private readonly prisma: PrismaService) {}

  async scan(text: DetectableText): Promise<Detection[]> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: FLAGGED_PHONES_SETTING },
    });

    const crudos = setting?.value as string[] | null | undefined;
    if (!crudos?.length) return [];

    // La lista, canonizada UNA vez por pasada. Se conserva la forma original de cada entrada
    // para poder devolverla como `rule`: quien lea el aviso tiene que reconocer su regla.
    const marcados = new Map<string, string>();
    for (const original of crudos) {
      const canonico = normalizarTelefono(original);
      // Una entrada que no es un teléfono español no casará nunca. Se descarta aquí en
      // silencio y la pantalla de ajustes la señala, molde de las entradas inertes de la
      // lista de palabras (ráfaga C).
      if (canonico) marcados.set(canonico, original);
    }
    if (marcados.size === 0) return [];

    const detections: Detection[] = [];

    // LOS DOS CAMPOS DE TEXTO: se reconoce con el patrón compartido y se canoniza lo
    // encontrado, para que `654 123 456` en el anuncio case con `+34654123456` en la lista.
    for (const [field, valor] of [
      ['TITLE', text.title],
      ['DESCRIPTION', text.description],
    ] as const) {
      for (const m of valor.matchAll(esPhonePattern())) {
        const canonico = normalizarTelefono(m[0]);
        const original = canonico && marcados.get(canonico);
        if (original) {
          detections.push({ detector: this.id, field, match: m[0], rule: original });
        }
      }
    }

    // Y EL CAMPO `phone`, que el heurístico NO mira (ver la cabecera). Aquí no hace falta
    // reconocer nada: el campo entero ES el teléfono, sólo hay que canonizarlo.
    const canonicoDelCampo = normalizarTelefono(text.phone);
    const originalDelCampo = canonicoDelCampo && marcados.get(canonicoDelCampo);
    if (originalDelCampo) {
      detections.push({
        detector: this.id,
        field: 'PHONE',
        match: text.phone as string,
        rule: originalDelCampo,
      });
    }

    return detections;
  }
}
