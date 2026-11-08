import { HttpException, HttpStatus } from '@nestjs/common';

/** Domain error with a stable machine-readable code for clients. */
export class DomainError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY, details?: unknown) {
    super({ statusCode: status, code, message, details }, status);
  }
}

export const notFound = (entity: string) => new DomainError('not_found', `${entity} not found`, HttpStatus.NOT_FOUND);
