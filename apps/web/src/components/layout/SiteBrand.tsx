'use client';

import { usePathname } from 'next/navigation';
import type { BrandingLogos } from '@/lib/api/branding';
import { esRutaDeBlog, resolveBrand } from '@/lib/brand';
import { BrandLogo } from './BrandLogo';

/**
 * TRES LOGOS L2 — LA MARCA DE LA CABECERA PÚBLICA, que en el blog es OTRA (§11.2).
 *
 * ── EL PROBLEMA, VERIFICADO ──────────────────────────────────────────────────
 *
 * El blog **no tiene cabecera propia**: `(public)/blog/layout.tsx` sólo monta
 * `<MainNav pageType="BLOG" />`, y la cabecera que ve el lector es la pública, montada
 * un nivel más arriba en `(public)/layout.tsx`. Un layout hijo no puede cambiarle las
 * props a la cabecera de su padre, así que el blog no podía pedir su propio logo.
 *
 * ── OPCIÓN A, Y POR QUÉ NO CONTRADICE LA REGLA QUE PARECE CONTRADECIR ────────
 *
 * `MainNav` declara su zona por prop (`pageType`) y el diseño del nav dejó escrito que
 * la zona NO se deriva del pathname. **El motivo de aquella regla era proteger el
 * ISR**: derivarla en el servidor obligaba a leer `headers()` en el layout y volvía
 * dinámico todo `(public)`.
 *
 * Aquí el hook es de CLIENTE. El layout y la cabecera siguen siendo componentes de
 * servidor, el HTML prerenderizado sale ya con el logo correcto —la ruta se conoce al
 * renderizar— y el ISR no se toca. Se rompe la forma de la regla, no su razón. La
 * alternativa (opción B: partir `(public)` en un grupo de rutas y mover nueve
 * directorios de páginas) hacía lo mismo con un diff enorme para poner un logo.
 *
 * Coste real: este componente y las dos URLs que recibe viajan al cliente. Es lo único
 * que hidrata de la cabecera.
 */
export function SiteBrand({ logos }: { logos: BrandingLogos | null }) {
  const pathname = usePathname();
  const zone = esRutaDeBlog(pathname) ? 'blog' : 'public';

  return (
    <BrandLogo
      mark={resolveBrand(zone, logos)}
      className="text-xl font-bold tracking-tight"
      imgClassName="h-8 w-auto max-w-[180px] object-contain"
    />
  );
}
