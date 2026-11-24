// Casos de uso del perfil propio y de las referencias, con dobles en memoria de sus puertos.
import { GetOwnContact, GetOwnLocation, GetOwnProfile, UpdateOwnNames, UpdateOwnProfile } from './own-profile.use-cases';
import { DeleteOwnAccount, UpdateOwnEmail, UpdateOwnPassword, UpdateOwnPhone } from './own-credentials.use-cases';
import { CreateReference, ListReferences, RemoveReference, UpdateReference } from './person-references.use-cases';
import { IdentityChecks } from './identity-checks';
import { CatalogChecks } from './catalog-checks';
import { ChangeContactEmail } from './change-contact-email.use-case';
import { AnonymizeAccount } from './anonymize-account.use-case';
import {
  CatalogEntryNotFoundError,
  CatalogEntryUnavailableError,
  CityOutsideDepartmentError,
  ContactInfoNotFoundError,
  ContactNotVerifiedError,
  EmailTakenError,
  PhoneTakenError,
  ReferenceLimitReachedError,
  ReferenceNotFoundError,
  SameEmailError,
  UserNotFoundError,
  UsernameTakenError,
  WrongCurrentPasswordError
} from '../../domain/errors';
import { RecordingAuditTrail, silentLogger } from '../../../../../tests/doubles/settings.doubles';
import { CountingUnitOfWork } from '../../../../../tests/doubles/legal.doubles';
import {
  contact,
  flushNotices,
  InMemoryAccounts,
  InMemoryCatalogs,
  InMemoryConsents,
  InMemoryContacts,
  InMemoryLocations,
  InMemoryPersons,
  InMemoryReferences,
  InMemoryVerifications,
  location,
  PERSON_ID,
  RecordingChangeLog,
  RecordingNotices,
  reference,
  USER_ID
} from '../../../../../tests/doubles/person.doubles';

const OWNER = { userId: USER_ID, personId: PERSON_ID };

function setup() {
  const audit = new RecordingAuditTrail();
  const unitOfWork = new CountingUnitOfWork();
  const accounts = new InMemoryAccounts();
  const persons = new InMemoryPersons();
  const contacts = new InMemoryContacts();
  const locations = new InMemoryLocations([location()]);
  const catalogs = new InMemoryCatalogs();
  const verifications = new InMemoryVerifications();
  const consents = new InMemoryConsents();
  const changeLog = new RecordingChangeLog();
  const notifier = new RecordingNotices();
  const notices = { notifier, logger: silentLogger, logoUrl: 'https://cdn.test/logo.png' };
  const identity = new IdentityChecks(persons, contacts);
  const changeEmail = new ChangeContactEmail(contacts, identity, verifications, changeLog, silentLogger);
  const anonymize = new AnonymizeAccount(persons, contacts, locations, accounts, consents, changeLog);
  return {
    audit, unitOfWork, accounts, persons, contacts, locations, catalogs, verifications, consents, changeLog, notifier, notices,
    identity, changeEmail, anonymize
  };
}

describe('GetOwnProfile', () => {
  it('el perfil con el catálogo de consentimientos, auditado con su acción', async () => {
    const s = setup();
    const result = await new GetOwnProfile(s.accounts, s.consents, s.audit, 'PROFILE_EXTENDED_VIEWED').execute({ userId: USER_ID });

    expect(result.user).toMatchObject({ userId: USER_ID, role: { name: 'CLIENTE' } });
    expect(result.person).toMatchObject({ nationalId: '******4050', gender: { name: 'Femenino' }, documentType: { code: 'CC' } });
    expect(result.contact).toMatchObject({ email: expect.stringContaining('*'), phonePrimaryPrefix: '+57' });
    expect(result.consents).toEqual(s.consents.catalog);
    expect(s.audit.entries).toEqual([{ action: 'PROFILE_EXTENDED_VIEWED', actorId: USER_ID, entityId: USER_ID, entityType: 'User', entityTable: 'users' }]);
  });

  it('sin cuenta: UserNotFoundError y no se audita', async () => {
    const s = setup();
    s.accounts.profile = null;
    await expect(new GetOwnProfile(s.accounts, s.consents, s.audit, 'PROFILE_VIEWED').execute({ userId: USER_ID })).rejects.toThrow(UserNotFoundError);
    expect(s.audit.entries).toEqual([]);
  });
});

