import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { QUEUE_NOTIFICATIONS, RETRY_JOB_OPTIONS } from '../../infra/queue/queue.constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PrismaModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('jwt.secret'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
    // defaultJobOptions repeated here (not just in queue.module.ts) — see the
    // comment on RETRY_JOB_OPTIONS: this module's own Queue instance is the
    // one AuthService's SEND_VERIFICATION_EMAIL/SEND_RESET_EMAIL actually use.
    BullModule.registerQueue({ name: QUEUE_NOTIFICATIONS, defaultJobOptions: RETRY_JOB_OPTIONS }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
