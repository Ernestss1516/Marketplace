import {
  Heart,
  MessageCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Tag,
  ThumbsUp,
  Truck,
  Upload,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { HomeIconName } from '@/types/home-blocks';

/**
 * Mapa nombre→componente de la allowlist de iconos.
 *
 * ESTÁTICO Y EXHAUSTIVO, y las dos cosas importan:
 *  - **Estático**: cada icono se importa por su nombre, así que el empaquetador
 *    incluye exactamente estos doce. Resolver el nombre en tiempo de ejecución
 *    (`(Icons as any)[name]`) rompería el tree-shaking y arrastraría
 *    `lucide-react` entero al bundle de la portada — el motivo por el que la
 *    lista es cerrada (docs/diseno-portada.md §4.3).
 *  - **Exhaustivo**: el `Record<HomeIconName, …>` deja de compilar si se añade un
 *    nombre a la lista sin su icono, igual que los `switch` del motor.
 */
export const HOME_ICONS: Record<HomeIconName, LucideIcon> = {
  'shield-check': ShieldCheck,
  'message-circle': MessageCircle,
  star: Star,
  sparkles: Sparkles,
  search: Search,
  upload: Upload,
  heart: Heart,
  tag: Tag,
  truck: Truck,
  wallet: Wallet,
  users: Users,
  'thumbs-up': ThumbsUp,
};

/** Etiquetas en español para el selector del editor. */
export const HOME_ICON_LABELS: Record<HomeIconName, string> = {
  'shield-check': 'Escudo (seguridad)',
  'message-circle': 'Mensaje',
  star: 'Estrella',
  sparkles: 'Destellos',
  search: 'Lupa',
  upload: 'Subir',
  heart: 'Corazón',
  tag: 'Etiqueta',
  truck: 'Envío',
  wallet: 'Cartera',
  users: 'Personas',
  'thumbs-up': 'Pulgar arriba',
};
