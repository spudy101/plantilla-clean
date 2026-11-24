// Reglas del dominio person: TypeScript puro, sin dobles.
import { assertNationalIdForRole, fullNameOf, namesChanges, withNames } from './person';
import { belongsToAnother, emailChanges, phoneChanges, phoneOf } from './person-contact';
import { assertCityInDepartment, locationData, locationSnapshot } from './person-location';
import { assertCanAddReference, editedReference, MAX_REFERENCES_PER_PERSON } from './person-reference';
import { anonymizeAccount, deletedEmail, deletedNationalId, deletedPhone, deletedUsername } from './account-deletion';
import {
  assertClientAccount,
  assertClientRoleChange,
  assertNotDeleted,
  assertStatusChange,
  isClientRole,
  mfaShutdown,
  requirePerson
} from './client-account';
import { profileFieldChanges } from './profile-changes';
import {
  AccountDeletedError,
  AccountStatusUnchangedError,
  AccountWithoutPersonError,
  CityOutsideDepartmentError,
  InvalidNationalIdError,
  MfaNotEnabledError,
  NotAClientAccountError,
  NotAClientRoleError,
  ReferenceLimitReachedError,
  SameEmailError,
  SameRoleError
} from './errors';
import { contact, location } from '../../../../tests/doubles/person.doubles';

const AT = new Date('2026-03-04T05:06:07.890Z');

describe('nombres de la persona', () => {
  it('fullNameOf une las partes que tienen valor', () => {
    expect(fullNameOf({ firstName: 'Ana', middleName: null, lastName: 'Pérez', secondLastName: 'Gómez' })).toBe('Ana Pérez Gómez');
    expect(fullNameOf(null)).toBe('');
  });

  it('namesChanges solo trae las claves presentes y convierte "" en null en los opcionales', () => {
    expect(namesChanges({ firstName: 'Ana' })).toEqual({ firstName: 'Ana' });
    expect(namesChanges({ firstName: 'Ana', lastName: 'Ruiz', middleName: '', secondLastName: null })).toEqual({
      firstName: 'Ana',
      lastName: 'Ruiz',
      middleName: null,
      secondLastName: null
    });
  });

  it('withNames aplica los cambios y conserva lo demás (un null explícito limpia)', () => {
    const before = { firstName: 'Ana', middleName: 'María', lastName: 'Pérez', secondLastName: 'Gómez' };
    expect(withNames(before, { lastName: 'Ruiz', middleName: null })).toEqual({ firstName: 'Ana', middleName: null, lastName: 'Ruiz', secondLastName: 'Gómez' });
  });
});

describe('documento según el rol', () => {
  it('un cliente solo necesita que venga', () => {
    expect(() => assertNationalIdForRole('12.345.678-9', 'CLIENTE')).not.toThrow();
    expect(() => assertNationalIdForRole('', 'CLIENTE')).toThrow(new InvalidNationalIdError('National ID es requerido'));
  });

  it('un admin usa un identificador interno: letras, números, guiones', () => {
    expect(() => assertNationalIdForRole('SYS-01_a', 'ADMIN')).not.toThrow();
    expect(() => assertNationalIdForRole('SYS 01', 'admin')).toThrow('National ID solo puede contener letras, números, guiones y guiones bajos');
    expect(() => assertNationalIdForRole('', 'ADMIN')).toThrow('National ID debe ser un texto válido');
  });
});

describe('contacto', () => {
  it('phoneOf y phoneChanges por tipo de teléfono', () => {
    const c = contact({ phoneSecondary: '3110000000' });
    expect(phoneOf(c, 'primary')).toBe('3001234567');
    expect(phoneOf(c, 'secondary')).toBe('3110000000');
    expect(phoneChanges('3009999999', 'pp-1', 'secondary', AT)).toEqual({
      phoneSecondary: '3009999999',
      phoneSecondaryPrefixId: 'pp-1',
      phoneSecondaryVerifiedAt: AT
    });
  });

  it('cambiar el email por el mismo no es un cambio', () => {
    expect(() => emailChanges(contact(), 'ana@correo.co', AT)).toThrow(SameEmailError);
    expect(emailChanges(contact(), 'nuevo@correo.co', AT)).toEqual({ email: 'nuevo@correo.co', emailVerifiedAt: AT });
  });

  it('belongsToAnother ignora el contacto de la propia persona', () => {
    expect(belongsToAnother(null, 'p-1')).toBe(false);
    expect(belongsToAnother({ personId: 'p-1' }, 'p-1')).toBe(false);
    expect(belongsToAnother({ personId: 'p-2' }, 'p-1')).toBe(true);
    expect(belongsToAnother({ personId: 'p-2' }, null)).toBe(true);
  });
});

describe('ubicación', () => {
  it('la ciudad debe ser del departamento', () => {
    expect(() => assertCityInDepartment({ departmentId: 'd-1' }, 'd-1')).not.toThrow();
    expect(() => assertCityInDepartment({ departmentId: 'd-2' }, 'd-1')).toThrow(CityOutsideDepartmentError);
  });

  it('locationData no guarda el país y la foto de la bitácora es la de siempre', () => {
    expect(locationData({ countryId: 'co', departmentId: 'd', cityId: 'c', address: 'Calle 1' })).toEqual({
      departmentId: 'd',
      cityId: 'c',
      postalCode: undefined,
      type: undefined,
      address: 'Calle 1'
    });
    expect(locationSnapshot(location())).toEqual({ departmentId: 'dep-ant', cityId: 'city-med', postalCode: null, type: 'home', address: 'Calle 1 # 2-3' });
    expect(locationSnapshot(null)).toBeNull();
  });
});

