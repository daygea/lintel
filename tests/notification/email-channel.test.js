'use strict';

/**
 * Email channel transport. Reads creds at send time, so:
 *   - no creds  → dev log transport, provider never called
 *   - creds set → POSTs to Resend with the right payload, returns its ref
 *   - provider error → throws, so notify() records the attempt as failed
 */

const { EmailChannel } = require('../../src/services/notification/channels/email');

const channel = new EmailChannel();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('logs (dev transport) and never calls the provider when unconfigured', async () => {
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('EMAIL_FROM', '');
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);

  const out = await channel.send({ to: 'a@x.io', subject: 'Hi', text: 'set-password link here' });

  expect(fetchSpy).not.toHaveBeenCalled();
  expect(out.providerRef).toMatch(/^dev-/);
});

it('POSTs to Resend with the right payload when configured', async () => {
  vi.stubEnv('RESEND_API_KEY', 'test-key');
  vi.stubEnv('EMAIL_FROM', 'Lintel <no-reply@lintel.test>');
  const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'abc123' }) }));
  vi.stubGlobal('fetch', fetchSpy);

  const out = await channel.send({ to: 'a@x.io', subject: 'Hi', text: 'body' });

  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, opts] = fetchSpy.mock.calls[0];
  expect(url).toBe('https://api.resend.com/emails');
  expect(opts.headers.Authorization).toBe('Bearer test-key');
  expect(JSON.parse(opts.body)).toMatchObject({
    from: 'Lintel <no-reply@lintel.test>',
    to: 'a@x.io',
    subject: 'Hi',
    text: 'body',
  });
  expect(out.providerRef).toBe('resend-abc123');
});

it('throws on a non-2xx so the dispatcher records failure', async () => {
  vi.stubEnv('RESEND_API_KEY', 'test-key');
  vi.stubEnv('EMAIL_FROM', 'x@y.z');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 422, text: async () => 'unverified from' })));

  await expect(channel.send({ to: 'a@x.io', subject: 'Hi', text: 'b' })).rejects.toThrow(/422/);
});
