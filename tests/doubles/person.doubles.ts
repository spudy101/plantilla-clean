// tests/doubles/person.doubles.ts
//
// Dobles en memoria de los puertos de person, para los tests de los casos de uso (sin jest.mock, sin Prisma),
// y fábricas de entidades de ejemplo.
import type { PageRequest } from '../../src/shared/application/pagination';
import type { EmailNotification, EmailNotifier, Notification, Notifier } from '../../src/shared/application/ports/notifier.port';
import type { AccountChangeEntry, AccountChangeLog } from '../../src/modules/person/application/ports/account-change-log.port';
import type { AccountListFilters, ClientAccounts, NewAccount, RoleDirectory } from '../../src/modules/person/application/ports/client-accounts.port';
import type { ContactKind, ContactVerifications } from '../../src/modules/person/application/ports/contact-verifications.port';
import type { DualApprovalGate, GateResult } from '../../src/modules/person/application/ports/dual-approval.port';
import type { CatalogValue, ProfileCatalogs } from '../../src/modules/person/application/ports/profile-catalogs.port';
import type { ConsentCatalogItem, ProfileConsents } from '../../src/modules/person/application/ports/profile-consents.port';
import type { PersonContactRepository } from '../../src/modules/person/application/ports/person-contact-repository.port';
import type { PersonLocationRepository } from '../../src/modules/person/application/ports/person-location-repository.port';
import type { PersonReferenceRepository } from '../../src/modules/person/application/ports/person-reference-repository.port';
import type { PersonRepository } from '../../src/modules/person/application/ports/person-repository.port';
import type { AccountTarget, ClientAccount, MfaShutdown, RoleRef } from '../../src/modules/person/domain/client-account';
import type { NewPerson, Person, PersonChanges } from '../../src/modules/person/domain/person';
import type { ContactChanges, NewPersonContact, PersonContact, PersonContactWithPrefixes } from '../../src/modules/person/domain/person-contact';
import type { LocationData, PersonLocationWithPlaces } from '../../src/modules/person/domain/person-location';
import type { PersonReference, ReferenceData } from '../../src/modules/person/domain/person-reference';

export const USER_ID = '6f1f0a7e-3b8a-4d63-9a59-2f0c2b9b1c11';
export const PERSON_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
export const ADMIN_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
export const CLIENT_ROLE: RoleRef = { roleId: 'role-cliente', name: 'CLIENTE', description: 'Cliente' };
export const ADMIN_ROLE: RoleRef = { roleId: 'role-admin', name: 'ADMIN', description: 'Administrador' };
const AT = new Date('2026-01-01T00:00:00Z');

export const ADMIN_CTX = { adminUserId: ADMIN_ID, adminRoleName: 'ADMIN', adminFirstName: 'Admin', ipAddress: '10.0.0.1', userAgent: 'jest' };

export const person = (over: Partial<Person> = {}): Person => ({
  personId: PERSON_ID,
  firstName: 'Ana',
  middleName: null,
  lastName: 'Pérez',
  secondLastName: null,
  nationalId: '1020304050',
  documentTypeId: 'dt-cc',
  birthDate: new Date('1990-05-10T00:00:00Z'),
  genderId: 'g-f',
  countryId: 'co',
  createdAt: AT,
  updatedAt: AT,
  ...over
});

export const contact = (over: Partial<PersonContact> = {}): PersonContact => ({
  personContactId: 'pc-1',
  personId: PERSON_ID,
  email: 'ana@correo.co',
  emailVerifiedAt: AT,
  phonePrimary: '3001234567',
  phonePrimaryPrefixId: 'pp-57',
  phonePrimaryVerifiedAt: AT,
  phoneSecondary: null,
  phoneSecondaryPrefixId: null,
  phoneSecondaryVerifiedAt: null,
  createdAt: AT,
  updatedAt: AT,
  ...over
});

