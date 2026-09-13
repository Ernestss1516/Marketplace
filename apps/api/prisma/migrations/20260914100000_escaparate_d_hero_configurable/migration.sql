-- ─────────────────────────────────────────────────────────────────────────────────────────
-- ESCAPARATE RÁFAGA D — EL HERO, CONFIGURABLE.
--
-- Ver docs/diseno-escaparate.md §5.5.
--
-- Dos campos propios del hero, que es donde viven: el hero NO es un bloque (§2.3 del
-- diseño de portada), así que su configuración son columnas y no claves dentro del Json
-- de `blocks`. Es la misma decisión que ya sostienen `heroStaticTitle` y sus tres
-- hermanas, y la que permite que ningún bloque conozca su índice.
--
-- ── LOS DEFAULTS SON LA PARTE IMPORTANTE DE ESTA MIGRACIÓN ──────────────────────────────
--
-- `heroHeight` nace en 'normal', que es EXACTAMENTE la altura que la banda tiene hoy, y
-- `heroEyebrow` nace nulo, que es «no hay rótulo». O sea: **al aplicar esto, ninguna
-- portada de ninguna instancia cambia de aspecto**. La pantalla completa no se enciende
-- con la migración; se enciende cuando un admin la elige.
--
-- Eso no es prudencia genérica: es la barrera con la que se mide esta ráfaga. Las 56
-- capturas de la batería visual tienen que seguir pasando después de aplicarla, y la de
-- la portada es una de ellas.
--
-- ── POR QUÉ `heroHeight` ES TEXTO Y NO UN TIPO ENUM ────────────────────────────────────
--
-- Porque es una preferencia de presentación, no un estado de dominio. El juego de valores
-- ('normal' | 'alto' | 'pantalla') vive de verdad en el mapa de clases del frontend —que
-- necesita clases literales porque Tailwind purga lo que no ve escrito— y lo valida el DTO
-- con `@IsIn`. Un tipo enum en la base costaría una migración por cada altura nueva para
-- garantizar lo que ya está garantizado antes de escribir.
--
-- El tercer interruptor de la ráfaga —montar el buscador sobre la banda— NO está aquí: es
-- un campo del bloque `search`, y los bloques viven en un Json. Va donde va la intención:
-- la declara el bloque, no el hero, que es lo que evita que el hero tenga que saber qué
-- bloque viene detrás.
-- ─────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE "HomepageConfig"
  ADD COLUMN "heroEyebrow" TEXT,
  ADD COLUMN "heroHeight" TEXT NOT NULL DEFAULT 'normal';
