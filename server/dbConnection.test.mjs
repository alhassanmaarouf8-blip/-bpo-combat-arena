import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseConnectionConfig } from './db.js';

test('internal Render database URLs remove incompatible sslmode parameters', () => {
  const config = databaseConnectionConfig('postgres://user:pass@dpg-example-a:5432/app?sslmode=require');
  const parsed = new URL(config.connectionString);
  assert.equal(parsed.searchParams.has('sslmode'), false);
  assert.equal(config.ssl, false);
});

test('external database URLs require full certificate and hostname verification', () => {
  const config = databaseConnectionConfig('postgres://user:pass@example.oregon-postgres.render.com:5432/app?sslmode=require');
  const parsed = new URL(config.connectionString);
  assert.equal(parsed.searchParams.get('sslmode'), 'verify-full');
  assert.deepEqual(config.ssl, { rejectUnauthorized:true });
});