export const location = (over: Partial<PersonLocationWithPlaces> = {}): PersonLocationWithPlaces => ({
  personLocationId: 'pl-1',
  personId: PERSON_ID,
  countryId: 'co',
  departmentId: 'dep-ant',
  cityId: 'city-med',
  address: 'Calle 1 # 2-3',
  postalCode: null,
  type: 'home',
  country: { countryId: 'co', name: 'Colombia', code: 'COL', iconUrl: null },
  department: { departmentId: 'dep-ant', name: 'Antioquia', daneCode: '05' },
  city: { cityId: 'city-med', name: 'Medellín', daneCode: '001' },
  ...over
});

export const reference = (over: Partial<PersonReference> = {}): PersonReference => ({
  personReferenceId: 'ref-1',
  personId: PERSON_ID,
  referenceName: 'Luis Gómez',
  referencePhone: '3109876543',
  referenceType: 'familiar',
  isActive: true,
  createdAt: AT,
  updatedAt: AT,
  ...over
});

/** Una cuenta de cliente con su perfil completo. */
export const account = (over: Partial<ClientAccount> = {}): ClientAccount => ({
  userId: USER_ID,
  username: 'ana',
  personId: PERSON_ID,
  roleId: CLIENT_ROLE.roleId,
  avatarId: null,
  isActive: true,
  deletedAt: null,
  totpEnabled: false,
  smsMfaEnabled: false,
  preferredMfaMethod: 'none',
  privacyPolicyVersion: '1.0',
  privacyPolicyAcceptedAt: AT,
  privacyPolicyAcceptedIp: '1.1.1.1',
  createdAt: AT,
  updatedAt: AT,
  role: CLIENT_ROLE,
  avatar: null,
  person: {
    ...person(),
    gender: { genderId: 'g-f', name: 'Femenino' },
    documentType: { documentTypeId: 'dt-cc', code: 'CC', name: 'Cédula' },
    country: { countryId: 'co', name: 'Colombia', code: 'COL', iconUrl: null },
    contact: { ...contact(), phonePrimaryPrefix: { prefix: '+57' }, phoneSecondaryPrefix: null },
    location: location()
  },
  ...over
});

/** La misma cuenta, como la lee una acción del panel. */
export const target = (over: Partial<AccountTarget> = {}): AccountTarget => ({
  userId: USER_ID,
  username: 'ana',
  roleId: CLIENT_ROLE.roleId,
  isActive: true,
  deletedAt: null,
  totpEnabled: false,
  smsMfaEnabled: false,
  preferredMfaMethod: 'none',
  person: { personId: PERSON_ID, firstName: 'Ana', nationalId: '1020304050', contact: { personContactId: 'pc-1', email: 'ana@correo.co' } },
  role: CLIENT_ROLE,
  ...over
});

// ── Repositorios de person ─────────────────────────────────────
export class InMemoryPersons implements PersonRepository {
  constructor(public persons: Person[] = [person()]) {}
  readonly updates: Array<{ personId: string; changes: PersonChanges }> = [];

  async findById(personId: string) {
    return this.persons.find(p => p.personId === personId) ?? null;
  }
  async findByNationalId(nationalId: string) {
    return this.persons.find(p => p.nationalId === nationalId) ?? null;
  }
  async create(data: NewPerson) {
    const created = person({ ...data, personId: `p-${this.persons.length + 1}`, birthDate: (data.birthDate as Date | null) ?? null } as Partial<Person>);
    this.persons.push(created);
    return created;
  }
  async update(personId: string, changes: PersonChanges) {
    this.updates.push({ personId, changes });
    this.persons = this.persons.map(p => (p.personId === personId ? { ...p, ...changes } : p));
  }
}

export class InMemoryContacts implements PersonContactRepository {
  constructor(public contacts: PersonContact[] = [contact()]) {}
  readonly updates: Array<{ personContactId: string; changes: ContactChanges }> = [];

