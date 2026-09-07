/**
 * Base error class for all application errors.
 * Carries a machine-readable code, HTTP status and optional metadata.
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly meta?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    statusCode: number = 500,
    meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.meta = meta;

    // Preserve prototype chain in transpiled environments
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
