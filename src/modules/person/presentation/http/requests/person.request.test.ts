// Esquemas de entrada de person: los casos que cubría el validator anterior (sortBy) y las reglas con
// condiciones (location del perfil, "al menos un campo").
import { PersonListQuery, UpdateProfileBody, CreateReferenceBody } from './person.request';

const issuesOf = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) =>
  (result.error?.issues ?? []).map(i => ({ field: i.path.join('.'), message: i.message }));

describe('PersonListQuery — sortBy', () => {
  it.each(['username', 'createdAt', 'updatedAt', 'isActive'])('acepta el campo en camelCase %s', value => {
    expect(PersonListQuery.safeParse({ sortBy: value }).success).toBe(true);
  });

  it.each(['created_at', 'updated_at', 'is_active'])('sigue aceptando el nombre de columna %s (compatibilidad)', value => {
    expect(PersonListQuery.safeParse({ sortBy: value }).success).toBe(true);
  });

  it('rechaza un campo fuera de la lista y sugiere los nombres en camelCase', () => {
    expect(issuesOf(PersonListQuery.safeParse({ sortBy: 'password_hash' }))).toEqual([
      { field: 'sortBy', message: 'sortBy debe ser uno de: createdAt, updatedAt, username, isActive' }
    ]);
  });

  it('convierte page/limit e isActive desde la query string', () => {
    expect(PersonListQuery.parse({ page: '2', limit: '10', isActive: 'false' })).toMatchObject({ page: 2, limit: 10, isActive: false });
  });

  it('aplica los defaults y deja sortBy en camelCase y order en mayúsculas', () => {
    expect(PersonListQuery.parse({})).toMatchObject({ page: 1, limit: 10, sortBy: 'createdAt', order: 'DESC' });
    expect(PersonListQuery.parse({ sortBy: 'updated_at', order: 'asc' })).toMatchObject({ sortBy: 'updatedAt', order: 'ASC' });
  });

  it('rechaza un limit mayor a 100', () => {
    expect(PersonListQuery.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('roleId acepta una lista de UUIDs separados por coma', () => {
    const ids = '0f8fad5b-d9cb-469f-a165-70867728950e,7c9e6679-7425-40de-944b-e07fc1f90ae7';
    expect(PersonListQuery.safeParse({ roleId: ids }).success).toBe(true);
    expect(PersonListQuery.safeParse({ roleId: `${ids},x` }).success).toBe(false);
  });
});

describe('UpdateProfileBody', () => {
  it('exige al menos un campo', () => {
    expect(issuesOf(UpdateProfileBody.safeParse({}))).toEqual([{ field: '', message: 'Debe enviar al menos un campo para actualizar el perfil' }]);
  });

  it('si viene location, exige departamento, ciudad y dirección', () => {
    const messages = issuesOf(UpdateProfileBody.safeParse({ location: { address: 'Calle 1 # 2-3' } })).map(i => i.message);
    expect(messages).toContain('Si envía location, los siguientes campos son obligatorios: departmentId, cityId');
  });

  it('acepta un cambio de username válido y lo recorta', () => {
    expect(UpdateProfileBody.parse({ username: '  ana_01 ' })).toMatchObject({ username: 'ana_01' });
  });
});

describe('CreateReferenceBody', () => {
  it('valida teléfono y tipo de referencia', () => {
    expect(CreateReferenceBody.safeParse({ referenceName: 'Ana', referencePhone: '+57 300 123 4567', referenceType: 'familiar' }).success).toBe(true);
    const fields = issuesOf(CreateReferenceBody.safeParse({ referenceName: 'A', referencePhone: 'abc', referenceType: 'amigo' })).map(i => i.field);
    expect(fields.sort()).toEqual(['referenceName', 'referencePhone', 'referenceType']);
  });
});
