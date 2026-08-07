/**
 * ALLOWLIST CERRADA de iconos para los bloques de portada.
 *
 * POR QUÉ CERRADA Y NO UN NOMBRE LIBRE DE LUCIDE (docs/diseno-portada.md §4.3):
 * un nombre arbitrario obliga al frontend a resolver el icono en tiempo de
 * ejecución, y eso rompe el tree-shaking de `lucide-react` — arrastraría la
 * librería ENTERA al bundle de la ruta más visitada del sitio. Con esta lista, el
 * renderizador tiene un `Record` estático de doce entradas y el empaquetador solo
 * incluye esas doce.
 *
 * El frontend declara el mismo conjunto en components/home/home-icons.tsx, que es
 * donde vive el mapa nombre→componente. Los dos ficheros tienen que crecer a la
 * vez; el e2e comprueba que un nombre fuera de lista se rechaza con 400.
 *
 * Elegidos por lo que la portada necesita hoy —las cuatro señales de confianza
 * (`shield-check`, `message-circle`, `star`, `sparkles`) y las dos audiencias de
 * "Cómo funciona" (`search`, `upload`)— más media docena del mismo registro para
 * que el admin tenga de dónde elegir sin pedir despliegue.
 */
export const HOME_ICON_NAMES = [
  'shield-check',
  'message-circle',
  'star',
  'sparkles',
  'search',
  'upload',
  'heart',
  'tag',
  'truck',
  'wallet',
  'users',
  'thumbs-up',
] as const;

export type HomeIconName = (typeof HOME_ICON_NAMES)[number];
