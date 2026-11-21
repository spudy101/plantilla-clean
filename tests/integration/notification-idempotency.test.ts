// Punta a punta, con la app real y Postgres: POST /notifications (lo llaman otros sistemas con X-API-Key)
// repetido con la misma Idempotency-Key crea UNA sola notificación. Es el caso que justifica la
// idempotencia: un sistema externo que reintenta porque se le cortó la respuesta (docs/idempotency.md).

// La clave del sistema externo se lee al cargar la configuración: tiene que estar antes de cargar la app
const API_KEY = 'it-external-system-key';
process.env.EXTERNAL_API_KEYS = API_KEY;

import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import prisma from '../../src/shared/database/prisma';

const TAG = `notif-idem-${randomUUID().slice(0, 8)}`;
const CODE = TAG.toUpperCase().replace(/-/g, '_');
const PATH = '/client/api/v1/notification/notifications';
let app: Express;
let categoryId: string;
let typeId: string;

describe('POST /notifications idempotente · app real + Postgres', () => {
  beforeAll(async () => {
    app = (await import('../../src/app')).default;
    categoryId = (await prisma.notificationCategory.create({ data: { code: CODE, name: TAG } })).notificationCategoryId;
    typeId = (
      await prisma.notificationType.create({
        data: {
          code: CODE,
          name: TAG,
          titleTemplate: 'Aviso {{n}}',
          bodyTemplate: 'Cuerpo',
          notificationCategoryId: categoryId,
          isActive: true
        }
      })
    ).notificationTypeId;
  }, 60_000); // cargar la app completa tarda con las suites en paralelo

  afterAll(async () => {
    await prisma.globalNotification.deleteMany({ where: { notificationTypeId: typeId } });
    await prisma.notificationType.deleteMany({ where: { notificationTypeId: typeId } });
    await prisma.notificationCategory.deleteMany({ where: { notificationCategoryId: categoryId } });
    await prisma.idempotencyKey.deleteMany({ where: { scope: { startsWith: 'api:' }, key: { startsWith: TAG } } });
  });

  const send = (key: string | null, body: object) => {
    const r = request(app).post(PATH).set('X-API-Key', API_KEY).send(body);
    return key ? r.set('Idempotency-Key', key) : r;
  };
  const countGlobals = () => prisma.globalNotification.count({ where: { notificationTypeId: typeId } });

  it('sin Idempotency-Key → 400 y no crea nada', async () => {
    const res = await send(null, { tipoNotificacion: CODE, metadata: { n: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await countGlobals()).toBe(0);
  });

  it('el reintento con la misma clave devuelve la misma notificación y no crea otra', async () => {
    const key = `${TAG}-${randomUUID()}`;
    const body = { tipoNotificacion: CODE, metadata: { n: 1 } };

    const first = await send(key, body);
    const retry = await send(key, body);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.data.globalNotificationId).toBe(first.body.data.globalNotificationId);
    expect(await countGlobals()).toBe(1);
  });

  it('otra clave es otra operación: crea otra notificación', async () => {
    const before = await countGlobals();
    const res = await send(`${TAG}-${randomUUID()}`, { tipoNotificacion: CODE, metadata: { n: 2 } });
    expect(res.status).toBe(201);
    expect(await countGlobals()).toBe(before + 1);
  });

  it('un body inválido no gasta la clave: corregido, la misma clave se ejecuta', async () => {
    const key = `${TAG}-${randomUUID()}`;
    const invalid = await send(key, { metadata: { n: 3 } }); // falta tipoNotificacion
    const valid = await send(key, { tipoNotificacion: CODE, metadata: { n: 3 } });

    expect(invalid.status).toBe(422);
    expect(valid.status).toBe(201);
    expect(valid.headers['idempotent-replayed']).toBeUndefined();
  });
});