describe('referencias', () => {
  it(`como mucho ${MAX_REFERENCES_PER_PERSON} vigentes`, () => {
    expect(() => assertCanAddReference(MAX_REFERENCES_PER_PERSON - 1)).not.toThrow();
    expect(() => assertCanAddReference(MAX_REFERENCES_PER_PERSON)).toThrow(new ReferenceLimitReachedError(5));
    expect(new ReferenceLimitReachedError(5).message).toBe('No puede agregar más de 5 referencias');
  });

  it('editedReference conserva lo que no llega', () => {
    const before = { referenceName: 'Luis', referencePhone: '300', referenceType: 'familiar' as const };
    expect(editedReference(before, { referencePhone: '311' })).toEqual({ ...before, referencePhone: '311' });
  });
});

describe('baja de una cuenta', () => {
  const ts = AT.getTime();

  it('valores ofuscados únicos (marca de tiempo) que no identifican a nadie', () => {
    expect(deletedNationalId('1020304050', AT)).toBe(`deleted_${ts}_1020`);
    expect(deletedNationalId(null, AT)).toBe(`deleted_${ts}_unkn`);
    expect(deletedUsername('ana', AT)).toBe(`deleted_${ts}_ana`);
    expect(deletedEmail(AT)).toBe(`deleted_${ts}@deleted.invalid`);
    expect(deletedPhone(AT)).toBe(`0000000000${String(ts).slice(-4)}`);
  });

  it('anonymizeAccount: nombres en ELIMINADO, sin fecha de nacimiento, y solo los teléfonos que había', () => {
    const result = anonymizeAccount({ nationalId: '1020304050', username: 'ana', contact: { phonePrimary: '300', phoneSecondary: null } }, AT);
    expect(result).toEqual({
      person: {
        nationalId: `deleted_${ts}_1020`,
        firstName: 'ELIMINADO',
        lastName: 'ELIMINADO',
        middleName: null,
        secondLastName: null,
        birthDate: null
      },
      username: `deleted_${ts}_ana`,
      contact: { email: `deleted_${ts}@deleted.invalid`, phonePrimary: deletedPhone(AT) }
    });
  });
});

describe('cuentas de cliente', () => {
  it('una cuenta eliminada es intocable', () => {
    expect(() => assertNotDeleted({ deletedAt: null })).not.toThrow();
    expect(() => assertNotDeleted({ deletedAt: AT })).toThrow(AccountDeletedError);
    expect(new AccountDeletedError().details).toEqual({ code: 'USER_DELETED' });
  });

  it('requirePerson falla explícito si la lectura no trajo la persona', () => {
    expect(requirePerson({ person: { personId: 'p' } })).toEqual({ personId: 'p' });
    expect(() => requirePerson({ person: null })).toThrow(AccountWithoutPersonError);
  });

  it('roles de cliente', () => {
    expect(isClientRole('CLIENTE')).toBe(true);
    expect(isClientRole('ADMIN')).toBe(false);
    expect(isClientRole(null)).toBe(false);
  });

  it('activar una cuenta activa no es un cambio', () => {
    expect(() => assertStatusChange({ isActive: true }, true)).toThrow(new AccountStatusUnchangedError(true));
    expect(new AccountStatusUnchangedError(false).message).toBe('El usuario ya está inactivo');
    expect(() => assertStatusChange({ isActive: true }, false)).not.toThrow();
  });

  it('el rol solo cambia entre roles de cliente, y a uno distinto', () => {
    expect(() => assertClientAccount({ role: { roleId: 'r', name: 'ADMIN', description: null } })).toThrow(NotAClientAccountError);
    expect(() => assertClientRoleChange({ roleId: 'r-1' }, { roleId: 'r-2', name: 'ADMIN', description: null })).toThrow(NotAClientRoleError);
    expect(() => assertClientRoleChange({ roleId: 'r-1' }, { roleId: 'r-1', name: 'CLIENTE', description: null })).toThrow(SameRoleError);
  });

  it('mfaShutdown apaga solo los factores que estén activos', () => {
    expect(() => mfaShutdown({ totpEnabled: false, smsMfaEnabled: false })).toThrow(MfaNotEnabledError);
    expect(mfaShutdown({ totpEnabled: true, smsMfaEnabled: false })).toEqual({ preferredMfaMethod: 'none', totpEnabled: false, clearTotpSecret: true });
    expect(mfaShutdown({ totpEnabled: null, smsMfaEnabled: true })).toEqual({ preferredMfaMethod: 'none', smsMfaEnabled: false });
  });
});

describe('bitácora del perfil', () => {
  const before = { genderId: 'g-f', birthDate: new Date('1990-05-10T00:00:00Z'), location: { departmentId: 'd' } };

  it('género y fecha de nacimiento solo si cambian', () => {
    expect(profileFieldChanges({ genderId: 'g-f', birthDate: new Date('1990-05-10') }, before)).toEqual([]);
    expect(profileFieldChanges({ genderId: 'g-m', birthDate: new Date('1991-01-02') }, before)).toEqual([
      { changeType: 'gender', previousValue: 'g-f', newValue: 'g-m' },
      { changeType: 'birth_date', previousValue: '1990-05-10', newValue: '1991-01-02' }
    ]);
  });

  it('la ubicación siempre que llegue, con la foto de antes y la de ahora', () => {
    const loc = { departmentId: 'd', cityId: 'c', address: 'Calle 1' };
    expect(profileFieldChanges({ location: loc }, { ...before, location: null })).toEqual([
      { changeType: 'location', previousValue: null, newValue: JSON.stringify(loc), changeReason: 'Ubicación de residencia' }
    ]);
  });

  it('username y avatar no van a la bitácora', () => {
    expect(profileFieldChanges({ username: 'nuevo', avatarId: 'av' }, before)).toEqual([]);
  });
});
