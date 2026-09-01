import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { R2Service } from '../../infra/r2/r2.service';
import {
  isPendingKey,
  keyFromPublicUrl,
  ownUrlsDeep,
  pendingPrefix,
  replaceOwnUrlsDeep,
} from '../../infra/r2/media-keys';

/** El resultado de un pase: el valor ya reescrito y lo que hay que deshacer o tirar. */
export interface PromotedMedia<T> {
  /** El valor listo para persistir. **No contiene ninguna URL bajo `tmp/`.** */
  value: T;
  /** Claves que este pase ha creado en el prefijo definitivo. Para compensar. */
  copiedKeys: string[];
  /** Los temporales que ya sobran. Para borrar por cortesía DESPUÉS de escribir. */
  temporaryKeys: string[];
}

/**
 * VÍDEO DE BLOQUE V1 — «LO QUE NUNCA SE GUARDA»: sacar de `tmp/` lo que por fin tiene dueño.
 *
 * EL GEMELO DE `MediaCleanupService`, y por eso vive en el mismo módulo neutral que los tres
 * llamantes ya importaban. Aquel cierra la fuga de **lo que se suelta** (comparando el antes
 * con el después y encolando la diferencia); éste cierra la de **lo que nunca llega a
 * guardarse**, que no tiene «antes» donde mirar porque el huérfano nace de una confirmación
 * que puede no llegar.
 *
 * EL PATRÓN ES EL DEL AVATAR DE H2, TAL CUAL (`UsersService.confirmarAvatar`): el fichero
 * nace bajo `<raíz>/tmp/<dueño>/`, y **guardar la fila es lo que lo confirma**. La única
 * diferencia es la forma del dato: el avatar es UN campo y aquí es un `Json` con N ficheros
 * posibles, así que en vez de una copia hay un recorrido — y el recorrido ya existía
 * (`ownUrlsDeep`, escrito para H1 precisamente para no enumerar campos).
 *
 * POR QUÉ NO SE PROMOCIONA EN EL CONFIRM DE LA SUBIDA: ver `BlockMediaService.confirmUpload`.
 * En dos palabras, porque entre confirmar y guardar puede no haber nada, y lo que se sacara
 * de `tmp/` sin que una fila lo referencie es una huérfana que la regla de ciclo de vida ya
 * no puede recoger.
 */
@Injectable()
export class PendingMediaService {
  private readonly logger = new Logger(PendingMediaService.name);

  constructor(private readonly r2: R2Service) {}

