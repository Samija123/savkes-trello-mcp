// Shared error helpers so every entry point (dashboard, tools, ...) redacts and
// reports failures the same way instead of repeating the logic in each catch block.

const SECRET_QUERY_PARAM = /([?&](?:key|token)=)[^&\s]+/gi;

/** Strip Trello credentials that may appear in URLs inside error messages. */
export const redactSecrets = (text) =>
  String(text ?? '').replace(SECRET_QUERY_PARAM, '$1[redacted]');

/** The error as it is safe to log: no credentials, no stack. */
export const toSafeError = (err) => ({
  name: err?.name,
  status: err?.status ?? err?.statusCode,
  message: redactSecrets(err?.message || 'Unknown error'),
});

/** Log a failed request without leaking secrets; returns the safe form. */
export function logRequestError(label, err, log = console.error) {
  const safe = toSafeError(err);
  log(`${label} failed:`, safe);
  return safe;
}