describe('GetOwnContact / GetOwnLocation', () => {
  it('el contacto enmascarado; sin contacto, 404', async () => {
    const s = setup();
    const result = await new GetOwnContact(s.contacts, s.audit).execute(OWNER);
    expect(result).toMatchObject({ personContactId: 'pc-1', phonePrimaryFull: expect.stringMatching(/4567$/) });
    expect(s.audit.entries[0]).toMatchObject({ action: 'PROFILE_CONTACT_VIEWED', details: { personId: PERSON_ID } });

    s.contacts.contacts = [];
    await expect(new GetOwnContact(s.contacts, s.audit).execute(OWNER)).rejects.toThrow(ContactInfoNotFoundError);
  });

  it('la ubicación (o null si no tiene) y se audita igual', async () => {
    const s = setup();
    expect(await new GetOwnLocation(s.locations, s.audit).execute(OWNER)).toMatchObject({ city: { name: 'Medellín' } });
    s.locations.locations = [];
    expect(await new GetOwnLocation(s.locations, s.audit).execute(OWNER)).toBeNull();
    expect(s.audit.entries.map(e => e.action)).toEqual(['PROFILE_LOCATION_VIEWED', 'PROFILE_LOCATION_VIEWED']);
  });
});

describe('UpdateOwnProfile', () => {
  const run = (s: ReturnType<typeof setup>, update: object, username: string | null = 'ana') =>
    new UpdateOwnProfile(s.unitOfWork, s.accounts, s.persons, s.locations, new CatalogChecks(s.catalogs), s.changeLog, s.audit, s.notices).execute({
      ...OWNER,
      username,
      firstName: 'Ana',
      update
    });

  it('escribe lo que llega, deja en la bitácora lo que cambió, audita, avisa y devuelve el perfil sin consentimientos', async () => {
    const s = setup();
    const loc = { departmentId: 'dep-ant', cityId: 'city-med', address: 'Calle nueva 123' };
    const result = await run(s, { username: 'ana_2', avatarId: 'av-1', genderId: 'g-m', location: loc, birthDate: new Date('1991-01-02') });

    expect(s.accounts.writes).toEqual([
      { op: 'profile', userId: USER_ID, value: { username: 'ana_2' } },
      { op: 'profile', userId: USER_ID, value: { avatarId: 'av-1' } }
    ]);
    expect(s.persons.updates.map(u => u.changes)).toEqual([{ genderId: 'g-m' }, { birthDate: new Date('1991-01-02') }]);
    expect(s.locations.saved).toEqual([{ personId: PERSON_ID, data: { ...loc, postalCode: undefined, type: undefined } }]);
    expect(s.changeLog.changes.map(c => c.changeType)).toEqual(['gender', 'birth_date', 'location']);
    expect(s.audit.entries[0]).toMatchObject({ action: 'PROFILE_UPDATED', details: { updatedFields: ['username', 'avatarId', 'genderId', 'location', 'birthDate'] } });
    expect(result.consents).toEqual([]);

    await flushNotices();
    expect(s.notifier.sent).toEqual([{ type: 'PROFILE_UPDATED', userId: USER_ID, relatedEntity: null, metadata: { nombre: 'Ana' } }]);
  });

  it('el username de otra cuenta: 409; el propio no se reescribe', async () => {
    const s = setup();
    s.accounts.usernames.set('ocupado', 'otro-user');
    await expect(run(s, { username: 'ocupado' })).rejects.toThrow(UsernameTakenError);

    await run(s, { username: 'ana' });
    expect(s.accounts.writes).toEqual([]);
  });

  it('valida los catálogos: inexistente → 404, inactivo → 400, ciudad de otro departamento → 400', async () => {
    const s = setup();
    s.catalogs.missing.add('av-x');
    s.catalogs.inactive.add('g-x');
    s.catalogs.cities.set('city-bog', 'dep-cun');
    await expect(run(s, { avatarId: 'av-x' })).rejects.toThrow(new CatalogEntryNotFoundError('Avatar no encontrado', 'NOT_FOUND'));
    await expect(run(s, { genderId: 'g-x' })).rejects.toThrow(CatalogEntryUnavailableError);
    await expect(run(s, { location: { departmentId: 'dep-ant', cityId: 'city-bog', address: 'Calle 1' } })).rejects.toThrow(CityOutsideDepartmentError);
    expect(s.audit.entries).toEqual([]);
  });
});