  async findByPersonId(personId: string) {
    return this.contacts.find(c => c.personId === personId) ?? null;
  }
  async findByPersonIdWithPrefixes(personId: string): Promise<PersonContactWithPrefixes | null> {
    const found = await this.findByPersonId(personId);
    return found ? { ...found, phonePrimaryPrefix: { prefix: '+57' }, phoneSecondaryPrefix: null } : null;
  }
  async findByEmail(email: string) {
    return this.contacts.find(c => c.email === email) ?? null;
  }
  async findByPrimaryPhone(phone: string) {
    return this.contacts.find(c => c.phonePrimary === phone) ?? null;
  }
  async findBySecondaryPhone(phone: string) {
    return this.contacts.find(c => c.phoneSecondary === phone) ?? null;
  }
  async create(data: NewPersonContact) {
    const created = contact({ ...data, personContactId: `pc-${this.contacts.length + 1}`, emailVerifiedAt: data.emailVerifiedAt ?? null });
    this.contacts.push(created);
    return created;
  }
  async update(personContactId: string, changes: ContactChanges) {
    this.updates.push({ personContactId, changes });
    this.contacts = this.contacts.map(c => (c.personContactId === personContactId ? { ...c, ...changes } : c));
  }
}

export class InMemoryLocations implements PersonLocationRepository {
  constructor(public locations: PersonLocationWithPlaces[] = []) {}
  readonly saved: Array<{ personId: string; data: LocationData }> = [];
  readonly erased: string[] = [];

  async findByPersonId(personId: string) {
    return this.locations.find(l => l.personId === personId) ?? null;
  }
  async save(personId: string, data: LocationData) {
    this.saved.push({ personId, data });
  }
  async eraseAddress(personId: string) {
    this.erased.push(personId);
  }
}

export class InMemoryReferences implements PersonReferenceRepository {
  constructor(public references: PersonReference[] = []) {}

  async listActive(personId: string) {
    return this.references.filter(r => r.personId === personId && r.isActive);
  }
  async findActive(personReferenceId: string, personId: string) {
    return this.references.find(r => r.personReferenceId === personReferenceId && r.personId === personId && r.isActive) ?? null;
  }
  async create(personId: string, data: ReferenceData) {
    const created = reference({ ...data, personId, personReferenceId: `ref-${this.references.length + 1}` });
    this.references.push(created);
    return created;
  }
  async update(personReferenceId: string, changes: Partial<ReferenceData>) {
    const defined = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    this.references = this.references.map(r => (r.personReferenceId === personReferenceId ? { ...r, ...defined } : r));
    return this.references.find(r => r.personReferenceId === personReferenceId) ?? null;
  }
  async deactivate(personReferenceId: string) {
    this.references = this.references.map(r => (r.personReferenceId === personReferenceId ? { ...r, isActive: false } : r));
  }
}

// ── Lo que viene de otros módulos ──────────────────────────────
/** Las cuentas (iam): una sola, configurable. Registra cada escritura. */
export class InMemoryAccounts implements ClientAccounts {
  profile: ClientAccount | null = account();
  actionTarget: AccountTarget | null = target();
  password = 'Correcta#2026';
  usernames = new Map<string, string>([['ana', USER_ID]]);
  listed: ClientAccount[] = [account()];
  readonly lists: Array<{ filters: AccountListFilters; search: string | null }> = [];
  readonly writes: Array<{ op: string; userId: string; value?: unknown }> = [];
  readonly created: NewAccount[] = [];

  async findProfile() {
    return this.profile;
  }
  async list(filters: AccountListFilters, _page: PageRequest, search: string | null) {
    this.lists.push({ filters, search });
    return { rows: this.listed, count: this.listed.length };
  }
  async findTarget() {
    return this.actionTarget;
  }
  async findSummary(userId: string) {
    return this.profile || userId === ADMIN_ID ? { userId, username: this.profile?.username ?? 'admin', firstName: this.profile?.person?.firstName ?? null } : null;
  }
  async passwordMatches(_userId: string, plain: string) {
    return plain === this.password;
  }
  async findUserIdByUsername(username: string) {
    return this.usernames.get(username) ?? null;
  }
  async create(newAccount: NewAccount) {
    this.created.push(newAccount);
    return { userId: 'u-nuevo' };
  }
  async updateProfile(userId: string, changes: { username?: string; avatarId?: string }) {
    this.writes.push({ op: 'profile', userId, value: changes });
  }
  async setPassword(userId: string, plain: string) {
    this.writes.push({ op: 'password', userId, value: plain });
  }
  async setActive(userId: string, isActive: boolean) {
    this.writes.push({ op: 'active', userId, value: isActive });
  }
  async setRole(userId: string, roleId: string) {
    this.writes.push({ op: 'role', userId, value: roleId });
  }
  async shutDownMfa(userId: string, shutdown: MfaShutdown) {
    this.writes.push({ op: 'mfa', userId, value: shutdown });
  }
  async markDeleted(userId: string, username: string) {
    this.writes.push({ op: 'deleted', userId, value: username });
  }
}

