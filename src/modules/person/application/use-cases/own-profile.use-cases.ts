// Casos de uso del perfil propio (el titular sobre su cuenta): verlo, ver su contacto y su ubicación, y
// cambiar los datos de perfil y los nombres.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { UnitOfWork } from '../../../../shared/application/ports/unit-of-work.port';
import type { AccountChangeLog } from '../ports/account-change-log.port';
import type { ClientAccounts } from '../ports/client-accounts.port';
import type { PersonContactRepository } from '../ports/person-contact-repository.port';
import type { PersonLocationRepository } from '../ports/person-location-repository.port';
import type { PersonRepository } from '../ports/person-repository.port';
import type { ProfileConsents } from '../ports/profile-consents.port';
import type { CatalogChecks } from './catalog-checks';
import { sendLater, type NoticeDeps } from './person-notices';
import { USER_AUDIT_ENTITY } from './person-audit';
import { toContactOutput, toLocationOutput } from '../../../../shared/application/account-views';
import { toNamesUpdatedOutput, toProfileOutput } from '../dto/profile.output';
import { fullNameOf, namesChanges, withNames, type NamesInput } from '../../domain/person';
import { locationData, locationSnapshot } from '../../domain/person-location';
import { profileFieldChanges, type ProfileUpdate } from '../../domain/profile-changes';
import { ContactInfoNotFoundError, PersonNotFoundError, UserNotFoundError, UsernameTakenError } from '../../domain/errors';

/** El titular, tal como lo identifica su sesión. */
export interface OwnerRef {
  userId: string;
  personId: string;
}

/** GET /person/profile y /person/profile/extended (hoy el mismo contrato; cada uno con su acción de auditoría). */
export class GetOwnProfile {
  constructor(
    private readonly accounts: ClientAccounts,
    private readonly consents: ProfileConsents,
    private readonly audit: AuditTrail,
    private readonly action: 'PROFILE_VIEWED' | 'PROFILE_EXTENDED_VIEWED'
  ) {}

  async execute({ userId }: { userId: string }) {
    const account = await this.accounts.findProfile(userId);
    if (!account) {
      throw new UserNotFoundError();
    }
    const consents = await this.consents.catalogFor(userId);
    await this.audit.record(this.action, { actorId: userId, entityId: userId, ...USER_AUDIT_ENTITY });
    return toProfileOutput(account, consents);
  }
}

export class GetOwnContact {
  constructor(
    private readonly contacts: PersonContactRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ userId, personId }: OwnerRef) {
    const contact = await this.contacts.findByPersonIdWithPrefixes(personId);
    if (!contact) {
      throw new ContactInfoNotFoundError();
    }
    await this.audit.record('PROFILE_CONTACT_VIEWED', { actorId: userId, details: { personId }, entityId: userId, ...USER_AUDIT_ENTITY });
    return toContactOutput(contact);
  }
}

export class GetOwnLocation {
  constructor(
    private readonly locations: PersonLocationRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ userId, personId }: OwnerRef) {
    const location = await this.locations.findByPersonId(personId);
    await this.audit.record('PROFILE_LOCATION_VIEWED', { actorId: userId, details: { personId }, entityId: userId, ...USER_AUDIT_ENTITY });
    return toLocationOutput(location);
  }
}

export interface UpdateOwnProfileInput extends OwnerRef {
  /** El username y el nombre que tiene la sesión. */
  username: string | null;
  firstName: string | null;
  update: ProfileUpdate;
}

/** PUT /person/profile: username, avatar, género, ubicación y fecha de nacimiento (lo que llegue). */
export class UpdateOwnProfile {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: ClientAccounts,
    private readonly persons: PersonRepository,
    private readonly locations: PersonLocationRepository,
    private readonly catalogs: CatalogChecks,
    private readonly changeLog: AccountChangeLog,
    private readonly audit: AuditTrail,
    private readonly notices: NoticeDeps
  ) {}

  async execute({ userId, personId, username, firstName, update }: UpdateOwnProfileInput) {
    const [person, location] = await Promise.all([this.persons.findById(personId), this.locations.findByPersonId(personId)]);
    const before = { genderId: person?.genderId ?? null, birthDate: person?.birthDate ?? null, location: locationSnapshot(location) };

    await this.unitOfWork.run(async () => {
      if (update.username && update.username !== username) {
        const owner = await this.accounts.findUserIdByUsername(update.username);
        if (owner && owner !== userId) {
          throw new UsernameTakenError();
        }
        await this.accounts.updateProfile(userId, { username: update.username });
      }
      if (update.avatarId) {
        await this.catalogs.assertAvatar(update.avatarId);
        await this.accounts.updateProfile(userId, { avatarId: update.avatarId });
      }
      if (update.genderId) {
        await this.catalogs.assertGender(update.genderId);
        await this.persons.update(personId, { genderId: update.genderId });
      }
      if (update.location) {
        await this.catalogs.assertLocation(update.location);
        await this.locations.save(personId, locationData(update.location));
      }
      if (update.birthDate) {
        await this.persons.update(personId, { birthDate: update.birthDate });
      }

      for (const change of profileFieldChanges(update, before)) {
        await this.changeLog.record({ userId, changedByUserId: userId, changedByRole: 'user', ...change });
      }
    });

    await this.audit.record('PROFILE_UPDATED', {
      actorId: userId,
      details: { updatedFields: Object.keys(update) },
      entityId: userId,
      ...USER_AUDIT_ENTITY
    });
    sendLater(
      this.notices,
      [{ to: 'user', type: 'PROFILE_UPDATED', userId, metadata: { nombre: firstName }, failure: 'Error enviando notificacion profile updated' }],
      { userId }
    );

    const updated = await this.accounts.findProfile(userId);
    if (!updated) {
      throw new UserNotFoundError();
    }
    return toProfileOutput(updated);
  }
}

export interface UpdateOwnNamesInput extends OwnerRef {
  firstName: string | null;
  names: NamesInput;
}

/** PUT /person/profile/names. En la plantilla no hay validación de identidad: los nombres se editan libremente. */
export class UpdateOwnNames {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly persons: PersonRepository,
    private readonly changeLog: AccountChangeLog,
    private readonly audit: AuditTrail,
    private readonly notices: NoticeDeps
  ) {}

  async execute({ userId, personId, firstName, names }: UpdateOwnNamesInput) {
    await this.unitOfWork.run(async () => {
      const before = await this.persons.findById(personId);
      if (!before) {
        throw new PersonNotFoundError();
      }
      const changes = namesChanges(names);
      await this.persons.update(personId, changes);

      const previousName = fullNameOf(before);
      const newName = fullNameOf(withNames(before, changes));
      if (previousName !== newName) {
        await this.changeLog.record({
          userId,
          changedByUserId: userId,
          changedByRole: 'user',
          changeType: 'name',
          previousValue: previousName,
          newValue: newName
        });
      }
    });

    await this.audit.record('PROFILE_UPDATED', { actorId: userId, details: { updatedFields: Object.keys(names) }, entityId: userId, ...USER_AUDIT_ENTITY });
    sendLater(
      this.notices,
      [{ to: 'user', type: 'PROFILE_UPDATED', userId, metadata: { nombre: firstName }, failure: 'Error enviando notificacion profile updated' }],
      { userId }
    );

    const updated = await this.persons.findById(personId);
    if (!updated) {
      throw new PersonNotFoundError();
    }
    return toNamesUpdatedOutput(updated);
  }
}
