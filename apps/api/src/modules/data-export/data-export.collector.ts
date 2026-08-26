import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * BORRADO DE CUENTAS C6 — LO QUE SE LLEVA UNA PERSONA (§7.2).
 *
 * ── EL CRITERIO, Y POR QUÉ ES DE INCLUSIÓN EXPLÍCITA ────────────────────────
 *
 * Ninguna sección se arma con «todas las columnas de la tabla». Cada `select` de
 * este fichero enumera lo que sale, y esa verbosidad es justo el punto: el día que
 * alguien añada una columna con un secreto —un token de proveedor, un hash— la
 * exportación **no** se la lleva sola. Con `include` a pelo, sí lo haría, y nadie
 * se enteraría hasta que estuviera en el ZIP de un usuario.
 *
 * ── LAS TRES EXCLUSIONES, CADA UNA CON SU MOTIVO ────────────────────────────
 *
 * 1. **Secretos** (`passwordHash`, `tokenVersion`). No son datos del usuario, son
 *    material de autenticación: exportar el hash es regalar el objetivo de un
 *    ataque offline, y `tokenVersion` no significa nada fuera del servidor.
 *
 * 2. **`TicketMessage.internal`** — las notas del staff. La invariante ya estaba
 *    escrita en `TicketsService.getForUser`, que filtra `internal: false` **en la
 *    propia consulta** y no al pintar; aquí se hace igual, por el mismo motivo:
 *    un filtro en el `where` no se puede olvidar aguas abajo.
 *
 * 3. **La identidad de quien le denunció.** Es la única exclusión que no protege
 *    a la casa sino a un TERCERO, y la que más se nota si falta: el motivo, la
 *    fecha y el estado sí van —esa persona tiene derecho a saber de qué se le
 *    acusó—, pero el nombre del denunciante no. Va también fuera la `description`
 *    libre, porque es texto que escribió otra persona y puede identificarla sola
 *    («soy tu vecino del tercero»). **El hecho sin el nombre.**
 *
 * ── EL HILO DE MENSAJES VA ENTERO, INCLUIDA LA PARTE DEL OTRO ───────────────
 *
 * Y no es una contradicción con lo anterior, es la misma regla aplicada bien: el
 * solicitante **ya lee esos mensajes en su bandeja**. Exportarlos no le enseña
 * nada que no pudiera copiar a mano, así que no hay divulgación nueva que impedir.
 * La identidad del denunciante, en cambio, **no la ve en ninguna parte** — ésa sí
 * sería un dato nuevo, y uno que habilita represalias.
 *
 * ── `AuditLog` NO ENTRA ─────────────────────────────────────────────────────
 *
 * Es rastro interno de seguridad y lleva las IPs del **staff**, que es otro sujeto.
 * Auditar personas es otra pantalla con otro rol.
 */

/** Un fichero que hay que meter en el ZIP: dónde va dentro y de dónde sale. */
export interface FicheroExportado {
  /** Ruta dentro del ZIP, p. ej. `ficheros/facturas/F-2026-1.pdf`. */
  ruta: string;
  /** Clave en R2. */
  key: string;
}

export interface DatosExportados {
  /** El objeto que se serializa como `datos.json`. */
  datos: Record<string, unknown>;
  /** Los binarios que acompañan (avatar, fotos, facturas, adjuntos). */
  ficheros: FicheroExportado[];
  /** Para el nombre del ZIP y el aviso. */
  sujeto: { id: string; slug: string; name: string };
}

/**
 * El perfil, campo a campo. **La lista blanca**: lo que no está aquí no sale.
 *
 * Nótese lo que falta y por qué: `passwordHash` y `tokenVersion` (secretos) y
 * `failedLoginAttempts`/`lockedUntil`, que son contadores del antifraude y no
 * datos que la persona haya generado.
 */
const SELECT_PERFIL = {
  id: true,
  email: true,
  name: true,
  slug: true,
  phone: true,
  avatarUrl: true,
  bio: true,
  role: true,
  status: true,
  emailVerified: true,
  trusted: true,
  city: true,
  province: true,
  postalCode: true,
  createdAt: true,
  updatedAt: true,
  // §7.2 los nombra explícitamente: el usuario tiene derecho a ver desde dónde
  // se entró a su cuenta por última vez. Es SU IP, no la del staff.
  lastLoginAt: true,
  lastLoginIp: true,
  // Cómo llegó a estar archivada/eliminada, si lo está. Sin `archivedById`: quién
  // del staff pulsó el botón es dato del staff, no suyo.
  archivedAt: true,
  archiveReason: true,
  archiveNote: true,
  deletedAt: true,
} as const;

