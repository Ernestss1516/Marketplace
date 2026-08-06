import MainNav from '@/components/layout/MainNav';

// Declara el tipo de página de esta rama del árbol. Va en un LAYOUT y no en la
// página para que toda ruta que cuelgue de aquí herede la barra sin que nadie
// tenga que acordarse — un olvido en una página nueva sería silencioso.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MainNav pageType="PAGINA_CMS" />
      {children}
    </>
  );
}
