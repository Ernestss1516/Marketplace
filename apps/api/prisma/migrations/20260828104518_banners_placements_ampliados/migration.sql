-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BannerPlacement" ADD VALUE 'BUSQUEDA';
ALTER TYPE "BannerPlacement" ADD VALUE 'CATEGORIA';
ALTER TYPE "BannerPlacement" ADD VALUE 'ANUNCIO';
ALTER TYPE "BannerPlacement" ADD VALUE 'BLOG';
ALTER TYPE "BannerPlacement" ADD VALUE 'VENDEDOR';
ALTER TYPE "BannerPlacement" ADD VALUE 'PLANES';
ALTER TYPE "BannerPlacement" ADD VALUE 'CONTACTO';
ALTER TYPE "BannerPlacement" ADD VALUE 'PERFIL';
ALTER TYPE "BannerPlacement" ADD VALUE 'PERFIL_FACTURACION';
ALTER TYPE "BannerPlacement" ADD VALUE 'PERFIL_SUSCRIPCION';
ALTER TYPE "BannerPlacement" ADD VALUE 'MIS_ALERTAS';
ALTER TYPE "BannerPlacement" ADD VALUE 'MIS_CREDITOS';

-- El `DROP INDEX "User_lastLoginAt_desc_nulls_last_idx"` que genera aquí
-- `prisma migrate dev` se ha BORRADO A MANO, como en todas las migraciones
-- anteriores: ese índice se crea con `NULLS LAST`, que el schema de Prisma no
-- sabe expresar, así que el diff lo ve como sobrante y propone tirarlo en cada
-- migración nueva. Dejarlo pasar sería cargarse el índice de ordenación de
-- «última conexión» del listado de usuarios del admin.
