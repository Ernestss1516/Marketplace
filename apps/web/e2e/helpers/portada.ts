import { expect, type APIRequestContext } from '@playwright/test';
import { adminApiToken, authedPatch } from './api';

/**
 * La configuración de portada que siembra `apps/api/prisma/seed-test.ts`.
 *
 * FUENTE ÚNICA a propósito. Los specs de portada MUTAN una fila estática
 * compartida con toda la batería, así que tienen que dejarla como la
 * encontraron. Cuando cada uno llevaba su propia copia, la copia se quedó atrás
 * en cuanto la semilla creció (RP.4 le añadió `steps` y `grid`): los specs
 * "restauraban" una portada a la que le faltaban dos bloques, y lo que corriese
 * después medía una página distinta de la que el seed prometía.
 *
 * Si esto cambia, cambia en seed-test.ts y aquí a la vez.
 */
export const PORTADA_SEMILLA = {
  heroStaticTitle: 'Compra y vende de segunda mano',
  heroRotatingOptions: [] as string[],
  heroRotationMs: 3000,
  blocks: [
    {
      id: 'seed-search',
      type: 'search',
      eyebrow: 'Miles de anuncios cerca de ti',
      showPopularCategories: true,
      popularCount: 6,
    },
    {
      id: 'seed-cta-publicar',
      type: 'cta',
      label: '¿Tienes algo que vender? Publica gratis',
      href: '/publicar',
      style: 'outline',
    },
    {
      id: 'seed-listings',
      type: 'listings',
      title: 'Recién publicados',
      limit: 8,
      sort: 'recent',
      showAllLink: true,
    },
    {
      id: 'seed-steps',
      type: 'steps',
      title: 'Cómo funciona',
      columns: [
        {
          audienceTitle: 'Para compradores',
          icon: 'search',
          steps: [
            { title: 'Busca lo que necesitas', description: 'Usa el buscador o explora por categorías hasta encontrarlo.' },
            { title: 'Contacta con el vendedor', description: 'Pregunta tus dudas por mensajería interna, sin dar tu teléfono.' },
            { title: 'Queda y valora', description: 'Cierra el trato en persona y deja tu opinión al vendedor.' },
          ],
          cta: { label: 'Buscar ahora →', href: '/busqueda' },
        },
        {
          audienceTitle: 'Para vendedores',
          icon: 'upload',
          steps: [
            { title: 'Publica gratis', description: 'Sube fotos y describe tu artículo en un par de minutos.' },
            { title: 'Gestiona tus mensajes', description: 'Responde a los interesados desde tu bandeja de mensajes.' },
            { title: 'Destaca tu anuncio (opcional)', description: 'Dale más visibilidad si quieres vender más rápido.' },
          ],
          cta: { label: 'Publicar anuncio →', href: '/publicar' },
        },
      ],
    },
    {
      id: 'seed-trust',
      type: 'grid',
      columns: 4,
      items: [
        { media: { kind: 'icon', name: 'shield-check' }, title: 'Anuncios moderados' },
        { media: { kind: 'icon', name: 'message-circle' }, title: 'Mensajería sin compartir tu teléfono' },
        { media: { kind: 'icon', name: 'star' }, title: 'Valoraciones entre usuarios' },
        { media: { kind: 'icon', name: 'sparkles' }, title: 'Publicar es gratis' },
      ],
    },
  ] as unknown[],
};

/** Deja la portada exactamente como la sembró el seed. */
export async function restaurarPortada(request: APIRequestContext): Promise<void> {
  const res = await authedPatch(request, '/admin/homepage', adminApiToken(), PORTADA_SEMILLA);
  expect(res.status(), await res.text()).toBe(200);
}