export class InMemoryRoles implements RoleDirectory {
  constructor(public roles: RoleRef[] = [CLIENT_ROLE, ADMIN_ROLE]) {}
  async findById(roleId: string) {
    return this.roles.find(r => r.roleId === roleId) ?? null;
  }
  async findByName(name: string) {
    return this.roles.find(r => r.name === name) ?? null;
  }
  async findByNames(names: readonly string[]) {
    return this.roles.filter(r => names.includes(r.name));
  }
}

/** Catálogos: todo existe y está activo salvo lo que se configure. */
export class InMemoryCatalogs implements ProfileCatalogs {
  missing = new Set<string>();
  inactive = new Set<string>();
  /** ciudad → departamento */
  cities = new Map<string, string>([['city-med', 'dep-ant']]);

  private value(id: string): CatalogValue | null {
    return this.missing.has(id) ? null : { isActive: !this.inactive.has(id) };
  }
  async findAvatar(id: string) {
    return this.value(id);
  }
  async findGender(id: string) {
    return this.value(id);
  }
  async findDocumentType(id: string) {
    return this.value(id);
  }
  async findDepartment(departmentId: string) {
    return this.missing.has(departmentId) ? null : { departmentId };
  }
  async findCity(cityId: string) {
    const departmentId = this.cities.get(cityId);
    return departmentId ? { cityId, departmentId } : null;
  }
}

export class InMemoryVerifications implements ContactVerifications {
  verified = new Set<string>();
  readonly consumed: string[] = [];
  async isVerified(kind: ContactKind, value: string) {
    return this.verified.has(`${kind}:${value}`);
  }
  async consume(kind: ContactKind, value: string) {
    this.consumed.push(`${kind}:${value}`);
  }
}

export class InMemoryConsents implements ProfileConsents {
  catalog: ConsentCatalogItem[] = [{ consentType: { code: 'PRIVACY_POLICY' }, granted: true }];
  readonly revoked: string[] = [];
  async catalogFor() {
    return this.catalog;
  }
  async revokeAll(userId: string) {
    this.revoked.push(userId);
  }
}

export class RecordingChangeLog implements AccountChangeLog {
  readonly changes: AccountChangeEntry[] = [];
  async record(change: AccountChangeEntry) {
    this.changes.push(change);
  }
}

export class FakeApprovals implements DualApprovalGate {
  result: GateResult = { pending: false };
  readonly gated: unknown[] = [];
  async gate(operationKey: string, args: unknown) {
    this.gated.push({ operationKey, args });
    return this.result;
  }
}

/** Avisos a usuarios y a direcciones de email. */
export class RecordingNotices implements Notifier, EmailNotifier {
  readonly sent: Notification[] = [];
  readonly emails: EmailNotification[] = [];
  async notify(notification: Notification) {
    this.sent.push(notification);
  }
  async notifyEmail(notification: EmailNotification) {
    this.emails.push(notification);
  }
}

export const fixedPassword = { generate: () => 'Temp#Pass12' };
export const fixedIds = { next: () => 'uuid-fijo' };

/** Espera a que salgan los avisos (se mandan en setImmediate, después de responder). */
export const flushNotices = () =>
  new Promise<void>(resolve => {
    setImmediate(resolve);
  });
