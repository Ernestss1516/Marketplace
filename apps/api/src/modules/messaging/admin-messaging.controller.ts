import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { MinRole } from '../../common/decorators';
import { AdminMessagingService } from './admin-messaging.service';
import { ListConversationsDto } from './dto/list-conversations.dto';

/**
 * MENSAJERÍA C1 — el metadato de las conversaciones, para el staff.
 *
 * ─── EL ROL ─────────────────────────────────────────────────────────────────
 *
 * **MODERATOR+**, y es una decisión tomada por encima de lo que este diseño
 * recomendaba. El diseño proponía partirlo (MODERATOR lista, ADMIN abre); Ernest
 * eligió que MODERATOR+ pueda las dos cosas, porque quien investiga una denuncia
 * de fraude o de acoso es moderación, y obligar a escalar cada caso convierte la
 * capacidad en inútil.
 *
 * **La consecuencia hay que decirla, porque cambia dónde está la salvaguarda:**
 * si el rol ya no filtra, lo único que queda entre la capacidad y el abuso es el
 * REGISTRO del acceso. En C1 no hace falta —aquí no sale ni una línea de
 * conversación— pero en C2, que sirve el contenido, el `AuditLog` deja de ser
 * recomendable y pasa a ser la única salvaguarda que existe.
 *
 * ─── POR QUÉ ESTE LISTADO NO SE AUDITA ──────────────────────────────────────
 *
 * Es metadato y se carga cada vez que alguien abre una ficha de anuncio o de
 * usuario. Registrar eso llenaría `AuditLog` de ruido hasta hacerlo inútil justo
 * para lo que sirve: encontrar quién hizo qué. Se audita abrir el contenido (C2),
 * que es lo que de verdad hay que poder revisar.
 *
 * ─── SÓLO LECTURA, POR CONSTRUCCIÓN ─────────────────────────────────────────
 *
 * No hay `@Post`, `@Patch` ni `@Delete` en este controlador, ni los habrá: el
 * staff no escribe en conversaciones ajenas. Para hablar con alguien está el
 * sistema de tickets, que además deja rastro.
 */
@ApiTags('Admin — Mensajería')
@ApiBearerAuth('access-token')
@Controller('admin/conversations')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.MODERATOR)
export class AdminMessagingController {
  constructor(private readonly adminMessaging: AdminMessagingService) {}

  /**
   * UNA RUTA Y NO DOS, con `listingId` **o** `userId`.
   *
   * Es la misma consulta con distinto `where` y la misma proyección; dos rutas
   * serían dos sitios donde mantener sincronizada la lista de campos que salen —
   * y aquí lo que NO sale importa (el cuerpo de los mensajes).
   */
  @Get()
  list(@Query() query: ListConversationsDto) {
    const { listingId, userId } = query;

    // Excluyentes y obligatorio uno: sin filtro esto serviría la mensajería
    // ENTERA de la plataforma en una petición, que no es ninguna de las dos
    // preguntas que el encargo hace.
    if (!listingId && !userId) {
      throw new BadRequestException('Indica listingId o userId');
    }
    if (listingId && userId) {
      throw new BadRequestException('listingId y userId son excluyentes');
    }

    return listingId
      ? this.adminMessaging.listByListing(listingId, query)
      : this.adminMessaging.listByUser(userId!, query);
  }
}
