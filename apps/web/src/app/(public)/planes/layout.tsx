import MainNav from '@/components/layout/MainNav';
import { VolverACuenta } from './_components/VolverACuenta';

// Declara el tipo de página de esta rama del árbol. Va en un LAYOUT y no en la
// página para que toda ruta que cuelgue de aquí herede la barra sin que nadie
// tenga que acordarse — un olvido en una página nueva sería silencioso.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MainNav pageType="PLANES" />
      {/* UXV.2 (M3) — va en el LAYOUT por lo mismo que MainNav: así lo heredan también
          /planes/exito y /planes/cancelado, que son donde acaba el viaje y donde quedarse
          varado fuera del shell de cuenta molesta más. */}
      <VolverACuenta />
      {children}
    </>
  );
}
