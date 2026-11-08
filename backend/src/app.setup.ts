import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { AppConfig } from './config/env';

/** Never leak internals (SQL, stack traces, financial payloads) in error responses or logs. */
@Catch()
class SafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      res.status(exception.getStatus()).json(typeof body === 'string' ? { statusCode: exception.getStatus(), message: body } : body);
      return;
    }
    const err = exception as Error;
    this.logger.error(`${req.method} ${req.route?.path ?? req.path} failed: ${err?.name}: ${err?.message?.split('\n')[0]}`, err?.stack);
    res.status(500).json({ statusCode: 500, code: 'internal_error', message: 'Something went wrong on our side. Please try again.' });
  }
}

export function configureApp(app: INestApplication, config: AppConfig) {
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins, credentials: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new BadRequestException({
          statusCode: 400,
          code: 'validation_failed',
          message: 'Some fields need attention.',
          fields: Object.fromEntries(errors.map((e) => [e.property, Object.values(e.constraints ?? {})])),
        }),
    }),
  );
  app.useGlobalFilters(new SafeExceptionFilter());

  const doc = new DocumentBuilder()
    .setTitle('Personal Finance Manager API')
    .setDescription('Allocate first. Spend second. Amounts are decimal strings in the account currency (INR by default).')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
}
