import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { AppConfig } from './config/env';

const DEFAULT_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  422: 'unprocessable',
  429: 'rate_limited',
};

/** Never leak internals (SQL, stack traces, financial payloads) in error responses or logs. */
@Catch()
class SafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    if (exception instanceof HttpException) {
      // Every error has the same shape: { statusCode, code, message, [fields], [details] }.
      const status = exception.getStatus();
      const raw = exception.getResponse() as string | Record<string, unknown>;
      const body: Record<string, unknown> = typeof raw === 'string' ? { message: raw } : { ...raw };
      delete (body as any).error;
      if (Array.isArray(body.message)) body.message = body.message.join(' ');
      res.status(status).json({ statusCode: status, code: body.code ?? DEFAULT_CODES[status] ?? 'error', ...body, ...(status === 429 && { message: 'Too many requests. Wait a moment and try again.' }) });
      return;
    }
    const err = exception as Error;
    this.logger.error(`${req.method} ${req.route?.path ?? req.path} failed: ${err?.name}: ${err?.message?.split('\n')[0]}`, err?.stack);
    res.status(500).json({ statusCode: 500, code: 'internal_error', message: 'Something went wrong on our side. Please try again.' });
  }
}

const LOCAL_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/**
 * CORS: production allows only CORS_ORIGINS. Outside production, any http://localhost or 127.0.0.1
 * port is also allowed, because `flutter run -d chrome` and other dev servers pick a random port.
 * Requests without an Origin header (mobile apps, curl, server-to-server) are not affected by CORS.
 */
export function isAllowedOrigin(config: AppConfig, origin: string | undefined): boolean {
  if (!origin) return true;
  if (config.corsOrigins.includes(origin)) return true;
  return config.nodeEnv !== 'production' && LOCAL_DEV_ORIGIN.test(origin);
}

export function configureApp(app: INestApplication, config: AppConfig) {
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.enableCors({ origin: (origin: string | undefined, done: (err: Error | null, allow?: boolean) => void) => done(null, isAllowedOrigin(config, origin)), credentials: false });
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

  SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app));
}

export const API_CONTRACT_VERSION = '1.0.0';

/** The OpenAPI document. Frozen copy: docs/api/openapi-v1.json (see docs/API_CONTRACT.md). */
export function buildOpenApiDocument(app: INestApplication) {
  const doc = new DocumentBuilder()
    .setTitle('Personal Finance Manager API')
    .setDescription('Allocate first. Spend second. Amounts are decimal strings in the account currency (INR by default). Errors are { statusCode, code, message, fields?, details? }.')
    .setVersion(API_CONTRACT_VERSION)
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, doc);
}
