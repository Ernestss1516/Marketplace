// Feature teléfono en anuncios — decisiones confirmadas con el usuario:
// formato permisivo (admite prefijos internacionales, espacios, guiones y
// paréntesis) pero acotado en longitud y caracteres válidos — evita basura
// libre en un campo que se PUBLICA y se usa en un enlace tel:. Cadena vacía
// admitida aparte: es como el usuario vacía el campo para no publicar
// teléfono (mismo convenio que postalCode — se guarda '', no null).
export const LISTING_PHONE_REGEX = /^$|^[0-9+\-\s()]{6,20}$/;

// Límites del endpoint GET /listings/:id/phone — nadie legítimo necesita
// revelar 30+ teléfonos en una hora; eso es cosecha. Por-IP más laxo que
// por-usuario porque una IP puede ser compartida (oficina, NAT).
export const PHONE_REVEAL_LIMIT_USER_PER_HOUR = 30;
export const PHONE_REVEAL_LIMIT_IP_PER_HOUR = 60;
export const PHONE_REVEAL_WINDOW_SECONDS = 3600;
