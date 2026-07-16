// Límites de GET /users/search — buscador de usuarios para elegir comprador/
// cliente al cerrar un trato (ciclo de vida RÁFAGA 1, ver Deal en schema.prisma).
// Nadie legítimo necesita muchas búsquedas por hora; un límite bajo desalienta
// usarlo como scraper de la base de usuarios. Mismo patrón que
// listing-phone.constants.ts (PHONE_REVEAL_*).
export const USER_SEARCH_LIMIT_PER_HOUR = 30;
export const USER_SEARCH_WINDOW_SECONDS = 3600;
