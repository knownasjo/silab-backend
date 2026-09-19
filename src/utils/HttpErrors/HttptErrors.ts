// utils/HttpErrors.ts
import { BaseError } from "../BaseErrors/BaseErrors";

// 400 Bad Request
export class BadRequestError extends BaseError {
  constructor(message = "Bad Request") {
    super(message, 400);
  }
}

// 401 Unauthorized (Authentication required or failed)
export class UnauthorizedError extends BaseError {
  constructor(message = "Unauthorized") {
    super(message, 401);
  }
}

// 403 Forbidden (Authenticated but no permission)
export class ForbiddenError extends BaseError {
  constructor(message = "Forbidden") {
    super(message, 403);
  }
}

// 404 Not Found
export class NotFoundError extends BaseError {
  constructor(message = "Not Found") {
    super(message, 404);
  }
}

// 405 Method Not Allowed
export class MethodNotAllowedError extends BaseError {
  constructor(message = "Method Not Allowed") {
    super(message, 405);
  }
}

// 409 Conflict (e.g., duplicate entry)
export class ConflictError extends BaseError {
  constructor(message = "Conflict") {
    super(message, 409);
  }
}

// 422 Unprocessable Entity (validation error)
export class UnprocessableEntityError extends BaseError {
  constructor(message = "Unprocessable Entity") {
    super(message, 422);
  }
}

// 429 Too Many Requests (rate limit)
export class TooManyRequestsError extends BaseError {
  constructor(message = "Too Many Requests") {
    super(message, 429);
  }
}

// 500 Internal Server Error (default fallback)
export class InternalServerError extends BaseError {
  constructor(message = "Internal Server Error") {
    super(message, 500);
  }
}
