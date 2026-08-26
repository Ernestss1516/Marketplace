import { Logger } from '@nestjs/common';
import * as JSZip from 'jszip';
import { FicheroExportado } from './data-export.collector';

/**
 * BORRADO DE CUENTAS C6 — ARMAR EL ZIP (§7.1).
 *
 * ── POR QUÉ UN ZIP Y NO UN JSON ─────────────────────────────────────────────
 *
 * Porque un JSON no puede llevar **las facturas en PDF**, que son la parte de la
 * exportación con valor práctico real. Y sus claves son privadas
 * (`Invoice.pdfKey`), así que un JSON con enlaces sería un JSON con enlaces que
 * no abren — la peor de las dos opciones: parece completo y no lo es.
 *
 * ── UN FICHERO QUE NO SE DEJA BAJAR NO TUMBA LA EXPORTACIÓN ─────────────────
 *
 * Mismo criterio, y casi las mismas palabras, que `MediaCleanupProcessor`: si una
 * foto de hace dos años ya no está en el bucket, el usuario debe recibir igualmente
 * su ZIP con las otras cuarenta cosas. Lo que NO se hace es callarlo: cada ausencia
 * se anota en `LEEME.txt`, para que quien abra el ZIP sepa que faltó algo y no
 * crea que nunca existió.
 *
 * Lo estructurado, en cambio, es innegociable: `datos.json` va siempre, y si eso
 * fallara el trabajo entero debe fallar y reintentarse.
 */

/** Qué hay que hacer para traer un fichero del bucket. Se inyecta para que este
 *  fichero no dependa de R2 y los tests puedan armar un ZIP sin bucket. */
export type DescargarFichero = (key: string) => Promise<Buffer>;

export interface ZipConstruido {
  buffer: Buffer;
  /** Cuántos ficheros no se pudieron incluir. Informativo, no un fallo. */
  ficherosOmitidos: number;
}

const logger = new Logger('DataExportZip');

export async function construirZip(
  datos: Record<string, unknown>,
  ficheros: FicheroExportado[],
  descargar: DescargarFichero,
): Promise<ZipConstruido> {
  const zip = new JSZip();

  // `null, 2`: esto lo abre una persona, no un parser. Un JSON de una sola línea
  // con la vida entera de alguien es ilegible, y el objetivo del derecho de acceso
  // es que se pueda LEER.
  zip.file('datos.json', JSON.stringify(datos, null, 2));

  const omitidos: string[] = [];
  // Secuencial y no `Promise.all`: son descargas de R2 y pueden ser cientos. Un
  // vendedor con doscientos anuncios abriría doscientas conexiones a la vez y se
  // llevaría por delante el resto de la cola.
  for (const fichero of ficheros) {
    try {
      const buffer = await descargar(fichero.key);
      zip.file(fichero.ruta, buffer);
    } catch (err) {
      omitidos.push(fichero.ruta);
      logger.warn(`No se pudo incluir ${fichero.ruta} (${fichero.key}): ${String(err)}`);
    }
  }

  zip.file('LEEME.txt', leeme(datos, omitidos));

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return { buffer, ficherosOmitidos: omitidos.length };
}

/**
 * EL LÉEME, EN ESPAÑOL Y SIN JERGA.
 *
 * No es decoración: un ZIP con `datos.json` dentro y nada más obliga a la persona
 * a adivinar qué es cada clave, y la mitad de este derecho es **entender** lo que
 * te llevas. Aquí se dice qué contiene cada sección, qué NO contiene y por qué.
 */
