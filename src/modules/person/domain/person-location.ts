// La ubicación de residencia de una persona (una por persona): departamento, ciudad y dirección.
import { CityOutsideDepartmentError } from './errors';

interface PlaceRef {
  name: string;
}

export interface PersonLocation {
  personLocationId: string;
  personId: string;
  countryId: string | null;
  departmentId: string;
  cityId: string;
  address: string;
  postalCode: string | null;
  type: string | null;
}

/** La ubicación con los nombres de país, departamento y ciudad (lo que se muestra). */
export interface PersonLocationWithPlaces extends PersonLocation {
  country: (PlaceRef & { countryId: string; code: string; iconUrl: string | null }) | null;
  department: PlaceRef & { departmentId: string; daneCode: string | null };
  city: PlaceRef & { cityId: string; daneCode: string | null };
}

/** Lo que el titular envía. El país no se guarda: lo da el departamento. */
export interface LocationInput {
  countryId?: string | null;
  departmentId: string;
  cityId: string;
  postalCode?: string | null;
  type?: string | null;
  address: string;
}

/** Lo que se escribe (crear o reemplazar la ubicación). Una clave ausente no se toca. */
export interface LocationData {
  departmentId: string;
  cityId: string;
  postalCode?: string | null;
  type?: string | null;
  address: string;
}

export function locationData(input: LocationInput): LocationData {
  return {
    departmentId: input.departmentId,
    cityId: input.cityId,
    postalCode: input.postalCode,
    type: input.type,
    address: input.address
  };
}

/** La ciudad debe pertenecer al departamento elegido. */
export function assertCityInDepartment(city: { departmentId: string }, departmentId: string): void {
  if (city.departmentId !== departmentId) {
    throw new CityOutsideDepartmentError();
  }
}

/** La foto de la ubicación que queda en la bitácora de cambios. */
export function locationSnapshot(location: PersonLocation | null) {
  return location
    ? {
        departmentId: location.departmentId,
        cityId: location.cityId,
        postalCode: location.postalCode,
        type: location.type,
        address: location.address ?? null
      }
    : null;
}
