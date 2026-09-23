import { BaseError } from "../BaseErrors/BaseErrors";

export class BadRequestError extends BaseError {
  constructor(message = "Bad Request") {
    super(message, 400);
  }
}

export class UnauthorizedError extends BaseError {
  constructor(message = "Unauthorized") {
    super(message, 401);
  }
}

export class ForbiddenError extends BaseError {
  constructor(message = "Forbidden") {
    super(message, 403);
  }
}

export class NotFoundError extends BaseError {
  constructor(message = "Not Found") {
    super(message, 404);
  }
}

export class MethodNotAllowedError extends BaseError {
  constructor(message = "Method Not Allowed") {
    super(message, 405);
  }
}

export class ConflictError extends BaseError {
  constructor(message = "Conflict") {
    super(message, 409);
  }
}

export class UnprocessableEntityError extends BaseError {
  constructor(message = "Unprocessable Entity") {
    super(message, 422);
  }
}

export class TooManyRequestsError extends BaseError {
  constructor(message = "Too Many Requests") {
    super(message, 429);
  }
}

export class InternalServerError extends BaseError {
  constructor(message = "Internal Server Error") {
    super(message, 500);
  }
}
