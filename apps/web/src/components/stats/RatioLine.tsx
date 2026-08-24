import type { ReactNode } from 'react';

/**
 * ESTADÍSTICAS — EL TRATAMIENTO DE MUESTRA PEQUEÑA, UNO SOLO PARA LOS DOS RATIOS.
 *
 * Nació dentro de `CtrLine` (A2) y sale de ahí ahora porque el panel tenía DOS ratios y
 * sólo uno era honesto: el CTR ya callaba con pocas apariciones mientras el ratio de me
 * gusta, tres centímetros más arriba, seguía afirmando «un 100% de quienes lo ven lo
 * guardan» sobre una única visita.
 *
 * Lo que este componente decide —y por tanto lo que ya no puede divergir entre un ratio y
 * otro— es:
 *
 *  · **Cuándo NO hay porcentaje.** Con `value === null` (lo decide el backend, ver
 *    `sample-threshold.ts`) no se enseña una cifra: se dice cuánta muestra falta. Un
 *    número rotundo sobre ruido no es «un dato aproximado», es una afirmación falsa.
 *  · **Cómo se formatea.** `Intl` con un decimal: `Math.round(v * 100)` convertía un 0,4%
 *    real en un «0 %» que se lee como «no le interesa a nadie».
 *  · **Que los conteos acompañen siempre al porcentaje**, para que quien lo lee pueda
 *    juzgarlo por su cuenta en vez de fiarse.
 *
 * Lo que NO decide, y por eso cada ratio conserva su propio componente delgado encima: las
 * PALABRAS. «De cada tantas veces que apareces» y «de quienes lo ven» son frases
 * distintas, y unificarlas habría producido una redacción genérica peor que las dos.
 */

/** Un cociente con el tamaño de su muestra, tal y como lo sirve el backend. */
export interface RatioSample {
  /** `null` = la muestra no da para publicarlo. No es un cero ni un error. */
  value: number | null;
  /** El numerador (visitas, me gusta…). Acompaña al porcentaje. */
  count: number;
  /** El denominador: de SU tamaño depende que el número signifique algo. */
  sample: number;
  /** Mínimo de muestra exigido. */
  minSample: number;
}

interface Props {
  ratio?: RatioSample;
  testId?: string;
  /** Nombre del denominador, para la frase de muestra pequeña y los conteos. */
  sampleNoun: { one: string; many: string };
  /** Nombre del numerador, para los conteos. */
  countNoun: { one: string; many: string };
  /** Qué es lo que aún no se puede calcular — «qué parte de tus apariciones acaba en visita». */
  whatIsMissing: string;
  /** La frase del caso normal. Recibe el porcentaje ya formateado. */
  sentence: (percent: ReactNode) => ReactNode;
  /** Caso `value > 1`, si el ratio puede pasar de 1 (el CTR sí; el de me gusta, no). */
  overOne?: (counts: ReactNode) => ReactNode;
}

const plural = (n: number, noun: { one: string; many: string }) =>
  `${n} ${n === 1 ? noun.one : noun.many}`;

function formatPercent(value: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 1 }).format(
    value,
  );
}

export function RatioLine({
  ratio,
  testId,
  sampleNoun,
  countNoun,
  whatIsMissing,
  sentence,
  overOne,
}: Props) {
  if (!ratio) return null;

  const counts = (
    <span className="text-muted-foreground">
      {' '}
      ({plural(ratio.count, countNoun)} sobre {plural(ratio.sample, sampleNoun)})
    </span>
  );

  if (ratio.value === null) {
    return (
      <p data-testid={testId ? `${testId}-insufficient` : undefined}>
        Todavía no se puede calcular {whatIsMissing}: con pocas {sampleNoun.many} el porcentaje
        engaña más que informa. Hacen falta al menos{' '}
        <strong>{ratio.minSample}</strong> y llevas <strong>{ratio.sample}</strong>.
      </p>
    );
  }

  if (ratio.value > 1 && overOne) {
    return <p data-testid={testId ? `${testId}-value` : undefined}>{overOne(counts)}</p>;
  }

  return (
    <p data-testid={testId ? `${testId}-value` : undefined}>
      {sentence(<strong>{formatPercent(ratio.value)}</strong>)}
      {counts}.
    </p>
  );
}
