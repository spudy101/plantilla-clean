// Casos de uso del mantenedor de tipos de consentimiento, con dobles en memoria de sus puertos.
import { ListConsentTypes } from './list-consent-types.use-case';
import { GetConsentType } from './get-consent-type.use-case';
import { CreateConsentType } from './create-consent-type.use-case';
import { UpdateConsentType } from './update-consent-type.use-case';
import { CONSENT_TYPE_ADMIN_NOTIFICATION } from './consent-type-admin-notice';
import { ConsentTypeCodeTakenError, ConsentTypeNotFoundError } from '../../domain/errors';
import { RecordingAuditTrail, RecordingNotifier, silentLogger } from '../../../../../tests/doubles/settings.doubles';
import { consentType, InMemoryConsentTypes } from '../../../../../tests/doubles/legal.doubles';

const PAGE = { page: 1, limit: 10, sortBy: 'createdAt', order: 'DESC' as const };
const flush = () => new Promise<void>(resolve => {
  setImmediate(resolve);
});

const setup = (types = new InMemoryConsentTypes([consentType()])) => {
  const audit = new RecordingAuditTrail();
  const notifier = new RecordingNotifier();
  const notice = { notifier, logger: silentLogger, logoUrl: 'https://logo.test/l.png' };
  return { types, audit, notifier, notice };
};

describe('ListConsentTypes', () => {
  it('pagina, pasa la búsqueda, audita y devuelve { data, metadata }', async () => {
    const { types, audit } = setup();
    const result = await new ListConsentTypes(types, audit).execute({ actorId: 'admin-1', query: { ...PAGE, search: 'priv' } });

    expect(types.lastList[0]).toEqual({ page: { ...PAGE, offset: 0 }, search: 'priv' });
    expect(result.data).toHaveLength(1);
    expect(result.metadata).toMatchObject({ pagination: { totalItems: 1 }, filters: { search: 'priv' } });
    expect(audit.entries).toEqual([
      expect.objectContaining({ action: 'CONSENT_TYPE_LIST_VIEWED', actorId: 'admin-1', details: { totalItems: 1, page: 1 } })
    ]);
  });
});

describe('GetConsentType', () => {
  it('devuelve el detalle y audita', async () => {
    const { types, audit } = setup();
    const result = await new GetConsentType(types, audit).execute({ actorId: 'a', consentTypeId: consentType().consentTypeId });
    expect(result).toMatchObject({ code: 'PRIVACY_POLICY', description: null });
    expect(audit.entries[0]).toMatchObject({ action: 'CONSENT_TYPE_DETAIL_VIEWED', details: { code: 'PRIVACY_POLICY' } });
  });

  it('inexistente → ConsentTypeNotFoundError', async () => {
    const { types, audit } = setup();
    await expect(new GetConsentType(types, audit).execute({ actorId: 'a', consentTypeId: 'x' })).rejects.toBeInstanceOf(ConsentTypeNotFoundError);
  });
});

describe('CreateConsentType', () => {
  it('guarda con el código normalizado y los valores por defecto, audita y avisa al administrador', async () => {
    const { types, audit, notifier, notice } = setup(new InMemoryConsentTypes());
    const result = await new CreateConsentType(types, audit, silentLogger, notice).execute({
      actorId: 'admin-1',
      definition: { code: 'terms', name: 'Términos' }
    });
    await flush();

    expect(result).toMatchObject({ code: 'TERMS', isMandatory: true, isRevocable: false, isActive: true });
    expect(audit.entries[0]).toMatchObject({ action: 'CONSENT_TYPE_CREATED', details: { code: 'TERMS', name: 'Términos' } });
    expect(notifier.sent).toEqual([
      expect.objectContaining({
        type: CONSENT_TYPE_ADMIN_NOTIFICATION,
        userId: 'admin-1',
        metadata: { accion: 'creado', code: 'TERMS', logoUrl: 'https://logo.test/l.png' }
      })
    ]);
  });

  it('el código ya existe (comparado en mayúsculas) → ConsentTypeCodeTakenError', async () => {
    const { types, audit, notice } = setup(new InMemoryConsentTypes([consentType({ code: 'ABC', isActive: false })]));
    await expect(
      new CreateConsentType(types, audit, silentLogger, notice).execute({ actorId: 'a', definition: { code: 'abc', name: 'x' } })
    ).rejects.toBeInstanceOf(ConsentTypeCodeTakenError);
  });

  it('si el aviso falla, la creación igual responde', async () => {
    const { types, audit, notifier, notice } = setup(new InMemoryConsentTypes());
    notifier.failWith = new Error('ses caído');
    await expect(
      new CreateConsentType(types, audit, silentLogger, notice).execute({ actorId: 'a', definition: { code: 'X', name: 'x' } })
    ).resolves.toMatchObject({ code: 'X' });
    await flush();
  });
});

describe('UpdateConsentType', () => {
  it('aplica el patch parcial, audita los cambios pedidos y avisa', async () => {
    const { types, audit, notifier, notice } = setup();
    const id = consentType().consentTypeId;
    const result = await new UpdateConsentType(types, audit, notice).execute({ actorId: 'a', consentTypeId: id, patch: { isActive: false } });
    await flush();

    expect(result).toMatchObject({ name: 'Política de privacidad', isActive: false });
    expect(audit.entries[0]).toMatchObject({ action: 'CONSENT_TYPE_UPDATED', details: { consentTypeId: id, changes: { isActive: false } } });
    expect(notifier.sent[0]?.metadata).toMatchObject({ accion: 'actualizado' });
  });

  it('inexistente, o desaparece al guardar → ConsentTypeNotFoundError', async () => {
    const { types, audit, notice } = setup();
    await expect(new UpdateConsentType(types, audit, notice).execute({ actorId: 'a', consentTypeId: 'x', patch: {} })).rejects.toBeInstanceOf(
      ConsentTypeNotFoundError
    );
    types.update = async () => null;
    await expect(
      new UpdateConsentType(types, audit, notice).execute({ actorId: 'a', consentTypeId: consentType().consentTypeId, patch: {} })
    ).rejects.toBeInstanceOf(ConsentTypeNotFoundError);
  });
});
