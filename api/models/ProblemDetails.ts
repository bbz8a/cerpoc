/**
 * Error body returned by every RegiGov API endpoint on failure (RFC 7807 style,
 * content type application/problem+json). Source: /api/docs/json
 */
export interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  /** Field-level validation errors (e.g. on 422) */
  errors?: unknown[];
}
