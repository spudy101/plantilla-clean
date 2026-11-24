// Puerto: los valores de catálogo que elige una persona (avatar, género, tipo de documento, departamento y
// ciudad). Son de catalogs; los conecta src/main/adapters/person-sources.adapter.ts.

export interface CatalogValue {
  isActive: boolean | null;
}

export interface ProfileCatalogs {
  findAvatar(avatarId: string): Promise<CatalogValue | null>;
  findGender(genderId: string): Promise<CatalogValue | null>;
  findDocumentType(documentTypeId: string): Promise<CatalogValue | null>;
  findDepartment(departmentId: string): Promise<{ departmentId: string } | null>;
  findCity(cityId: string): Promise<{ cityId: string; departmentId: string } | null>;
}
