import { BaseError } from "../BaseErrors/BaseErrors";

export class BadRequestError extends BaseError {
  constructor(message = "Permintaan tidak valid") {
    super(message, 400);
  }
}

export class UnauthorizedError extends BaseError {
  constructor(message = "Anda tidak memiliki akses") {
    super(message, 401);
  }
}

export class ForbiddenError extends BaseError {
  constructor(message = "Akses ditolak") {
    super(message, 403);
  }
}

export class UnverifiedAccountError extends BaseError {
  constructor(message: string, data: { email: string }) {
    super(message, 403, data);
  }
}

export class NotFoundError extends BaseError {
  constructor(message = "Data tidak ditemukan") {
    super(message, 404);
  }
}

export class MethodNotAllowedError extends BaseError {
  constructor(message = "Metode tidak diizinkan") {
    super(message, 405);
  }
}

export class ConflictError extends BaseError {
  constructor(message = "Data bentrok dengan data lain") {
    super(message, 409);
  }
}

export class UnprocessableEntityError extends BaseError {
  constructor(message = "Data tidak bisa diproses") {
    super(message, 422);
  }
}

export class TooManyRequestsError extends BaseError {
  constructor(message = "Terlalu banyak permintaan, coba lagi nanti") {
    super(message, 429);
  }
}

export class InternalServerError extends BaseError {
  constructor(message = "Terjadi kesalahan pada server.") {
    super(message, 500);
  }
}
