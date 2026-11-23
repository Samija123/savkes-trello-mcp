import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, toSafeError, logRequestError } from './utils/errors.mjs';

test('redactSecrets hides key and token query params', () => {
  assert.equal(
    redactSecrets('GET https://api.trello.com/1/x?key=abc&token=def&fields=name failed'),
    'GET https://api.trello.com/1/x?key=[redacted]&token=[redacted]&fields=name failed'
  );
});
test('toSafeError tolerates non-errors', () => {
  assert.equal(toSafeError(undefined).message, 'Unknown error');
  assert.equal(toSafeError({ status: 401, message: '?token=zzz' }).message, '?token=[redacted]');
});
test('logRequestError logs the redacted form only', () => {
  const lines = [];
  logRequestError('X', new Error('?key=secret'), (...a) => lines.push(a));
  assert.doesNotMatch(JSON.stringify(lines), /secret/);
});
