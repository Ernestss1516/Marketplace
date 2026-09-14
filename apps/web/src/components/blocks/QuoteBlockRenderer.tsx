import type { QuoteBlock } from '@/types/blocks';

export function QuoteBlockRenderer({ block }: { block: QuoteBlock }) {
  return (
    /* ESCAPARATE C-bis — LA CITA DEJA DE SER UN FILETE Y PASA A SER UNA PIEZA.
       Cuatro cambios, todos de clase — el `<blockquote>`, el `<p>` y el `<footer>` son
       exactamente los mismos nodos:

        · el filete pasa de `border-primary/40` a `--primary` MACIZO: una cita es una
          pausa en la lectura, y a 40 % de opacidad no se veía como tal;
        · gana superficie (`bg-muted`) y aire, así que ocupa sitio en vez de colgar del
          margen izquierdo;
        · las esquinas de la DERECHA se redondean y las de la izquierda no: el filete
          es el borde de la pieza, y redondearlo lo despegaría de ella;
        · el texto va en `--font-heading` y en el color del cuerpo, no en el atenuado.
          Una cita destacada que se pinta más floja que el párrafo que la rodea está
          diciendo lo contrario de lo que quiere decir — y en Cálido o Premium, donde
          esa familia es una serifa, se lee además como lo que es: una voz distinta. */
    <blockquote className="rounded-r-2xl border-l-4 border-primary bg-muted py-6 pl-6 pr-6 italic">
      <p className="font-heading text-xl leading-relaxed">&ldquo;{block.text}&rdquo;</p>
      {block.author && (
        <footer className="mt-3 text-sm not-italic text-muted-foreground">— {block.author}</footer>
      )}
    </blockquote>
  );
}
