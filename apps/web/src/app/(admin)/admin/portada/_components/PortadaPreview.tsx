'use client';

import { useEffect, useState } from 'react';
import type { Category } from '@/types';
import type { HeroHeight, HomeBlock } from '@/types/home-blocks';
import { HomeHero } from '@/components/home/HomeHero';
import { HomeHeroBanda } from '@/components/home/HomeHeroBanda';
import { HomeBlockRenderer } from '@/components/home/HomeBlockRenderer';
import { getCategories } from '@/lib/api/categorias';

/**
 * Vista previa de la portada dentro del editor.
 *
 * OBLIGATORIA, no opcional (docs/diseno-portada.md §6): la portada no tiene
 * borrador/publicado, así que **guardar es publicar**. Sin previsualización, la
 * única forma de ver si la velocidad del rotativo es legible sería enseñársela
 * al mundo.
 *
 * Reusa EXACTAMENTE los mismos componentes que el sitio público —`HomeHero` y
 * `HomeBlockRenderer`—, que es lo que hace que el preview no pueda mentir. Es el
 * motivo por el que `HomeBlockRenderer` es síncrono: los bloques que necesiten
 * datos externos los reciben ya resueltos, y así el mismo componente sirve al
 * SSR y a este render de cliente (molde `BlockEditor.tsx` del blog, que hace lo
 * propio con `BlockRenderer`).
 *
 * El árbol de categorías se pide aquí, en cliente, porque en la página pública lo
 * carga el Server Component — mismo criterio que `ListingsBlockEditor` del blog.
 */
export function PortadaPreview({
  heroStaticTitle,
  heroRotatingOptions,
  heroRotationMs,
  heroSubtitle,
  heroEyebrow,
  heroHeight,
  blocks,
}: {
  heroStaticTitle: string;
  heroRotatingOptions: string[];
  heroRotationMs: number;
  heroSubtitle: string;
  heroEyebrow: string;
  heroHeight: HeroHeight;
  blocks: HomeBlock[];
}) {
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    getCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  // Las opciones vacías no se envían al guardar (el servicio las filtra), así
  // que el preview tampoco debe contarlas: con una vacía de por medio, la clase
  // de animación sería la de N+1 y la vista previa mentiría.
  const opciones = heroRotatingOptions.map((o) => o.trim()).filter(Boolean);

  // `key` derivada de lo que gobierna la animación: al cambiar el número de
  // palabras o la velocidad, el nodo se remonta y el ciclo ARRANCA DE CERO. Sin
  // esto, CSS reanudaría la animación a mitad y lo que se ve no correspondería a
  // lo configurado.
  const animKey = `${opciones.length}:${heroRotationMs}`;

  return (
    <div className="overflow-hidden rounded-md border" data-testid="portada-preview">
      <p className="border-b bg-muted/30 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Vista previa — así se ve la portada publicada
      </p>

      {/* ESCAPARATE C — EL MISMO COMPONENTE QUE LA PÁGINA, NO UNA COPIA DE SU MARCADO.
          Aquí había una reproducción a mano de la banda (`border-b bg-primary/5`,
          `py-10`, `max-w-4xl text-center`) con un comentario que decía «mismo envoltorio
          que (home)/page.tsx». Funcionó mientras la banda fue un fondo plano; con el
          ambiente y el patrón del modelo dentro, la copia habría enseñado una portada
          que no existe. Y este preview es obligatorio porque guardar ES publicar.

          Los bloques se quedan FUERA de la banda, igual que en la página: allí el hero
          es lo único que va dentro (§3.5 del diseño de portada). */}
      {/* ESCAPARATE D — EL PREVIEW ENSEÑA LA ALTURA ELEGIDA, TAMBIÉN «PANTALLA».
          Y sí, eso hace que el preview ocupe una pantalla entera dentro del editor. Es
          deliberado: lo que el admin necesita decidir es precisamente si su hero aguanta
          ese tamaño, y una versión encogida no responde a esa pregunta. El preview existe
          para no tener que publicar para verlo. */}
      <HomeHeroBanda altura={heroHeight}>
        <HomeHero
          key={animKey}
          config={{
            heroStaticTitle: heroStaticTitle.trim() || 'Sin título',
            heroRotatingOptions: opciones,
            heroRotationMs,
            heroSubtitle: heroSubtitle.trim() || null,
            heroEyebrow: heroEyebrow.trim() || null,
            heroHeight,
            blocks: [],
          }}
        />
      </HomeHeroBanda>

      <div className="px-4 py-10">
        <HomeBlockRenderer blocks={blocks} categories={categories} />
      </div>
    </div>
  );
}
