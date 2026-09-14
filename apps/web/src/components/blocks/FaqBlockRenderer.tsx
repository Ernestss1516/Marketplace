import type { FaqBlock } from '@/types/blocks';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { MarkdownBody } from '@/components/blog/MarkdownBody';

// answer pasa por la misma tubería MarkdownBody que el bloque de texto —
// misma sanitización, sin caso especial.
export function FaqBlockRenderer({ block }: { block: FaqBlock }) {
  return (
    <div>
      {block.title && <h2 className="mb-4 text-xl font-semibold">{block.title}</h2>}
      {/* ESCAPARATE C-bis — EL ACORDEÓN, DENTRO DE UNA CAJA.
          Antes eran filas sueltas sobre el lienzo, sin nada que dijera dónde empieza y
          dónde acaba el bloque.

          ⚠ LA CAJA VA EN EL PROPIO `<Accordion>`, NO EN UN `<div>` ALREDEDOR, y la
          diferencia importa: el Root de Radix acepta `className`, así que esto es un
          cambio de CLASES y **no añade un solo nodo al árbol**. Envolverlo habría sido
          estructura nueva —legítima, si fuera común a los cinco modelos, pero
          innecesaria— y aquí el criterio de la ráfaga es revestir sin tocar el DOM.

          `overflow-hidden` para que la primera y la última fila respeten la curva del
          borde a 16 px, donde ya se nota. */}
      <Accordion
        type="single"
        collapsible
        className="overflow-hidden rounded-2xl border bg-card px-4"
      >
        {block.items.map((item, idx) => (
          <AccordionItem key={idx} value={`item-${idx}`}>
            <AccordionTrigger className="text-left">{item.question}</AccordionTrigger>
            <AccordionContent>
              <MarkdownBody body={item.answer} className="prose prose-neutral max-w-none text-sm dark:prose-invert" />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
