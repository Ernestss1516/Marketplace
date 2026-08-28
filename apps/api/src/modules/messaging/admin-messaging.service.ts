import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
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
 * **ESTE SERVICIO NO TOCA UN SOLO DATO DE LOS USUARIOS.** No hay un `update`
 * sobre `Message` ni sobre `Conversation` en ninguna parte de este fichero, y ésa
 * es su invariante — la barrera del `readAt` la comprueba de punta a punta.
 *
 * (C2 le añadió UNA escritura, y sólo una: la fila de `AuditLog` que registra que
 * el staff abrió un hilo. No es un dato de los usuarios sino constancia de lo que
 * hizo el staff, y es obligatoria — ver `openForStaff`.)
 *
 * ─── QUÉ SIRVE, Y QUÉ NO ────────────────────────────────────────────────────
 *
 * EL LISTADO SÓLO DA CABECERAS: quién habló con quién, sobre qué anuncio, cuándo
 * empezó, cuándo fue el último mensaje y cuántos hay. **El cuerpo no sale por
 * ahí** — para eso está `openForStaff`, que sí lo sirve y deja constancia.
 *
 * Con el listado, un moderador ya responde «¿hubo contacto? ¿cuánto? ¿cuándo?»
 * sin abrir correspondencia de nadie; con la apertura, lee lo que se dijeron y
 * queda registrado que lo hizo.
 *
 * ─── EL LISTADO NO SE AUDITA (LA APERTURA SÍ) ───────────────────────────────
 *
 * Decisión del diseño (§2.2): esto es METADATO y se carga cada vez que alguien
 * abre una ficha. Registrar cada carga llenaría `AuditLog` de ruido justo hasta
 * hacerlo inútil para lo que sirve. El registro de acceso es de C2, donde se abre
 * el contenido — que es lo que de verdad hay que poder revisar.
 */
@Injectable()
export class AdminMessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * C2 — EL HILO ÍNTEGRO, Y LA FILA QUE LO DEJA POR ESCRITO.
   *
   * ─── LA ÚNICA ESCRITURA DE TODO ESTE SERVICIO, Y NO ES SOBRE DATOS DE NADIE ──
   *
   * `AdminMessagingService` prometía en su cabecera no escribir nunca. Esto lo
   * matiza y conviene decirlo con precisión: **sigue sin tocar un solo dato de los
   * usuarios**. No hay `readAt`, ni `lastMessageAt`, ni nada de la conversación ni
   * de sus mensajes. Lo único que escribe es una fila de `AuditLog` sobre SÍ MISMO
   * — sobre el hecho de que un miembro del staff acaba de mirar.
   *
   * La barrera del `readAt` de C1 sigue en pie y se comprueba también aquí: abrir
   * no marca nada como leído. Un moderador leyendo un hilo ajeno no puede hacer
   * creer al comprador que el vendedor lo leyó.
   *
   * ─── POR QUÉ EL REGISTRO ES OBLIGATORIO Y NO UNA CORTESÍA ───────────────────
   *
   * Porque el rol dejó de filtrar. El diseño proponía partirlo —MODERATOR lista,
   * ADMIN abre— y la decisión fue que MODERATOR+ hiciera las dos cosas, para que
   * quien investiga una disputa no dependa de que un administrador esté libre.
   * Eso es defendible, pero mueve la salvaguarda de sitio: **si cualquiera del
   * staff puede abrir cualquier hilo, lo único que separa la capacidad del abuso
   * es que quede constancia.**
   *
   * Y leer no deja constancia por sí mismo: no cambia nada. Sin esta fila, un
   * moderador abriendo la conversación de su ex-pareja sería **invisible por
   * construcción** — no «difícil de detectar»: imposible.
   *
   * Por eso se escribe ANTES de devolver, y un fallo al registrar hace fallar la
   * petición entera. Es el orden contrario al de la limpieza de R2 —donde el
   * borrado del fichero no puede tumbar la escritura— y por el motivo opuesto:
   * allí lo barato era perder un fichero; aquí lo caro sería **servir
   * correspondencia privada sin dejar rastro de que se sirvió**. Si el registro no
   * se puede escribir, el contenido no sale.
   *
   * ─── UNA FILA POR APERTURA ──────────────────────────────────────────────────
   *
   * No se deduplica ni se agrupa por sesión: lo que hay que poder auditar es cada
   * acceso, no que alguna vez se accediera. Diez aperturas son diez filas.
   */
  async openForStaff(conversationId: string, actorId: string, ip?: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        createdAt: true,
        lastMessageAt: true,
        listingTitle: true,
        listing: { select: { id: true, title: true, status: true } },
        buyer: { select: { id: true, name: true } },
        seller: { select: { id: true, name: true } },
        // ÍNTEGRO: todos los mensajes, en orden, con quién y cuándo.
        //
        // Sin recortes ni ventana alrededor de «lo denunciado», y es decisión del
        // diseño (§2.3): nadie denuncia el mensaje número catorce, se denuncia a
        // una persona, y quitar el contexto es justo lo que hace injusta una
        // decisión de moderación. La protección está en quién puede abrir y en que
        // quede registrado, no en mutilar el texto.
        //
        // Tampoco hay nada que desenmascarar: el chat no filtra datos de contacto
        // en ningún punto, así que esto es leer lo guardado, no levantar una capa.
        messages: {
          orderBy: { createdAt: 'asc' as const },
          select: {
            id: true,
            body: true,
            createdAt: true,
            readAt: true,
            sender: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!conversation) throw new NotFoundException('Conversación no encontrada');

    // ANTES DE DEVOLVER. Ver la cabecera: si esto falla, el contenido no sale.
    await this.auditLog.log({
      action: 'CONVERSATION_READ',
      actorId,
      resourceType: 'Conversation',
      resourceId: conversationId,
      // Sin `before`/`after`: no hubo cambio. Lo que la fila afirma es el acceso.
      ip,
    });

    return conversation;
  }

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
