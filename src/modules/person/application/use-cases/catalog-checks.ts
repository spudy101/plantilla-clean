// Los valores de catálogo que elige una persona deben existir y estar activos; la ciudad, además, debe ser
// del departamento elegido.
import type { CatalogValue, ProfileCatalogs } from '../ports/profile-catalogs.port';
import type { LocationInput } from '../../domain/person-location';
import { assertCityInDepartment } from '../../domain/person-location';
import {
  CatalogEntryNotFoundError,
  CatalogEntryUnavailableError,
  CityNotFoundError,
  DepartmentNotFoundError,
  catalogErrors
} from '../../domain/errors';

function assertUsable(value: CatalogValue | null, messages: { notFound: string; unavailable: string }): void {
  if (!value) {
    throw new CatalogEntryNotFoundError(messages.notFound, 'NOT_FOUND');
  }
  if (!value.isActive) {
    throw new CatalogEntryUnavailableError(messages.unavailable, 'BAD_REQUEST');
  }
}

export class CatalogChecks {
  constructor(private readonly catalogs: ProfileCatalogs) {}

  async assertAvatar(avatarId: string): Promise<void> {
    assertUsable(await this.catalogs.findAvatar(avatarId), catalogErrors.avatar);
  }

  async assertGender(genderId: string): Promise<void> {
    assertUsable(await this.catalogs.findGender(genderId), catalogErrors.gender);
  }

  async assertDocumentType(documentTypeId: string): Promise<void> {
    assertUsable(await this.catalogs.findDocumentType(documentTypeId), catalogErrors.documentType);
  }

  async assertLocation({ departmentId, cityId }: LocationInput): Promise<void> {
    if (!(await this.catalogs.findDepartment(departmentId))) {
      throw new DepartmentNotFoundError();
    }
    const city = await this.catalogs.findCity(cityId);
    if (!city) {
      throw new CityNotFoundError();
    }
    assertCityInDepartment(city, departmentId);
  }
}
