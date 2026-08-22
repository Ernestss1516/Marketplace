import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { R2Service } from '../../infra/r2/r2.service';
import { isPendingKey, keyFromPublicUrl, pendingPrefix } from '../../infra/r2/media-keys';
import { EntitlementService } from '../billing/entitlement.service';
import { AVATAR_KEY_PREFIX } from '../media/media.service';
import { MediaCleanupService } from '../media-cleanup/media-cleanup.service';
import { UpdateMeDto } from './dto/update-me.dto';

const PRIVATE_PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  slug: true,
  phone: true,
  avatarUrl: true,
  bio: true,
  city: true,
  province: true,
  postalCode: true,
  emailVerified: true,
  role: true,
  // Datos fiscales (RF.13) — para precargar el formulario de /perfil/facturacion.
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
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
    private readonly mediaCleanup: MediaCleanupService,
    private readonly r2: R2Service,
  ) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: PRIVATE_PROFILE_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * HUÉRFANAS H1 — EL AVATAR SUSTITUIDO (fuga 1a).
   *
   * Esto pisaba `avatarUrl` sin mirar lo que había, así que **cada cambio de foto
   * dejaba la anterior en el bucket para siempre**. Es el único sitio que escribe el
   * avatar de una cuenta ya creada: el otro escritor (`AuthService`, alta por Google)
   * sólo lo pone al crear, y un login posterior no lo repisa.
   *
   * La lectura del valor anterior es la única consulta que H1 añade en todo el
   * cuerpo — las otras tres superficies ya leían su estado previo. La limpieza va
   * DESPUÉS del `update` y no puede tumbarlo: ver `MediaCleanupService`.
   */
  async updateMe(id: string, dto: UpdateMeDto) {
    const antes = await this.prisma.user.findUnique({
      where: { id },
      select: { avatarUrl: true },
    });

    // HUÉRFANAS H2 — GUARDAR EL PERFIL ES LO QUE «CONFIRMA» EL AVATAR (fuga 1b).
    const avatarDefinitivo = await this.confirmarAvatar(id, dto.avatarUrl);

    let actualizado;
    try {
      actualizado = await this.prisma.user.update({
        where: { id },
        data: { ...dto, ...(avatarDefinitivo && { avatarUrl: avatarDefinitivo.url }) },
        select: PRIVATE_PROFILE_SELECT,
      });
    } catch (err) {
      // COMPENSACIÓN (H2): la copia ya está en el prefijo definitivo, donde la regla de
      // caducidad no llega. Si la fila no se escribe, nadie la referenciará nunca: se
      // deshace. El temporal sigue en `tmp/` y lo caducará la regla.
      if (avatarDefinitivo?.copiado) {
        await this.r2.delete(avatarDefinitivo.key).catch(() => undefined);
      }
      throw err;
    }

    // CORTESÍA: el temporal ya no hace falta. Si falla, la regla lo caduca.
    if (avatarDefinitivo?.copiado) {
      await this.r2.delete(avatarDefinitivo.claveTemporal).catch(() => undefined);
    }

    // H1 (fuga 1a) — el avatar que se acaba de sustituir. Se compara contra el DEFINITIVO,
    // así que una URL temporal no entra nunca en este diff: para cuando llega aquí, ya se
    // ha convertido en la de su sitio.
    await this.mediaCleanup.purgeReleased({
      before: { avatarUrl: antes?.avatarUrl ?? null },
      after: { avatarUrl: actualizado.avatarUrl },
      origen: `user:${id}`,
    });

    return actualizado;
  }

  /**
   * Mueve el avatar recién subido fuera del prefijo temporal, si lo que llega es uno.
   *
   * Devuelve `null` cuando no hay nada que confirmar: el perfil se guarda sin tocar la foto,
   * la URL es ajena (el avatar de Google) o ya es definitiva. Sólo actúa sobre
   * `avatars/tmp/<userId>/…`, que es lo que produce `POST /media/upload-avatar`.
   *
   * DOS COMPROBACIONES, Y LAS DOS IMPORTAN:
   *
   *  - **La subida es SUYA.** El `userId` va dentro de la clave temporal, así que confirmar
   *    la de otro se rechaza sin necesidad de guardar estado entre subir y guardar. Mismo
   *    criterio que `VideoService`, que rechaza la clave temporal de otro anuncio — y hace
   *    falta porque `UpdateMeDto.avatarUrl` es un `@IsString()` pelado.
   *  - **Guardar dos veces la misma URL temporal** (doble envío del formulario) encuentra el
   *    temporal ya borrado. Se mira el destino: si está, la confirmación ya ocurrió y se
   *    reutiliza tal cual, en vez de responder que la imagen no existe.
   */
  private async confirmarAvatar(
    userId: string,
    avatarUrl: string | undefined,
  ): Promise<{ url: string; key: string; claveTemporal: string; copiado: boolean } | null> {
    if (!avatarUrl) return null;

    const prefijoPublico = this.r2.getPublicUrl('');
    const clave = keyFromPublicUrl(avatarUrl, prefijoPublico);
    // Ajena (Google) o no nuestra: no se toca. Ya definitiva: tampoco hay nada que mover.
    if (!clave || !isPendingKey(clave, AVATAR_KEY_PREFIX)) return null;

    const prefijoTemporal = pendingPrefix(AVATAR_KEY_PREFIX, userId);
    if (!clave.startsWith(prefijoTemporal)) {
      throw new ForbiddenException('Esa imagen no es tuya.');
    }

    // El destino es el prefijo de siempre (`avatars/<hex><ext>`), así que los avatares
    // guardados antes de H2 siguen exactamente donde estaban: no migra ninguno.
    const claveDefinitiva = `${AVATAR_KEY_PREFIX}/${clave.slice(prefijoTemporal.length)}`;

    if (await this.r2.head(clave)) {
      await this.r2.copy(clave, claveDefinitiva);
      return {
        url: this.r2.getPublicUrl(claveDefinitiva),
        key: claveDefinitiva,
        claveTemporal: clave,
        copiado: true,
      };
    }

    if (await this.r2.head(claveDefinitiva)) {
      // Ya se confirmó antes: idempotente.
      return {
        url: this.r2.getPublicUrl(claveDefinitiva),
        key: claveDefinitiva,
        claveTemporal: clave,
        copiado: false,
      };
    }

    throw new BadRequestException('No encontramos la imagen subida. Vuelve a intentarlo.');
  }

  /**
   * H8.4 — perfil público del vendedor. isPro se calcula una sola vez (no hay N+1: un
   * vendedor, no un listado). H8 Bloque E — trusted es un campo propio del User, no
   * requiere cálculo: independiente de isPro (uno no se deriva del otro).
   */
  async findBySlug(slug: string) {
    const user = await this.prisma.user.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        avatarUrl: true,
        bio: true,
        city: true,
        province: true,
        createdAt: true,
        trusted: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const { id, createdAt, ...rest } = user;
    const isPro = await this.entitlements.isProActive(id);
    return { ...rest, memberSince: createdAt, isPro };
  }

  /**
   * Ciclo de vida RÁFAGA 1 — buscador de usuarios para elegir comprador/cliente
   * al cerrar un Deal (ver ListingsService.closeDeal). Solo devuelve datos ya
   * públicos (mismos campos que un perfil público) — nunca email/teléfono.
   * Acotado a 10 resultados; el rate limit vive en el controller.
   */
  async search(query: string, excludeUserId: string) {
    return this.prisma.user.findMany({
      where: {
        id: { not: excludeUserId },
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { slug: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, slug: true, avatarUrl: true },
      take: 10,
    });
  }
}