  /**
   * Promociona todo lo que en `value` siga esperando bajo `<root>/tmp/<ownerId>/` y
   * devuelve el valor con las URLs ya definitivas.
   *
   * SE LLAMA **ANTES** DE ESCRIBIR, al revés que `purgeReleased` — y las dos cosas son
   * necesarias en ese orden: la escritura necesita las URLs definitivas, y la comprobación
   * de dueño de la limpieza necesita el estado nuevo ya escrito.
   *
   * Y LOS DOS PASES NO SE PISAN, por el mismo argumento que H2 dio para el avatar: una URL
   * temporal **nunca llega a persistirse**, así que jamás entra en el diff de
   * `releasedUrls`, que compara siempre contra lo ya definitivo.
   *
   * ES FAIL-CLOSED (barrera B-2). Si algo no se puede promocionar, esto LANZA y el guardado
   * entero se cae. Es deliberado y es lo contrario del criterio de la limpieza —donde ante
   * la duda no se borra y nunca se rompe nada—: aquí, seguir adelante significaría persistir
   * una URL bajo `tmp/`, y la regla de ciclo de vida borraría en un día un vídeo **publicado
   * y vivo**. Un guardado que falla con un mensaje accionable es infinitamente preferible a
   * un artículo que se queda sin su vídeo el martes sin que nadie sepa por qué.
   *
   * NO HACE NI UNA LLAMADA A R2 EN EL CASO NORMAL: un guardado que no toca media no tiene
   * URLs temporales y sale por el atajo de la línea siguiente. El coste sólo aparece cuando
   * de verdad hay algo que mover.
   */
  async promote<T>(params: { value: T; ownerId: string; root: string }): Promise<PromotedMedia<T>> {
    const { value, ownerId, root } = params;
    const prefijoPublico = this.r2.getPublicUrl('');

    const pendientes = ownUrlsDeep(value, prefijoPublico).filter((url) => {
      const clave = keyFromPublicUrl(url, prefijoPublico);
      return clave !== null && isPendingKey(clave, root);
    });
    if (pendientes.length === 0) {
      return { value, copiedKeys: [], temporaryKeys: [] };
    }

    const prefijoTemporal = pendingPrefix(root, ownerId);
    const mapa = new Map<string, string>();
    const copiedKeys: string[] = [];
    const temporaryKeys: string[] = [];

    try {
      for (const url of pendientes) {
        // `keyFromPublicUrl` ya devolvió no-null en el filtro de arriba.
        const claveTemporal = keyFromPublicUrl(url, prefijoPublico)!;

        // LA SUBIDA ES SUYA. El `<ownerId>` va dentro de la clave justamente para esto, y
        // hace falta: `@IsOwnStorageUrl` comprueba el dominio, no el prefijo, así que sin
        // esto cualquier EDITOR podría pegar en su bloque la clave temporal de otro y
        // hacerla suya al guardar.
        if (!claveTemporal.startsWith(prefijoTemporal)) {
          throw new ForbiddenException('Ese fichero subido no es tuyo.');
        }

        // El destino es la misma clave SIN el `tmp/<dueño>/`. Que la raíz no cambie es lo
        // que hace que la regla de ciclo de vida nazca sin poder tocar nada ya guardado.
        const claveDefinitiva = `${root}/${claveTemporal.slice(prefijoTemporal.length)}`;

        if (await this.r2.head(claveTemporal)) {
          await this.r2.copy(claveTemporal, claveDefinitiva);
          copiedKeys.push(claveDefinitiva);
          temporaryKeys.push(claveTemporal);
        } else if (!(await this.r2.head(claveDefinitiva))) {
          // Ni en el temporal ni en el destino. O nunca se subió, o la regla de ciclo de
          // vida ya lo caducó —una sesión de edición que duró más de un día—. Las dos se
          // arreglan igual: volver a subirlo. Lo que NO se puede es guardar el enlace.
          throw new BadRequestException(
            'Uno de los ficheros subidos ya no está disponible. Vuelve a subirlo antes de guardar.',
          );
        }
        // (Si no estaba el temporal pero sí el destino, este mismo valor ya se promocionó
        // en un guardado anterior: idempotente, no se copia ni se borra nada.)

        mapa.set(url, this.r2.getPublicUrl(claveDefinitiva));
      }
    } catch (err) {
      // Lo copiado antes del fallo no lo va a referenciar nadie, y está FUERA de `tmp/`,
      // donde la regla no llega. Se deshace aquí o sería una huérfana permanente.
      await this.rollback(copiedKeys);
      throw err;
    }

    const promocionado = replaceOwnUrlsDeep(value, prefijoPublico, mapa) as T;

    // EL CINTURÓN, y no es celo: es la condición exacta que hace segura la regla de ciclo
    // de vida. Si por lo que sea quedara una URL temporal en lo que está a punto de
    // escribirse —un recorrido que no llegó, un mapa incompleto—, el fallo sería invisible
    // durante un día entero y luego se llevaría por delante un fichero vivo. Antes que eso,
    // que se caiga el guardado.
    const rezagadas = ownUrlsDeep(promocionado, prefijoPublico).filter((url) => {
      const clave = keyFromPublicUrl(url, prefijoPublico);
      return clave !== null && isPendingKey(clave, root);
    });
    if (rezagadas.length > 0) {
      await this.rollback(copiedKeys);
      this.logger.error(
        `Promoción incompleta bajo ${root}: ${rezagadas.length} URL(s) siguen en tmp/. No se guarda.`,
      );
      throw new InternalServerErrorException(
        'No se ha podido preparar el contenido subido. No se ha guardado nada.',
      );
    }

    return { value: promocionado, copiedKeys, temporaryKeys };
  }

  /**
   * Deshace las copias cuando la escritura de la fila falla DESPUÉS del pase.
   *
   * Es el único fallo nuevo que introduce la copia, y es el mismo que `VideoService` y
   * `UsersService` ya compensan: la copia queda en el prefijo definitivo, donde nadie la
   * referencia y **donde la regla de caducidad no llega**. El original sigue en `tmp/` y lo
   * caducará la regla, así que reintentar el guardado no pierde nada.
   *
   * NUNCA LANZA: se llama desde un `catch` que ya tiene un error mejor que contar.
   */
  async rollback(copiedKeys: string[]): Promise<void> {
    for (const key of copiedKeys) {
      await this.r2.delete(key).catch((err) => {
        this.logger.warn(`No se pudo deshacer la copia ${key}: ${String(err)}`);
      });
    }
  }

  /**
   * Borra los temporales ya promocionados. **Cortesía, no corrección**: si falla, la regla
   * de ciclo de vida los recoge igual — «no dejar limpiar no debe romper nada».
   *
   * Se llama DESPUÉS de escribir, nunca antes: mientras la fila no esté guardada, el
   * temporal es lo único que permite reintentar.
   */
  async dropTemporaries(temporaryKeys: string[]): Promise<void> {
    for (const key of temporaryKeys) {
      await this.r2.delete(key).catch((err) => {
        this.logger.warn(`No se pudo borrar el temporal ${key}: ${String(err)}`);
      });
    }
  }
}
