import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EntitlementService } from '../billing/entitlement.service';
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

    const actualizado = await this.prisma.user.update({
      where: { id },
      data: dto,
      select: PRIVATE_PROFILE_SELECT,
    });

    await this.mediaCleanup.purgeReleased({
      before: { avatarUrl: antes?.avatarUrl ?? null },
      after: { avatarUrl: actualizado.avatarUrl },
      origen: `user:${id}`,
    });

    return actualizado;
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