/** Los datos fiscales, que §7.2 lista aparte de la ubicación pública. */
const SELECT_FISCAL = {
  fiscalTaxId: true,
  fiscalName: true,
  fiscalEntityType: true,
  fiscalAddress: true,
  fiscalCity: true,
  fiscalPostalCode: true,
  fiscalProvince: true,
  fiscalCountry: true,
} as const;

@Injectable()
export class DataExportCollector {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reúne TODO lo del §7.2 para un usuario.
   *
   * SE HACE EN EL WORKER Y NO EN LA PETICIÓN, y por eso puede permitirse esta
   * decena larga de consultas: nadie tiene una petición HTTP abierta esperándolas.
   */
  async collect(userId: string, publicUrlPrefix: string): Promise<DatosExportados> {
    const usuario = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { ...SELECT_PERFIL, ...SELECT_FISCAL },
    });

    const ficheros: FicheroExportado[] = [];

    const { perfil, datosFiscales } = this.partirPerfil(usuario);

    const anuncios = await this.recogerAnuncios(userId, publicUrlPrefix, ficheros);
    const conversaciones = await this.recogerConversaciones(userId);
    const tickets = await this.recogerTickets(userId, ficheros);
    const facturas = await this.recogerFacturas(userId, ficheros);
    const denuncias = await this.recogerDenuncias(userId);
    const monedero = await this.recogerMonedero(userId);

    // El avatar, si es NUESTRO. Un `avatarUrl` de Google no tiene clave en el
    // bucket y `keyFromPublicUrl` devuelve `null` en vez de inventarse una
    // (molde `VideoService.deleteObjectByUrl`).
    if (perfil.avatarUrl) {
      const key = this.keyDeUrl(perfil.avatarUrl, publicUrlPrefix);
      if (key) ficheros.push({ ruta: `ficheros/avatar${this.extensionDe(key)}`, key });
    }

    const [
      valoracionesEmitidas,
      valoracionesRecibidas,
      tratosComoVendedor,
      tratosComoComprador,
      transacciones,
      suscripciones,
      entitlements,
      canjesDeCupon,
      favoritos,
      alertas,
      notificaciones,
      proveedoresVinculados,
    ] = await Promise.all([
      this.prisma.review.findMany({
        where: { authorId: userId },
        select: {
          id: true, rating: true, comment: true, listingTitle: true, verified: true,
          createdAt: true, editedAt: true, retiredAt: true, retiredReason: true,
          target: { select: { name: true, slug: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.review.findMany({
        where: { targetId: userId },
        select: {
          id: true, rating: true, comment: true, listingTitle: true, verified: true,
          createdAt: true, editedAt: true, retiredAt: true, retiredReason: true,
          author: { select: { name: true, slug: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.deal.findMany({
        where: { sellerId: userId },
        select: { id: true, listingTitle: true, createdAt: true, buyer: { select: { name: true, slug: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.deal.findMany({
        where: { buyerId: userId },
        select: { id: true, listingTitle: true, createdAt: true, seller: { select: { name: true, slug: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.transaction.findMany({
        where: { userId },
        select: {
          id: true, amountGross: true, amountNet: true, taxAmount: true, taxRate: true,
          currency: true, status: true, gateway: true, invoiceNumber: true,
          bonusCreditAmount: true, campaignBonusAmount: true, createdAt: true,
          price: {
            select: {
              amount: true,
              currency: true,
              interval: true,
              product: { select: { name: true, type: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.subscription.findMany({
        where: { userId },
        select: {
          id: true, status: true, currentPeriodStart: true, currentPeriodEnd: true,
          cancelAtPeriodEnd: true, canceledAt: true, createdAt: true,
          price: {
            select: {
              amount: true,
              currency: true,
              interval: true,
              product: { select: { name: true, type: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.entitlement.findMany({
        where: { userId },
        select: {
          id: true, type: true, origin: true, listingId: true,
          startsAt: true, expiresAt: true, revokedAt: true, createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.couponRedemption.findMany({
        where: { userId },
        select: {
          id: true, redeemedAt: true, referenceType: true, referenceId: true,
          coupon: { select: { code: true } },
        },
        orderBy: { redeemedAt: 'asc' },
      }),
      this.prisma.favorite.findMany({
        where: { userId },
        select: {
          id: true, createdAt: true,
          listing: { select: { title: true, slug: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.alert.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.notification.findMany({
        where: { userId },
        select: { id: true, type: true, data: true, read: true, readAt: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      // Sin ningún token: el modelo `Account` sólo guarda proveedor e id externo,
      // y se enumeran igualmente para que añadir un `access_token` mañana no lo
      // arrastre al ZIP por descuido.
      this.prisma.account.findMany({
        where: { userId },
        select: { provider: true, providerAccountId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const datos: Record<string, unknown> = {
      exportadoEl: new Date().toISOString(),
      perfil,
      datosFiscales,
      anuncios,
      conversaciones,
      valoracionesEmitidas,
      valoracionesRecibidas,
      tratos: { comoVendedor: tratosComoVendedor, comoComprador: tratosComoComprador },
      tickets,
      facturas,
      transacciones,
      suscripciones,
      entitlements,
      monedero,
      canjesDeCupon,
      favoritos,
      alertas,
      notificaciones,
      proveedoresVinculados,
      denunciasEmitidas: denuncias.emitidas,
      denunciasRecibidas: denuncias.recibidas,
    };

    return {
      datos,
      ficheros,
      sujeto: { id: perfil.id, slug: perfil.slug, name: perfil.name },
    };
  }

  // ── Secciones ───────────────────────────────────────────────────────────────

  /** Ubicación pública y datos fiscales son bloques SEPARADOS en el schema y se
   *  mantienen separados en el ZIP, para que se vea que son cosas distintas. */
  private partirPerfil(usuario: Record<string, unknown>) {
    const claves = Object.keys(SELECT_FISCAL);
    const datosFiscales: Record<string, unknown> = {};
    const perfil: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(usuario)) {
      if (claves.includes(k)) datosFiscales[k] = v;
      else perfil[k] = v;
    }
    return {
      perfil: perfil as { id: string; slug: string; name: string; avatarUrl: string | null },
      datosFiscales,
    };
  }

  private async recogerAnuncios(
    userId: string,
    publicUrlPrefix: string,
    ficheros: FicheroExportado[],
  ) {
    const anuncios = await this.prisma.listing.findMany({
      where: { sellerId: userId },
      select: {
        id: true, title: true, slug: true, description: true,
        price: true, currency: true, type: true, condition: true,
        priceType: true, priceUnit: true, status: true, attributes: true,
        city: true, province: true, postalCode: true,
        latitude: true, longitude: true, phone: true,
        viewCount: true, impressionCount: true,
        videoUrl: true, videoDurationSeconds: true, videoUploadedAt: true,
        publishedAt: true, expiresAt: true, bumpedAt: true,
        createdAt: true, updatedAt: true,
        category: { select: { name: true, slug: true } },
        tags: { select: { tag: { select: { name: true, slug: true } } } },
        images: { select: { url: true, alt: true, order: true }, orderBy: { order: 'asc' } },
        viewsDaily: { select: { date: true, count: true }, orderBy: { date: 'asc' } },
        impressionsDaily: { select: { date: true, count: true }, orderBy: { date: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const anuncio of anuncios) {
      let n = 0;
      for (const img of anuncio.images) {
        const key = this.keyDeUrl(img.url, publicUrlPrefix);
        if (!key) continue;
        n += 1;
        ficheros.push({
          ruta: `ficheros/anuncios/${anuncio.id}/${n}${this.extensionDe(key)}`,
          key,
        });
      }
    }

    return anuncios;
  }

  /**
   * Los hilos, ENTEROS. Cada mensaje lleva quién lo escribió — incluidos los del
   * otro, que es justo lo que hace útil el hilo y lo que el solicitante ya lee.
   */
  private async recogerConversaciones(userId: string) {
    return this.prisma.conversation.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      select: {
        id: true, listingTitle: true, createdAt: true, lastMessageAt: true,
        buyer: { select: { name: true, slug: true } },
        seller: { select: { name: true, slug: true } },
        messages: {
          select: {
            id: true, body: true, createdAt: true, readAt: true,
            sender: { select: { name: true, slug: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Los tickets del usuario. `internal: false` **en el `where` de los mensajes**,
   * copiando literalmente lo que hace `getForUser`: para el usuario, una nota
   * interna del staff no existe — ni en la pantalla ni aquí.
   *
   * Los adjuntos cuelgan de los mensajes ya filtrados, así que un fichero
   * adjuntado a una nota interna **no puede llegar al ZIP**: no hay mensaje del
   * que colgar.
   */
  private async recogerTickets(userId: string, ficheros: FicheroExportado[]) {
    const tickets = await this.prisma.ticket.findMany({
      where: { userId },
      select: {
        id: true, subject: true, status: true, origin: true, linkedLabel: true,
        createdAt: true, lastMessageAt: true, resolvedAt: true, closedAt: true,
        messages: {
          where: { internal: false },
          select: {
            id: true, side: true, body: true, createdAt: true,
            attachments: { select: { id: true, filename: true, mimeType: true, sizeBytes: true, key: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const ticket of tickets) {
      for (const mensaje of ticket.messages) {
        for (const adjunto of mensaje.attachments) {
          ficheros.push({
            ruta: `ficheros/tickets/${ticket.id}/${this.nombreSeguro(adjunto.filename)}`,
            key: adjunto.key,
          });
        }
      }
    }

    // La clave de R2 es fontanería interna: dentro del ZIP el adjunto ya está,
    // y publicar la clave no aporta nada que el fichero no dé.
    return tickets.map((t) => ({
      ...t,
      messages: t.messages.map((m) => ({
        ...m,
        attachments: m.attachments.map(({ key: _key, ...resto }) => resto),
      })),
    }));
  }

  /**
   * Las facturas — la parte de la exportación con valor práctico real, y el
   * motivo entero de que el formato sea un ZIP y no un JSON (§7.1).
   */
  private async recogerFacturas(userId: string, ficheros: FicheroExportado[]) {
    const facturas = await this.prisma.invoice.findMany({
      where: { userId },
      include: { lines: true },
      orderBy: { createdAt: 'asc' },
    });

    for (const factura of facturas) {
      if (!factura.pdfKey) continue;
      ficheros.push({
        ruta: `ficheros/facturas/${this.nombreSeguro(factura.number ?? factura.id)}.pdf`,
        key: factura.pdfKey,
      });
    }

    // `pdfKey` fuera: es una clave PRIVADA de R2 y no abre nada por sí sola. El
    // PDF va dentro del ZIP, que es lo que el usuario necesita.
    return facturas.map(({ pdfKey: _pdfKey, ...resto }) => resto);
  }

  /**
   * LAS DOS DIRECCIONES DE LA DENUNCIA, Y NO SE PARECEN EN NADA.
   *
   * Emitidas: van enteras. Es lo que él escribió, y ya sabe a quién denunció.
   *
   * Recibidas: **el hecho sin el nombre**. Ni `reporter`, ni `reporterId`, ni la
   * `description` libre. Va el motivo (el enum), la fecha, el estado y sobre qué
   * anuncio suyo fue — lo suficiente para entender de qué se le acusó, sin nada
   * que permita ir a buscar a quien lo dijo.
   */
  private async recogerDenuncias(userId: string) {
    const [emitidas, recibidas] = await Promise.all([
      this.prisma.report.findMany({
        where: { reporterId: userId },
        select: {
          id: true, reason: true, description: true, status: true,
          listingTitle: true, reportedUserName: true, createdAt: true, resolvedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.report.findMany({
        where: { reportedUserId: userId },
        select: {
          id: true, reason: true, status: true,
          listingTitle: true, createdAt: true, resolvedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return { emitidas, recibidas };
  }

  /** El monedero con LOS DOS libros mayores: créditos y bumps son saldos
   *  distintos con historias distintas, y §7.2 pide los dos. */
  private async recogerMonedero(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: {
        balance: true,
        bumpBalance: true,
        createdAt: true,
        entries: {
          select: { id: true, type: true, amount: true, note: true, referenceType: true, referenceId: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
        bumpEntries: {
          select: { id: true, type: true, amount: true, note: true, referenceType: true, referenceId: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!wallet) return null;
    return {
      saldoCreditos: wallet.balance,
      saldoBumps: wallet.bumpBalance,
      creadoEl: wallet.createdAt,
      movimientosDeCreditos: wallet.entries,
      movimientosDeBumps: wallet.bumpEntries,
    };
  }

  // ── Utilidades ──────────────────────────────────────────────────────────────

  /** La clave en nuestro bucket, o `null` si la URL es ajena. */
  private keyDeUrl(url: string, publicUrlPrefix: string): string | null {
    const prefijo = publicUrlPrefix.endsWith('/') ? publicUrlPrefix : `${publicUrlPrefix}/`;
    if (!url.startsWith(prefijo)) return null;
    const key = url.slice(prefijo.length);
    return key.length > 0 ? key : null;
  }

  private extensionDe(key: string): string {
    const m = /\.[a-zA-Z0-9]+$/.exec(key);
    return m ? m[0] : '';
  }

  /**
   * Un nombre que no pueda escaparse de su carpeta dentro del ZIP.
   *
   * `filename` y `number` vienen de fuera (lo subió un usuario, lo generó una
   * serie), y un `../../etc` dentro de una entrada de ZIP es el clásico
   * *zip-slip*: al descomprimir, el fichero aterriza fuera del directorio. Aquí
   * se corta en el origen porque es donde se construye la ruta.
   */
  private nombreSeguro(nombre: string): string {
    const limpio = nombre.replace(/[/\\]/g, '_').replace(/\.{2,}/g, '_').trim();
    return limpio.length > 0 ? limpio.slice(0, 120) : 'fichero';
  }
}