describe('UpdateOwnNames', () => {
  it('cambia los nombres, registra el nombre completo de antes y de ahora, y devuelve la persona', async () => {
    const s = setup();
    const result = await new UpdateOwnNames(s.unitOfWork, s.persons, s.changeLog, s.audit, s.notices).execute({
      ...OWNER,
      firstName: 'Ana',
      names: { firstName: 'Ana', middleName: 'María', lastName: 'Pérez', secondLastName: '' }
    });
    expect(s.changeLog.changes).toEqual([
      { userId: USER_ID, changedByUserId: USER_ID, changedByRole: 'user', changeType: 'name', previousValue: 'Ana Pérez', newValue: 'Ana María Pérez' }
    ]);
    expect(result).toMatchObject({ firstName: 'Ana', middleName: 'María', secondLastName: null });
  });

  it('sin cambio real no hay bitácora', async () => {
    const s = setup();
    await new UpdateOwnNames(s.unitOfWork, s.persons, s.changeLog, s.audit, s.notices).execute({
      ...OWNER,
      firstName: 'Ana',
      names: { firstName: 'Ana', lastName: 'Pérez' }
    });
    expect(s.changeLog.changes).toEqual([]);
    expect(s.audit.entries).toHaveLength(1);
  });
});

describe('UpdateOwnEmail', () => {
  const run = (s: ReturnType<typeof setup>, email: string, currentPassword = 'Correcta#2026') =>
    new UpdateOwnEmail(s.unitOfWork, s.accounts, s.changeEmail, s.audit, s.notices).execute({ ...OWNER, firstName: 'Ana', email, currentPassword });

  it('con la contraseña y el OTP confirmado: cambia, registra, consume el código y responde enmascarado', async () => {
    const s = setup();
    s.verifications.verified.add('email:nueva@correo.co');
    const result = await run(s, 'nueva@correo.co');

    expect(s.contacts.contacts[0]).toMatchObject({ email: 'nueva@correo.co', emailVerifiedAt: expect.any(Date) });
    expect(s.changeLog.changes[0]).toMatchObject({ changeType: 'email', previousValue: 'ana@correo.co', newValue: 'nueva@correo.co', changeReason: 'Email actualizado por cliente' });
    expect(s.audit.entries[0]).toMatchObject({ action: 'PROFILE_EMAIL_UPDATED', details: { newEmail: 'nueva@correo.co' } });
    expect(result.newEmail).toContain('*');
    await flushNotices();
    expect(s.verifications.consumed).toEqual(['email:nueva@correo.co']);
    expect(s.notifier.sent[0]).toMatchObject({ type: 'EMAIL_UPDATED' });
  });

  it('contraseña equivocada → 400 antes de tocar nada; sin OTP → 403; email de otra persona → 409; el mismo → 400', async () => {
    const s = setup();
    await expect(run(s, 'nueva@correo.co', 'mala')).rejects.toThrow(WrongCurrentPasswordError);
    expect(s.unitOfWork.runs).toBe(0);
    await expect(run(s, 'nueva@correo.co')).rejects.toThrow(new ContactNotVerifiedError('email'));

    s.contacts.contacts.push(contact({ personContactId: 'pc-2', personId: 'p-2', email: 'otra@correo.co' }));
    s.verifications.verified.add('email:otra@correo.co');
    await expect(run(s, 'otra@correo.co')).rejects.toThrow(EmailTakenError);

    s.verifications.verified.add('email:ana@correo.co');
    await expect(run(s, 'ana@correo.co')).rejects.toThrow(SameEmailError);
  });
});

