import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ListConversationsDto } from './dto/list-conversations.dto';

/**
 * MENSAJERÍA C1 — LO QUE EL STAFF PUEDE SABER SIN LEER NADA.
 *
 * ─── POR QUÉ ES UN SERVICIO APARTE Y NO UN MÉTODO MÁS DE `MessagingService` ──
 *
 * Porque el lector del usuario **ESCRIBE**:
 *
 *   // messaging.service.ts:176-181 — `getConversation`
 *   await this.prisma.message.updateMany({
 *     where: { conversationId: id, senderId: { not: userId }, readAt: null },
 *     data: { readAt: new Date() },
 *   });
 *
 * Abrir un hilo marca como leídos los mensajes del otro. Es correcto para su
 * dueño y **catastrófico para el staff**: un moderador mirando una conversación
 * ajena le diría al comprador que el vendedor ha leído su mensaje. Se alteraría
 * el estado de dos personas que no han hecho nada, en silencio, y encima
 * mintiendo — el vendedor no lo ha leído.
 *
 * De ahí que el camino de staff tenga su propio lector, y no un parámetro
 * `esStaff` que apague la escritura: una guarda que depende de un booleano es
 * exactamente lo que `ListingImagesService` documenta haber evitado, y aquí el
 * booleano gobernaría un `updateMany` sobre datos de terceros.
 *
 * **ESTE SERVICIO NO ESCRIBE. NUNCA.** No hay un solo `update`, `create` ni
 * `delete` en este fichero, y ésa es su única invariante — la barrera del
 * `readAt` la comprueba de punta a punta.
 *
 * ─── QUÉ SIRVE, Y QUÉ NO ────────────────────────────────────────────────────
 *
 * SÓLO CABECERAS: quién habló con quién, sobre qué anuncio, cuándo empezó,
 * cuándo fue el último mensaje y cuántos hay. **El cuerpo de los mensajes no sale
 * por aquí** — eso es C2, con su decisión de privacidad y su registro de acceso.
 *
 * Con esto un moderador ya responde «¿hubo contacto? ¿cuánto? ¿cuándo?», que es
 * la mitad del valor del encargo sin abrir correspondencia de nadie.
 *
 * ─── EL LISTADO NO SE AUDITA ────────────────────────────────────────────────
 *
 * Decisión del diseño (§2.2): esto es METADATO y se carga cada vez que alguien
 * abre una ficha. Registrar cada carga llenaría `AuditLog` de ruido justo hasta
 * hacerlo inútil para lo que sirve. El registro de acceso es de C2, donde se abre
 * el contenido — que es lo que de verdad hay que poder revisar.
 */
@Injectable()
export class AdminMessagingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Las conversaciones de UN ANUNCIO: todas las que se abrieron sobre él.
   *
   * Incluye las de compradores cuya cuenta se eliminó — eliminar no borra la
   * fila, la vacía, así que el hilo sigue ahí y tiene que seguir contándose.
   * «Todas» es el encargo, y un `where` que filtrara por cuentas vivas se dejaría
   * justo las que suelen importar.
   */
  listByListing(listingId: string, dto: ListConversationsDto) {
    return this.buscar({ listingId }, dto);
  }

  /**
   * Las conversaciones de UNA PERSONA, POR SUS DOS CARAS.
   *
   * Un usuario vende y compra, y son cosas distintas: lo que preguntó por cosas
   * de otros (`buyerId`) y lo que le preguntaron por lo suyo (`sellerId`). Un
   * `where` que sólo mirase una de las dos se dejaría la mitad de sus hilos **sin
   * que nada fallara** — la interfaz enseñaría una lista corta y nadie sabría que
   * falta algo. Por eso el papel es explícito y `ambos` es un `OR`, no un
   * descuido.
   */
  listByUser(userId: string, dto: ListConversationsDto) {
    const papel = dto.papel ?? 'ambos';
    const where: Prisma.ConversationWhereInput =
      papel === 'comprador'
        ? { buyerId: userId }
        : papel === 'vendedor'
          ? { sellerId: userId }
          : { OR: [{ buyerId: userId }, { sellerId: userId }] };
    return this.buscar(where, dto);
  }

  /**
   * LA PROYECCIÓN, en un solo sitio para que las dos entradas no puedan divergir.
   *
   * `select` explícito y no `include`: con `include` Prisma devuelve todos los
   * escalares, y aquí lo que NO debe salir importa tanto como lo que sale. Los
   * mensajes viajan sólo como `_count`; su `body` no aparece en ninguna rama de
   * este fichero.
   */
  private async buscar(where: Prisma.ConversationWhereInput, dto: ListConversationsDto) {
    const { page = 1, perPage = 20 } = dto;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        // Por actividad, no por creación: al staff le interesa lo que se movió
        // hace poco, igual que a los dueños del hilo (`findConversations`).
        orderBy: { lastMessageAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          createdAt: true,
          lastMessageAt: true,
          // El anuncio Y su snapshot. `listingId` es `SetNull` a propósito —para
          // que el vendedor no pueda destruir el hilo del comprador borrando su
          // anuncio—, así que la relación puede ser null y `listingTitle` es lo
          // único que queda para decir de qué iba. Se sirven los dos y decide la
          // interfaz, igual que hace `ReporteDiana` con las denuncias.
          listingTitle: true,
          listing: { select: { id: true, title: true, status: true } },
          buyer: { select: { id: true, name: true } },
          seller: { select: { id: true, name: true } },
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return { items, total, page, perPage };
  }
}
