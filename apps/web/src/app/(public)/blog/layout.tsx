import MainNav from '@/components/layout/MainNav';

// Declara el tipo de página de esta rama del árbol. Va en un LAYOUT y no en la
// página para que toda ruta que cuelgue de aquí herede la barra sin que nadie
// tenga que acordarse — un olvido en una página nueva sería silencioso.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    /**
     * E5 — LA ZONA BLOG.
     *
     * ES EL ÚNICO SITIO DONDE E5 AÑADE UN ELEMENTO AL DOM, y se hace notar: los otros
     * cuatro registros pusieron su `data-zona` en un contenedor que ya existía. Aquí
     * no había ninguno —el layout devolvía un fragmento— y una custom property
     * necesita un elemento del que colgar.
     *
     * `<div>` sin una sola clase: no crea contexto de formato ni margen, así que el
     * maquetado no se entera. Las capturas lo comprueban, que para eso están.
     *
     * NO HACE FALTA DECLARAR QUE EL BLOG HEREDA DEL PÚBLICO: este layout vive dentro
     * de `(public)`, así que el subárbol ya recibe todo lo de la base y aquí sólo se
     * redefine lo propio. La cascada hace la herencia sola.
     *
     * Y no lleva `esRutaDeBlog()`: la detección por segmento existe para quien tiene
     * que ADIVINAR la zona desde un `pathname` —la cabecera compartida, que es cliente
     * y se pinta igual en todas las rutas—. Aquí no hay nada que adivinar: el propio
     * árbol de rutas dice dónde estamos, y ninguna ruta hermana como `/blogueros`
     * puede colarse en este layout ni por accidente.
     */
    <div data-zona="blog">
      <MainNav pageType="BLOG" />
      {children}
    </div>
  );
}
