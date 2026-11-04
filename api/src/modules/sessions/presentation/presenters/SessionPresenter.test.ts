import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { SessionPresenter } from './SessionPresenter';
import { sessionItemSchema, sessionStatusSchema } from '../schemas/sessionItem.schema';
import { makeSession } from '../../application/use-cases/sessionTestFakes';

const NOW = new Date('2026-11-04T12:00:00Z');
const waiting = () =>
  makeSession({
    status: 'DISCONNECTED',
    connectRequestedAt: new Date('2026-11-04T11:00:00Z'),
    leaseUntil: new Date('2026-11-04T11:59:00Z'),
  });

describe('SessionPresenter.toSessionItem awaitingCapacity', () => {
  it('flag desligada (default) → false mesmo aguardando', () => {
    expect(SessionPresenter.toSessionItem(waiting()).awaitingCapacity).toBe(false);
    expect(SessionPresenter.toSessionItem(waiting(), null, { adoptionEnabled: false, now: NOW }).awaitingCapacity).toBe(false);
  });

  it('flag ligada → segue a regra da entidade', () => {
    expect(SessionPresenter.toSessionItem(waiting(), null, { adoptionEnabled: true, now: NOW }).awaitingCapacity).toBe(true);
    const owned = makeSession({ status: 'CONNECTING', connectRequestedAt: NOW, leaseUntil: new Date(NOW.getTime() + 60_000) });
    expect(SessionPresenter.toSessionItem(owned, null, { adoptionEnabled: true, now: NOW }).awaitingCapacity).toBe(false);
  });

  it('lista repassa a flag e não expõe dono nem lease', () => {
    const { sessions } = SessionPresenter.toSessionList([{ session: waiting(), avatarUrl: null }], { adoptionEnabled: true, now: NOW });
    expect(sessions[0]!.awaitingCapacity).toBe(true);
    expect(Object.keys(sessions[0]!).filter((k) => /owner|lease|connectRequested|adopt/i.test(k))).toEqual([]);
  });

  it('schema de resposta serializa o campo', async () => {
    const app = Fastify();
    app.addSchema(sessionStatusSchema);
    app.addSchema(sessionItemSchema);
    app.get('/s', { schema: { response: { 200: { $ref: 'SessionItem#' } } } }, async () =>
      SessionPresenter.toSessionItem(waiting(), null, { adoptionEnabled: true, now: NOW }),
    );
    const res = await app.inject({ method: 'GET', url: '/s' });
    expect(res.json()).toMatchObject({ awaitingCapacity: true, status: 'DISCONNECTED' });
    await app.close();
  });
});
