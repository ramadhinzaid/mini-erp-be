import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global module exposing the single `PrismaService` instance application-wide.
 * Marked `@Global()` so feature modules can inject it without re-importing.
 * When a module is later extracted into its own microservice it simply ships
 * with its own copy of this module.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