describe('UpdateOwnPhone', () => {
  const run = (s: ReturnType<typeof setup>, newPhone: string) =>
    new UpdateOwnPhone(s.unitOfWork, s.contacts, s.identity, s.verifications, s.changeLog, s.audit, s.notices, silentLogger).execute({
      ...OWNER,
      firstName: 'Ana',
      newPhone,
      phonePrefixId: 'pp-57',
      phoneType: 'secondary'
    });

  it('confirmado por OTP: cambia el secundario y lo registra', async () => {
    const s = setup();
    s.verifications.verified.add('phone:3110000000');
    const result = await run(s, '3110000000');
    expect(s.contacts.updates[0]?.changes).toMatchObject({ phoneSecondary: '3110000000', phoneSecondaryPrefixId: 'pp-57' });
    expect(s.changeLog.changes[0]).toMatchObject({ changeType: 'phone', previousValue: null, changeReason: 'Teléfono secondary actualizado' });
    expect(result).toMatchObject({ phoneType: 'secondary', phone: '******0000', phonePrefixId: 'pp-57' });
  });

  it('sin OTP → 403; el teléfono de otra persona → 409', async () => {
    const s = setup();
    await expect(run(s, '3110000000')).rejects.toThrow(new ContactNotVerifiedError('phone'));
    s.contacts.contacts.push(contact({ personContactId: 'pc-2', personId: 'p-2', phonePrimary: '3220000000' }));
    s.verifications.verified.add('phone:3220000000');
    await expect(run(s, '3220000000')).rejects.toThrow(PhoneTakenError);
  });
});

describe('UpdateOwnPassword', () => {
  it('con la contraseña actual: guarda la nueva, la registra oculta y audita', async () => {
    const s = setup();
    const result = await new UpdateOwnPassword(s.unitOfWork, s.accounts, s.changeLog, s.audit, s.notices).execute({
      userId: USER_ID,
      firstName: 'Ana',
      currentPassword: 'Correcta#2026',
      newPassword: 'Nueva#Clave2026'
    });
    expect(result).toBeNull();
    expect(s.accounts.writes).toEqual([{ op: 'password', userId: USER_ID, value: 'Nueva#Clave2026' }]);
    expect(s.changeLog.changes[0]).toMatchObject({ changeType: 'password', previousValue: 'hidden', newValue: 'hidden' });
    expect(s.audit.entries[0]?.action).toBe('PASSWORD_CHANGED');
  });
});

describe('DeleteOwnAccount', () => {
  it('ofusca persona, usuario y contacto, borra la dirección, revoca consentimientos y avisa al email', async () => {
    const s = setup();
    const result = await new DeleteOwnAccount(s.unitOfWork, s.accounts, s.anonymize, s.audit, s.notices).execute({
      ...OWNER,
      nationalId: '1020304050',
      email: 'ana@correo.co',
      firstName: 'Ana',
      currentPassword: 'Correcta#2026'
    });

    expect(result).toBeNull();
    expect(s.persons.persons[0]).toMatchObject({ firstName: 'ELIMINADO', nationalId: expect.stringMatching(/^deleted_\d+_1020$/), birthDate: null });
    expect(s.accounts.writes).toEqual([{ op: 'deleted', userId: USER_ID, value: expect.stringMatching(/^deleted_\d+_ana$/) }]);
    expect(s.contacts.contacts[0]).toMatchObject({ email: expect.stringMatching(/@deleted\.invalid$/), phonePrimary: expect.stringMatching(/^0000000000/) });
    expect(s.locations.erased).toEqual([PERSON_ID]);
    expect(s.consents.revoked).toEqual([USER_ID]);
    expect(s.changeLog.changes[0]).toMatchObject({ changeType: 'account_status', newValue: 'eliminated', changeReason: 'Cuenta eliminada por el usuario' });
    expect(s.audit.entries[0]?.action).toBe('ACCOUNT_DELETED');
    await flushNotices();
    expect(s.notifier.emails).toEqual([{ type: 'CUENTA_ELIMINADA', email: 'ana@correo.co', metadata: { nombre: 'Ana', email: 'ana@correo.co' } }]);
  });

  it('contraseña equivocada: no se toca nada', async () => {
    const s = setup();
    await expect(
      new DeleteOwnAccount(s.unitOfWork, s.accounts, s.anonymize, s.audit, s.notices).execute({ ...OWNER, nationalId: null, currentPassword: 'mala' })
    ).rejects.toThrow(WrongCurrentPasswordError);
    expect(s.persons.updates).toEqual([]);
    expect(s.accounts.writes).toEqual([]);
  });
});

