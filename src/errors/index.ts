export type ErrorDetails = Record<string, unknown> | unknown[] | undefined

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetails
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: ErrorDetails, code = 'BAD_REQUEST') {
    super(400, code, message, details)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', details?: ErrorDetails) {
    super(401, 'UNAUTHORIZED', message, details)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details?: ErrorDetails, code = 'FORBIDDEN') {
    super(403, code, message, details)
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, details?: ErrorDetails) {
    super(404, 'NOT_FOUND', `${resource} not found`, details)
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: ErrorDetails) {
    super(409, 'CONFLICT', message, details)
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests', details?: ErrorDetails) {
    super(429, 'TOO_MANY_REQUESTS', message, details)
  }
}

/** A dependency (Stellar RPC, anchor, FX source) failed or returned something unusable. */
export class UpstreamError extends AppError {
  constructor(service: string, message: string, details?: ErrorDetails) {
    super(502, 'UPSTREAM_ERROR', `${service}: ${message}`, details)
  }
}
