import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice } from '../src/utils/price.js';

test('formats pence as GBP', () => {
  assert.equal(formatPrice(1999), '£19.99');
  assert.equal(formatPrice(0), '£0.00');
});
