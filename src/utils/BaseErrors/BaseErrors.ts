export class BaseError extends Error {
  statusCode: number;
  data?: unknown;

  constructor(message: string, statusCode = 500, data?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.data = data;
  }
}