function leeme(datos: Record<string, unknown>, omitidos: string[]): string {
  const seccion = (clave: string): number => {
    const v = datos[clave];
    if (Array.isArray(v)) return v.length;
    return v ? 1 : 0;
  };

  const lineas = [
    'EXPORTACIÓN DE TUS DATOS',
    '========================',
    '',
    `Generada el ${new Date().toLocaleString('es-ES')}.`,
    '',
    'QUÉ HAY EN ESTE ARCHIVO',
    '-----------------------',
    '',
    '  datos.json   Todo lo que has generado en la plataforma, en formato de texto.',
    '               Se puede abrir con cualquier editor de texto o visor de JSON.',
    '  ficheros/    Los archivos: tu foto de perfil, las fotos de tus anuncios,',
    '               tus facturas en PDF y los adjuntos de tus conversaciones con',
    '               soporte.',
    '',
    'LAS SECCIONES DE datos.json',
    '---------------------------',
    '',
    `  perfil                  Tus datos de cuenta (sin la contraseña, que no se guarda`,
    '                          en claro en ninguna parte).',
    '  datosFiscales           Los datos con los que se emiten tus facturas.',
    `  anuncios                Tus ${seccion('anuncios')} anuncio(s), con sus fotos, atributos y estadísticas.`,
    `  conversaciones          Tus ${seccion('conversaciones')} conversación(es) con otros usuarios, completas.`,
    '  valoracionesEmitidas    Las que has escrito tú.',
    '  valoracionesRecibidas   Las que otros han escrito sobre ti.',
    '  tratos                  Las operaciones cerradas, como vendedor y como comprador.',
    '  tickets                 Tus conversaciones con el equipo de soporte.',
    `  facturas                Tus ${seccion('facturas')} factura(s). Los PDF están en ficheros/facturas/.`,
    '  transacciones           Tus pagos.',
    '  suscripciones           Tus suscripciones y sus periodos.',
    '  entitlements            Las ventajas que has tenido activas (Pro, destacados...).',
    '  monedero                Tu saldo de créditos y de bumps, con todos los movimientos.',
    '  canjesDeCupon           Los cupones que has usado.',
    '  favoritos               Los anuncios que has guardado.',
    '  alertas                 Tus búsquedas guardadas.',
    '  notificaciones          Los avisos que has recibido.',
    '  proveedoresVinculados   Las cuentas externas con las que puedes entrar (Google...).',
    '  denunciasEmitidas       Las denuncias que has puesto tú.',
    '  denunciasRecibidas      Las denuncias que se han puesto sobre ti.',
    '',
    'QUÉ NO ESTÁ AQUÍ, Y POR QUÉ',
    '---------------------------',
    '',
    '  · Tu contraseña. No se guarda en claro en ningún sitio, ni siquiera para',
    '    nosotros: sólo existe una huella que no se puede deshacer.',
    '',
    '  · Quién te denunció. En "denunciasRecibidas" verás el motivo, la fecha y el',
    '    estado de cada denuncia, pero no el nombre de quien la puso. Ese dato es de',
    '    otra persona, y conocerlo permitiría tomar represalias contra ella.',
    '',
    '  · Las notas internas del equipo. En tus conversaciones con soporte están',
    '    todos los mensajes que has visto en la web, y ninguno más: las anotaciones',
    '    que el equipo se escribe entre sí no forman parte de tu conversación.',
    '',
    '  · El registro interno de seguridad. Es un rastro de la actividad de nuestro',
    '    equipo, no tuya, e incluye datos de otras personas.',
    '',
  ];

  if (omitidos.length > 0) {
    lineas.push(
      'ARCHIVOS QUE NO SE HAN PODIDO INCLUIR',
      '------------------------------------',
      '',
      `  ${omitidos.length} archivo(s) que aparecen en datos.json no se han podido recuperar`,
      '  del almacenamiento. Se listan abajo. El resto de la exportación es completa.',
      '',
      ...omitidos.map((r) => `  · ${r}`),
      '',
    );
  }

  lineas.push(
    'Este archivo deja de estar disponible para descarga pasado el plazo indicado',
    'en tu perfil. Guárdalo en un lugar seguro: contiene información personal.',
    '',
  );

  return lineas.join('\n');
}
