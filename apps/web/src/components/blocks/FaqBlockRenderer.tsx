import type { FaqBlock } from '@/types/blocks';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { MarkdownBody } from '@/components/blog/MarkdownBody';

// answer pasa por la misma tubería MarkdownBody que el bloque de texto —
// misma sanitización, sin caso especial.
export function FaqBlockRenderer({ block }: { block: FaqBlock }) {
  return (
    <div>
      {block.title && <h2 className="mb-4 text-xl font-semibold">{block.title}</h2>}
      <Accordion type="single" collapsible>
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
