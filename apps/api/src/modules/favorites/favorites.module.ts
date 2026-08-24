import { Module } from '@nestjs/common';
import { ReviewsModule } from '../reviews/reviews.module';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';

// `ReviewsModule` — la media del vendedor en la tarjeta, como en las otras diez listas.
// Sin ciclo: `ReviewsModule` sólo importa `PrismaModule`, y nadie importa `FavoritesModule`
// salvo `AppModule`. La forma de la tarjeta NO entra por aquí: `listing-summary.ts` es un
// fichero sin módulo, así que compartirlo no acopla `FavoritesModule` con `ListingsModule`.
@Module({
  imports: [ReviewsModule],
  controllers: [FavoritesController],
  providers: [FavoritesService],
  exports: [FavoritesService],
})
export class FavoritesModule {}
