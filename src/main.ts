import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService<AppConfig, true>);

  const apiPrefix = config.get('apiPrefix', { infer: true });
  const port = config.get('port', { infer: true });

  // Security headers and a versioned, prefixed API surface.
  app.use(helmet());
  app.enableCors();
  app.setGlobalPrefix(apiPrefix);

  // Global request validation/transformation. `whitelist` strips unknown
  // properties; `forbidNonWhitelisted` rejects them outright.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Flush in-flight requests and close DB connections on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  // Interactive API documentation at /{apiPrefix}/docs.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Mini ERP API')
    .setDescription('REST API for the Mini ERP backend')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Application listening on port ${port} (prefix: /${apiPrefix})`);
  logger.log(`Swagger docs available at /${apiPrefix}/docs`);
}

void bootstrap();
