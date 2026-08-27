import { Injectable } from '@nestjs/common';
import { ListingPauseOrigin, ListingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ListingActivationService } from '../listing-activation/listing-activation.service';

/** Lo mínimo que hace falta de un anuncio pausado: el `id` para escribirlo y el
 *  `slug` para invalidar su caché de ficha. */
export type PausedListing = { id: string; slug: string };

/**
 * RESIDUO BANNED — «SACAR DEL ESCAPARATE LOS ANUNCIOS DE UNA CUENTA», UNA SOLA VEZ.
 *
 * SERVICIO PROPIO, MOLDE DE `ListingActivationService`, y por el mismo motivo: es un
 * gesto que comparten DOS LLAMANTES QUE NO SE CONOCEN —`AccountArchiveService` (el
 * archivado, C2) y `AdminService` (el ban)— y ninguno de los dos puede alojar al
 * otro. Meterlo en `AccountArchiveService` obligaría a que banear pasara por un
 * servicio llamado «archivar», y el día que divergieran nadie lo notaría.
 *
 * POR QUÉ IMPORTA QUE SEA UNO Y NO DOS: los dos caminos tienen que coincidir en
 * cuatro cosas —qué estados se pausan, a cuál se llevan, qué marca de origen se
 * escribe y qué se hace con el índice—, y coincidir en cuatro cosas escritas dos
 * veces es coincidir hoy. La divergencia que más caro sale es la primera: si el ban
 * pausara también los `DRAFT`, el desarchivado de C2 no sabría qué hacer con ellos.
 *
 * LA MITAD QUE FALTA AQUÍ ES DELIBERADA: **no hay `restaurar`**. Restaurar no es
 * simétrico entre los dos llamantes —desarchivar reactiva, reinstaurar no—, así que
 * no hay nada compartido que extraer. Lo común es pausar; lo distinto se queda en
 * quien lo decide. Ver `ListingPauseOrigin.BAN`.
 */
@Injectable()
export class ListingPauseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activation: ListingActivationService,
  ) {}

  /**
   * Los estados de anuncio que una operación de cuenta PAUSA.
   *
   * Sólo estos dos porque sólo estos dos se ven: un `DRAFT` o un `PENDING_REVIEW` no
   * está indexado, no es enlazable y no tiene ficha pública, así que no hay nada que
   * ocultar. `SOLD` y `EXPIRED` tampoco entran: ya salieron del escaparate solos.
   *
   * `RESERVED` entra, y es la decisión incómoda: una reserva es un compromiso con
   * OTRA persona, y el vendedor acaba de desaparecer (por su pie o por sanción) — la
   * reserva no puede prosperar, y dejarla visible sostiene una promesa que ya no
   * existe. Ver diseño §4.4.
   */
  static readonly PAUSABLES: ListingStatus[] = [ListingStatus.ACTIVE, ListingStatus.RESERVED];

  /**
   * Lleva a `PAUSED` los anuncios visibles de un usuario y les deja escrito QUIÉN los
   * pausó. Devuelve los que ha tocado — el llamante los necesita para el registro de
   * auditoría y para `reindexPaused`.
   *
   * NO TOCA LO QUE YA ESTÁ `PAUSED`, y ése es el corazón del caso «archivado y
   * después baneado»: sus anuncios ya salieron del escaparate con origen `ARCHIVE`, y
   * re-pausarlos con origen `BAN` les robaría el billete de vuelta del desarchivado.
   * No hace falta un `if` que lo compruebe: sale del filtro por `PAUSABLES`, que es
   * donde ya estaba. Lo mismo protege a los que el propio vendedor pausó (origen
   * `null`), que nadie debe reclamar.
   *
   * ACEPTA UNA TRANSACCIÓN porque el archivado necesita que el pausado y el cambio de
   * `User.status` caigan o se escriban juntos: una cuenta archivada con sus anuncios
   * todavía en el escaparate es exactamente el agujero que este cuerpo cierra. El
   * `findMany` va DENTRO de la misma transacción para que nadie active un anuncio
   * entre la lectura y la escritura.
   */
  async pauseListingsForUser(
    userId: string,
    origin: ListingPauseOrigin,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<PausedListing[]> {
    // Se cargan ANTES de tocarlos: después de pausarlos ya no se puede saber cuáles
    // eran, y hacen falta sus `slug` para invalidar caché e índice. Molde
    // `deleteListing`, que carga la fila antes de destruirla por el mismo motivo.
    const aPausar = await tx.listing.findMany({
      where: { sellerId: userId, status: { in: ListingPauseService.PAUSABLES } },
      select: { id: true, slug: true },
    });

    if (aPausar.length === 0) return [];

    await tx.listing.updateMany({
      where: { id: { in: aPausar.map((l) => l.id) } },
      data: { status: ListingStatus.PAUSED, pausedByAccountReason: origin },
    });

    return aPausar;
  }

  /**
   * El efecto externo del pausado: sacarlos del índice y tirar su ficha cacheada.
   *
   * SEPARADO DE LA ESCRITURA, y no por gusto: va FUERA de la transacción del llamante
   * y **sin poder tumbarla**. Si esto falla, la cuenta ya está archivada o baneada y
   * eso es lo correcto; reintentar un reindexado es trivial, deshacer una sanción no.
   * Misma asimetría que el resto de efectos externos del cuerpo (diseño §6.5).
   */
  async reindexPaused(listings: PausedListing[]): Promise<void> {
    for (const l of listings) {
      await this.activation.reindexListing(l.slug, l.id);
    }
  }

  /**
   * Borra la marca de origen de los anuncios que siguen `PAUSED` por ese motivo,
   * DEJÁNDOLOS PAUSADOS.
   *
   * Es lo que hace reinstaurar a un baneado: la sanción se levanta, así que la marca
   * que decía «esto lo pausó una sanción» deja de ser cierta — pero los anuncios NO
   * vuelven solos (esa es la decisión: reinstaurar devuelve el acceso, no la
   * visibilidad). Al quitarles la marca quedan indistinguibles de un pausado normal,
   * que es justo lo que son a partir de ese momento: algo que su dueño reactiva
   * cuando quiere, desde su panel, uno a uno.
   *
   * FILTRA POR ORIGEN Y NO SÓLO POR USUARIO — es la barrera contra pisar al otro
   * gesto: un `updateMany` sin el `pausedByAccountReason: origin` le arrancaría a un
   * usuario baneado-y-archivado las marcas `ARCHIVE`, y su desarchivado ya no
   * encontraría qué devolver.
   */
  async clearPauseOrigin(userId: string, origin: ListingPauseOrigin): Promise<number> {
    const { count } = await this.prisma.listing.updateMany({
      where: {
        sellerId: userId,
        status: ListingStatus.PAUSED,
        pausedByAccountReason: origin,
      },
      data: { pausedByAccountReason: null },
    });
    return count;
  }
}
