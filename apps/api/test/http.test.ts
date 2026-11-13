import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { createApp, type AuthRequest } from '../src/app.js';
import { env } from '../src/config.js';
import type { Response, NextFunction } from 'express';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../src/core.js', async (original) => ({
  ...(await original<typeof import('../src/core.js')>()),
  db: () => ({ rpc: mocks.rpc }),
}));
const asOwner = (req: AuthRequest, _res: Response, next: NextFunction) => {
  req.userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  req.role = 'owner';
  next();
};
const asViewer = (req: AuthRequest, _res: Response, next: NextFunction) => {
  req.userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  req.role = 'viewer';
  next();
};
beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  env.META_APP_SECRET = 'test-secret';
  env.WHATSAPP_VERIFY_TOKEN = 'verify-test';
});
describe('API integration', () => {
  it('serves health with security headers', async () => {
    const r = await request(createApp()).get('/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
  it('requires authentication for private data', async () => {
    const r = await request(createApp()).get('/api/data/memories');
    expect(r.status).toBe(401);
  });
  it('rejects invalid webhook signatures before persisting', async () => {
    const r = await request(createApp())
      .post('/api/webhooks/whatsapp')
      .send({ object: 'whatsapp_business_account' });
    expect(r.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('verifies webhook subscription with the configured token', async () => {
    expect(
      (
        await request(createApp()).get(
          '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=12345',
        )
      ).text,
    ).toBe('12345');
    expect(
      (
        await request(createApp()).get(
          '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong',
        )
      ).status,
    ).toBe(403);
  });
  it('authenticates and durably enqueues signed WhatsApp messages', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '123456' },
                messages: [
                  { id: 'wamid.test', from: '923001234567', type: 'text', text: { body: 'hello' } },
                ],
              },
            },
          ],
        },
      ],
    });
    const signature = `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}`;
    const r = await request(createApp())
      .post('/api/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(body);
    expect(r.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'enqueue_webhook',
      expect.objectContaining({ event_id: 'message:wamid.test' }),
    );
  });
  it('returns an error instead of acknowledging a failed queue transaction', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '123456' },
                messages: [{ id: 'wamid.x', from: '923001234567', type: 'text' }],
              },
            },
          ],
        },
      ],
    });
    const r = await request(createApp())
      .post('/api/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set(
        'x-hub-signature-256',
        `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}`,
      )
      .send(body);
    expect(r.status).toBe(500);
  });
  it('blocks table injection and unsupported resources', async () => {
    expect((await request(createApp(asOwner)).get('/api/data/webhook_events')).status).toBe(404);
    expect((await request(createApp(asOwner)).post('/api/data/messages').send({})).status).toBe(
      403,
    );
  });
  it('rejects client-supplied tenant IDs and invalid task status', async () => {
    const r = await request(createApp(asOwner))
      .post('/api/data/tasks')
      .send({ title: 'x', user_id: 'another-user' });
    expect(r.status).toBe(400);
    expect(
      (
        await request(createApp(asOwner))
          .post('/api/data/tasks')
          .send({ title: 'x', status: 'arbitrary' })
      ).status,
    ).toBe(400);
  });
  it('never permits direct owner phone updates', async () => {
    const r = await request(createApp(asOwner))
      .patch('/api/data/profiles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
      .send({ owner_phone: '+923001234567' });
    expect(r.status).toBe(400);
  });
  it('blocks mutations by viewer roles', async () => {
    expect(
      (await request(createApp(asViewer)).post('/api/data/tasks').send({ title: 'test' })).status,
    ).toBe(403);
  });
  it('requires explicit deletion confirmation', async () => {
    expect(
      (
        await request(createApp(asOwner)).delete(
          '/api/data/tasks/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        )
      ).status,
    ).toBe(400);
  });
  it('reports malformed JSON as a client error', async () => {
    const r = await request(createApp(asOwner))
      .post('/api/data/tasks')
      .set('Content-Type', 'application/json')
      .send('{"title":');
    expect(r.status).toBe(400);
  });
});
