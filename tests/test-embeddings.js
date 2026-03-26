import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { getModelLoadTime } from '../src/embeddings.js';

describe('embeddings', () => {
  test('getModelLoadTime returns number', () => {
    const time = getModelLoadTime();
    assert.equal(typeof time, 'number');
  });

  test('getModelLoadTime is 0 before model load', () => {
    const time = getModelLoadTime();
    assert.equal(time, 0);
  });
});
