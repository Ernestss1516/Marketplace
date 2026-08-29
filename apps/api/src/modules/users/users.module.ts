import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { EmailPreferencesService } from './email-preferences.service';
import { ListingsModule } from '../listings/listings.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { BillingModule } from '../billing/billing.module';
import { MediaCleanupModule } from '../media-cleanup/media-cleanup.module';
import { AccountArchiveModule } from '../account-archive/account-archive.module';
import { DataExportModule } from '../data-export/data-export.module';

@Module({
  imports: [
    ListingsModule,
    ReviewsModule,
    BillingModule,
    MediaCleanupModule,
    // BORRADO DE CUENTAS C2 — el auto-archivado de `/perfil`. El mismo servicio lo
    // importa `AdminModule` para la entrada del staff.
    AccountArchiveModule,
    // BORRADO DE CUENTAS C6 — «llévate tus datos», desde `/perfil`. Mismo reparto
    // que el archivado: el usuario por aquí, el staff por `AdminModule`.
    DataExportModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, EmailPreferencesService],
  exports: [UsersService],
})
export class UsersModule {}
