'use strict';

/**
 * Captions & transcript pipeline (Oct-2026, P0 learner-experience batch). Captions
 * are stored inline as WebVTT (one track per locale, re-add replaces), the
 * transcript is a locale Map that must survive a save, and both must reach the
 * learner player through lessonFor().
 */

const { Tenant, User, Asset } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const media = require('../../src/services/media.service');
const { pick } = require('../../src/plugins/locale-map');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);
const VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello.';

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'cap', name: 'Cap', locales: ['en', 'fr'] });
  user = await User.create({ email: 'a@x.io', name: 'A', passwordHash: 'x', status: 'active' });
});

describe('captions', () => {
  async function readyVideo() {
    return as(() => Asset.create({ kind: 'video', filename: 'l.mp4', mime: 'video/mp4', storageKey: 'k', status: 'ready' }));
  }

  it('stores an inline WebVTT track per locale', async () => {
    const a = await readyVideo();
    const saved = await as(() => media.setCaption(a._id, { locale: 'en', vtt: VTT }));
    expect(saved.captions).toHaveLength(1);
    expect(saved.captions[0].locale).toBe('en');
    expect(saved.captions[0].vtt).toContain('WEBVTT');
  });

  it('replaces a locale rather than duplicating it, and removes on request', async () => {
    const a = await readyVideo();
    await as(() => media.setCaption(a._id, { locale: 'en', vtt: VTT }));
    await as(() => media.setCaption(a._id, { locale: 'en', vtt: VTT + '\n\n00:00:02.000 --> 00:00:04.000\nAgain.' }));
    await as(() => media.setCaption(a._id, { locale: 'fr', vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nBonjour.' }));
    let fresh = await as(() => Asset.findById(a._id).exec());
    expect(fresh.captions).toHaveLength(2); // en replaced, fr added
    expect(fresh.captions.find((c) => c.locale === 'en').vtt).toContain('Again.');

    await as(() => media.removeCaption(a._id, 'en'));
    fresh = await as(() => Asset.findById(a._id).exec());
    expect(fresh.captions.map((c) => c.locale)).toEqual(['fr']);
  });

  it('rejects text that is not WebVTT', async () => {
    const a = await readyVideo();
    await expect(as(() => media.setCaption(a._id, { locale: 'en', vtt: 'just some text' }))).rejects.toThrow(/WebVTT/);
  });
});

describe('transcript (locale map) round-trips through save', () => {
  it('persists an edited transcript instead of silently dropping it', async () => {
    const a = await as(() => Asset.create({ kind: 'audio', filename: 'a.mp3', mime: 'audio/mpeg', storageKey: 'k', status: 'ready' }));
    await as(() => media.setTranscript(a._id, { en: 'first' }));
    await as(() => media.setTranscript(a._id, { en: 'second' }));
    const fresh = await as(() => Asset.findById(a._id).exec());
    expect(pick(fresh.transcript, 'en')).toBe('second');
  });
});
