// La salida de cada constructor de person (application/dto) cumple su esquema (y por lo tanto su documentación).
import { PersonContactSchema, PersonLocationSchema, PersonSchema, UserSchema } from '../../../../../shared/presentation/validation/account.schemas';
import { PersonReferenceSchema } from './person-components.response';
import {
  AdminEmailChangedSchema,
  AdminMfaDisabledSchema,
  AdminNationalIdChangedSchema,
  AdminPasswordResetSchema,
  AdminRoleChangedSchema,
  AdminUserCreatedSchema,
  AdminUserDetailSchema,
  AdminUserListItemSchema,
  AdminUserStatusSchema
} from './admin-person.response';
import { EmailUpdatedSchema, NamesUpdatedSchema, PhoneUpdatedSchema, profileSchema } from './profile.response';
import { MyConsentCatalogItemSchema } from '../../../../legal/presentation/http/responses/legal.response';
import { toContactOutput, toLocationOutput, toPersonOutput, toUserOutput } from '../../../../../shared/application/account-views';
import { toReferenceOutput } from '../../../application/dto/person.output';
import {
  toAccountCreatedOutput,
  toAccountDetailOutput,
  toAccountListItemOutput,
  toAccountStatusOutput,
  toEmailChangedOutput,
  toMfaDisabledOutput,
  toNationalIdChangedOutput,
  toPasswordResetOutput,
  toRoleChangedOutput
} from '../../../application/dto/admin-person.output';
import { toEmailUpdatedOutput, toNamesUpdatedOutput, toPhoneUpdatedOutput, toProfileOutput } from '../../../application/dto/profile.output';
import type { AccountTarget, ClientAccount } from '../../../domain/client-account';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const at = new Date('2026-01-01T00:00:00Z');
const country = { countryId: ID, name: 'Colombia', code: 'COL', iconUrl: null };
const role = { roleId: ID, name: 'CLIENTE', description: null, isActive: true, createdAt: at, updatedAt: at };
const contact = {
  personContactId: ID,
  personId: ID,
  email: 'ana@correo.co',
  emailVerifiedAt: at,
  phonePrimary: '3001234567',
  phonePrimaryPrefixId: ID,
  phonePrimaryPrefix: { prefix: '+57' },
  phonePrimaryVerifiedAt: null,
  phoneSecondary: null,
  phoneSecondaryPrefixId: null,
  phoneSecondaryVerifiedAt: null,
  phoneSecondaryPrefix: null,
  createdAt: at,
  updatedAt: at
};
const location = {
  personLocationId: ID,
  personId: ID,
  address: 'Calle 1',
  postalCode: null,
  type: 'home',
  countryId: ID,
  departmentId: ID,
  cityId: ID,
  country,
  department: { departmentId: ID, name: 'Antioquia', daneCode: '05' },
  city: { cityId: ID, name: 'Medellín', daneCode: '001' }
};
const person = {
  personId: ID,
  firstName: 'Ana',
  lastName: 'Pérez',
  middleName: null,
  secondLastName: null,
  nationalId: '1020304050',
  birthDate: at,
  genderId: ID,
  countryId: ID,
  documentTypeId: ID,
  createdAt: at,
  updatedAt: at,
  gender: { genderId: ID, name: 'Femenino' },
  documentType: { documentTypeId: ID, code: 'CC', name: 'Cédula' },
  country,
  contact,
  location
};
const user: ClientAccount = {
  userId: ID,
  username: 'ana',
  personId: ID,
  roleId: ID,
  avatarId: ID,
  isActive: true,
  deletedAt: null,
  totpEnabled: false,
  smsMfaEnabled: false,
  preferredMfaMethod: 'none',
  privacyPolicyVersion: '1.0',
  privacyPolicyAcceptedAt: at,
  privacyPolicyAcceptedIp: '1.1.1.1',
  createdAt: at,
  updatedAt: at,
  role,
  avatar: { avatarId: ID, name: 'Gato', imageUrl: null, theme: { avatarThemeId: ID, name: 'Animales' } },
  person
};
const target: AccountTarget = {
  userId: ID,
  username: 'ana',
  roleId: ID,
  isActive: true,
  deletedAt: null,
  totpEnabled: true,
  smsMfaEnabled: false,
  preferredMfaMethod: 'totp',
  person: { personId: ID, firstName: 'Ana', nationalId: '1020304050', contact: { personContactId: ID, email: 'ana@correo.co' } },
  role: { roleId: ID, name: 'CLIENTE', description: null }
};

const ok = (schema: { safeParse(v: unknown): { error?: { issues: unknown[] } } }, value: unknown) =>
  expect(schema.safeParse(value).error?.issues ?? []).toEqual([]);

describe('esquemas de salida de person', () => {
  it('componentes: contacto, ubicación, usuario, persona y referencia', () => {
    ok(PersonContactSchema, toContactOutput(contact));
    ok(PersonLocationSchema, toLocationOutput(location));
    ok(UserSchema, toUserOutput(user, { includeRole: true, includeAvatar: true }));
    ok(
      PersonSchema,
      toPersonOutput(
        { ...person, user },
        {
          includeContact: true,
          includeLocation: true,
          includeGender: true,
          includeNationality: true,
          includeDocumentType: true,
          includeUser: true
        }
      )
    );
    ok(
      PersonReferenceSchema,
      toReferenceOutput({ personReferenceId: ID, referenceName: 'Luis', referencePhone: '3001234567', referenceType: 'familiar', createdAt: at })
    );
  });

  it('admin: detalle, listado y acciones sobre la cuenta', () => {
    ok(AdminUserDetailSchema, toAccountDetailOutput(user));
    ok(AdminUserListItemSchema, toAccountListItemOutput(user));
    ok(AdminUserCreatedSchema, toAccountCreatedOutput(user, 'Temp#1234'));
    ok(AdminPasswordResetSchema, toPasswordResetOutput(target));
    ok(AdminEmailChangedSchema, toEmailChangedOutput(target, 'a@b.co', 'c@d.co'));
    ok(AdminNationalIdChangedSchema, toNationalIdChangedOutput(target, '123456', '654321'));
    ok(AdminUserStatusSchema, toAccountStatusOutput(target, false, 'deactivate'));
    ok(AdminMfaDisabledSchema, toMfaDisabledOutput(target));
    ok(AdminRoleChangedSchema, toRoleChangedOutput(target, target.role, role));
  });

  it('perfil propio y sus actualizaciones', () => {
    const consentItem = {
      consentType: { consentTypeId: ID, code: 'PRIVACY_POLICY', name: 'Política', isMandatory: true, isRevocable: false },
      granted: false,
      userConsentId: null,
      privacyPolicy: null,
      grantedAt: null,
      revokedAt: null,
      isCurrent: null
    };
    ok(profileSchema(MyConsentCatalogItemSchema), toProfileOutput(user, [consentItem]));
    ok(EmailUpdatedSchema, toEmailUpdatedOutput('ana@correo.co', at));
    ok(PhoneUpdatedSchema, toPhoneUpdatedOutput('3001234567', ID, 'primary', at));
    ok(
      NamesUpdatedSchema,
      toNamesUpdatedOutput({ personId: ID, firstName: 'Ana', middleName: null, lastName: 'Pérez', secondLastName: null, updatedAt: at })
    );
  });
});
