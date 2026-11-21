// La salida de cada constructor de person cumple su esquema (y por lo tanto su documentación).
import components, {
  PersonContactSchema,
  PersonLocationSchema,
  PersonReferenceSchema,
  PersonSchema,
  UserSchema
} from './person-components.response';
import adminDto, {
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
import profileDto, { EmailUpdatedSchema, NamesUpdatedSchema, PhoneUpdatedSchema, ProfileSchema } from './profile.response';

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
  phoneSecondaryVerifiedAt: null
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
const user = {
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

const ok = (schema: { safeParse(v: unknown): { error?: { issues: unknown[] } } }, value: unknown) =>
  expect(schema.safeParse(value).error?.issues ?? []).toEqual([]);

describe('esquemas de salida de person', () => {
  it('componentes: contacto, ubicación, usuario, persona y referencia', () => {
    ok(PersonContactSchema, components.PersonContactComponent.build(contact));
    ok(PersonLocationSchema, components.PersonLocationComponent.build(location));
    ok(UserSchema, components.UserComponent.build(user, { includeRole: true, includeAvatar: true }));
    ok(
      PersonSchema,
      components.PersonComponent.build(person, {
        includeContact: true,
        includeLocation: true,
        includeGender: true,
        includeNationality: true,
        includeDocumentType: true,
        includeUser: true
      })
    );
    ok(
      PersonReferenceSchema,
      components.PersonReferenceComponent.build({
        personReferenceId: ID,
        referenceName: 'Luis',
        referencePhone: '3001234567',
        referenceType: 'familiar',
        createdAt: at
      })
    );
  });

  it('admin: detalle, listado y acciones sobre la cuenta', () => {
    ok(AdminUserDetailSchema, adminDto.UserDTO(user as never));
    ok(AdminUserListItemSchema, adminDto.UserListItemDTO(user as never));
    ok(AdminUserCreatedSchema, adminDto.CreateUserDTO(user as never, 'Temp#1234'));
    ok(
      AdminPasswordResetSchema,
      adminDto.ResetPasswordDTO({ userId: ID, username: 'ana', person: { contact: { email: 'ana@correo.co' } } })
    );
    ok(AdminEmailChangedSchema, adminDto.ChangeEmailDTO({ userId: ID, username: 'ana' }, 'a@b.co', 'c@d.co'));
    ok(AdminNationalIdChangedSchema, adminDto.ChangeNationalIdDTO({ userId: ID, username: 'ana' }, '123456', '654321'));
    ok(AdminUserStatusSchema, adminDto.ToggleUserStatusDTO({ userId: ID, username: 'ana', isActive: false }, 'deactivate'));
    ok(
      AdminMfaDisabledSchema,
      adminDto.DisableMFADTO({
        userId: ID,
        username: 'ana',
        totpEnabled: false,
        smsMfaEnabled: false,
        preferredMfaMethod: 'none'
      })
    );
    ok(AdminRoleChangedSchema, adminDto.ChangeRoleDTO({ userId: ID, username: 'ana' }, role, role));
  });

  it('perfil propio y sus actualizaciones', () => {
    const consentType = {
      consentTypeId: ID,
      code: 'PRIVACY_POLICY',
      name: 'Política',
      description: null,
      isMandatory: true,
      isRevocable: false,
      isActive: true,
      scope: 'client'
    };
    ok(ProfileSchema, profileDto.BasicProfileDTO(user as never, [consentType as never], []));
    ok(EmailUpdatedSchema, profileDto.UpdateEmailResponseDTO('ana@correo.co', at));
    ok(PhoneUpdatedSchema, profileDto.UpdatePhoneResponseDTO('3001234567', ID, 'primary', at));
    ok(
      NamesUpdatedSchema,
      profileDto.UpdateNamesResponseDTO({
        personId: ID,
        firstName: 'Ana',
        middleName: null,
        lastName: 'Pérez',
        secondLastName: null,
        updatedAt: at
      })
    );
  });
});
