import { getCachedBranding } from '@/lib/api/branding';
import { resolveBrand } from '@/lib/brand';
import { BrandLogo } from '@/components/layout/BrandLogo';
import { AdminNav } from './components/AdminNav';
import { AdminMobileNav } from './components/AdminMobileNav';
import { AdminUserBar } from './components/AdminUserBar';
import { AdminSessionGuard } from './components/AdminSessionGuard';

/**
 * EL SHELL DEL BACKOFFICE.
 *
 * PUNTO 3 (A3) — EL DEFECTO QUE ARREGLA, y no era del backoffice: era el MISMO que
 * UXV.2 cerró en la zona de cuenta y que aquí se quedó sin arreglar. El layout tenía
 * literalmente esto:
 *
 *     <aside className="w-56 shrink-0 …">   ← ni un breakpoint
 *     <main  className="flex-1 p-8">        ← sin min-w-0
 *
 * Las dos mitades del mismo problema, las dos presentes:
 *
 *  - **el ancho**: en 375 px el aside se llevaba 224 px y el `p-8` otros 64, así que
 *    el contenido se quedaba con unos 87. `hidden md:block` lo saca de la fila por
 *    debajo de `md` —no ocupa columna, no la esconde a medias— y el acceso al menú lo
 *    da el drawer de `AdminMobileNav`;
 *  - **el desbordamiento**: un hijo de flex tiene `min-width: auto` y se niega a
 *    encogerse por debajo de su contenido. Sin `min-w-0`, las tablas de
 *    `/admin/anuncios` y `/admin/facturas` desbordan el contenedor y el `<body>`
 *    scrollea en horizontal. Es la otra cara del mismo defecto y por eso se arregla
 *    en el mismo sitio.
 *
 * El `<aside>` es sticky con scroll propio porque ahora son 22 secciones repartidas en
 * 6 grupos: sin eso, en una pantalla baja el final del menú queda fuera de alcance.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // LOGOS L2 — LA SEÑAL DE INSTANCIA (§8). El backoffice es cliente, pero ESTE layout
  // es un componente de servidor, así que la marca se resuelve aquí y baja ya hecha:
  // sin petición desde el navegador, sin estado «cargando» y sin un instante en que la
  // cabecera esté vacía. Se resuelve UNA vez y sirve a los dos sitios donde la marca
  // aparece —la cabecera de escritorio y el título del drawer de móvil—, que es lo que
  // impide que uno se quede con el texto viejo cuando el otro cambia.
  const logos = await getCachedBranding().catch(() => null);
  const marca = resolveBrand('backoffice', logos);

  return (
    <div className="flex min-h-screen flex-col" data-zona="backoffice">
      {/* ROLES R3 — no pinta nada: escucha el 401 de cualquier sección y lo
          convierte en re-login. Va en el shell para cubrir las 22 secciones —y
          las que vengan— sin tocar ninguna. Ver AdminSessionGuard. */}
      <AdminSessionGuard />
      {/* Top header */}
      <header className="flex h-14 items-center justify-between gap-3 border-b bg-background px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {/* El disparador del drawer, sólo por debajo de `md`. Va en la cabecera y no
              dentro del `<main>` como en la zona de cuenta: aquí SÍ hay cabecera. */}
          <AdminMobileNav marca={marca} />
          {/* En móvil el sitio de esta marca lo ocupa la sección actual, que orienta
              más: el drawer lleva la marca en su título. */}
          <div className="hidden md:block">
            <BrandLogo
              mark={marca}
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              imgClassName="h-7 w-auto max-w-[160px] object-contain"
            />
          </div>
        </div>
        <AdminUserBar />
      </header>

      <div className="flex flex-1">
        {/* Sidebar — `hidden md:block`: la mitad de A3 que arregla el ancho. */}
        <aside className="hidden w-56 shrink-0 border-r bg-muted/30 md:block">
          <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto p-4">
            <AdminNav />
          </div>
        </aside>

        {/* `min-w-0` es la otra mitad de A3 — ver la cabecera. */}
        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