describe('referencias', () => {
  it('lista las vigentes (teléfono del tercero enmascarado) y audita la cantidad', async () => {
    const audit = new RecordingAuditTrail();
    const refs = new InMemoryReferences([reference(), reference({ personReferenceId: 'ref-x', isActive: false })]);
    const result = await new ListReferences(refs, audit).execute(OWNER);
    expect(result).toEqual([expect.objectContaining({ personReferenceId: 'ref-1', referencePhone: '******6543' })]);
    expect(audit.entries[0]).toMatchObject({ action: 'PROFILE_REFERENCES_VIEWED', details: { count: 1 }, entityTable: 'person_references' });
  });

  it('crea hasta 5 vigentes', async () => {
    const audit = new RecordingAuditTrail();
    const refs = new InMemoryReferences();
    const data = { referenceName: 'Luis', referencePhone: '3001112222', referenceType: 'conocido' as const };
    for (let i = 0; i < 5; i++) {
      await new CreateReference(refs, audit).execute({ ...OWNER, data });
    }
    await expect(new CreateReference(refs, audit).execute({ ...OWNER, data })).rejects.toThrow(ReferenceLimitReachedError);
    expect(audit.entries).toHaveLength(5);
  });

  it('actualiza con el antes y el después en la auditoría; borra de forma lógica; 404 si no es suya', async () => {
    const audit = new RecordingAuditTrail();
    const refs = new InMemoryReferences([reference()]);
    const updated = await new UpdateReference(refs, audit).execute({ ...OWNER, referenceId: 'ref-1', changes: { referenceName: 'Luis Ruiz' } });
    expect(updated).toMatchObject({ referenceName: 'Luis Ruiz' });
    expect(audit.entries[0]?.details).toEqual({
      before: { referenceName: 'Luis Gómez', referencePhone: '3109876543', referenceType: 'familiar' },
      after: { referenceName: 'Luis Ruiz', referencePhone: '3109876543', referenceType: 'familiar' }
    });

    await new RemoveReference(refs, audit).execute({ ...OWNER, referenceId: 'ref-1' });
    expect(refs.references[0]?.isActive).toBe(false);
    await expect(new RemoveReference(refs, audit).execute({ ...OWNER, referenceId: 'ref-1' })).rejects.toThrow(ReferenceNotFoundError);
    await expect(
      new UpdateReference(refs, audit).execute({ userId: USER_ID, personId: 'otra', referenceId: 'ref-1', changes: {} })
    ).rejects.toThrow(ReferenceNotFoundError);
  });
});

describe('CatalogChecks', () => {
  it('tipo de documento inactivo → "no disponible"', async () => {
    const catalogs = new InMemoryCatalogs();
    catalogs.inactive.add('dt-x');
    await expect(new CatalogChecks(catalogs).assertDocumentType('dt-x')).rejects.toThrow('Tipo de documento no disponible');
  });
});
