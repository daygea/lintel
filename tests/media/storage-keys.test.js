'use strict';

const mongoose = require('mongoose');
const { keyFor } = require('../../src/lib/storage');

/**
 * Storage keys are the last line of defence.
 *
 * If a signed URL leaks — pasted into a WhatsApp group, sitting in a browser
 * history, lifted from a proxy log — the attacker has one object for five
 * minutes. What they must NOT be able to do is edit the path and walk into
 * another institution's material. Hence the tenant id in the key, always.
 */
describe('object keys', () => {
  it('are scoped to the tenant', () => {
    const tenant = new mongoose.Types.ObjectId();
    const asset = new mongoose.Types.ObjectId();
    const key = keyFor(tenant, asset, 'original.mp3');
    expect(key).toBe(`t/${tenant}/assets/${asset}/original.mp3`);
    expect(key.startsWith(`t/${tenant}/`)).toBe(true);
  });

  it('put two tenants in different prefixes', () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const asset = new mongoose.Types.ObjectId();
    expect(keyFor(a, asset, 'x.mp3')).not.toBe(keyFor(b, asset, 'x.mp3'));
  });
});
