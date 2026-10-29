import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnPath, loginPath } from '../src/features/auth/navigation.ts';

test('login preserves interview, admin, and mobile upload destinations', () => {
  assert.equal(safeReturnPath('/interview/oral'), '/interview/oral');
  assert.equal(safeReturnPath('/admin/questions?set=a'), '/admin/questions?set=a');
  assert.equal(safeReturnPath('/m/upload?sessionId=abc'), '/m/upload?sessionId=abc');
  assert.equal(loginPath('/interview/oral', 'session_expired'), '/login?next=%2Finterview%2Foral&error=session_expired');
});

test('external, encoded, and malformed return locations fall back safely', () => {
  for (const input of ['https://evil.test', '//evil.test/admin', '/admin/../evil', '/admin%2fevil', '/\\evil.test', '/admin\r\n', null]) {
    assert.equal(safeReturnPath(input), '/interview/basic');
  }
});
