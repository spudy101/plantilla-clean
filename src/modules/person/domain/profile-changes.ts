// Qué cambios de un perfil quedan en la bitácora de la cuenta (valor anterior → valor nuevo).
import type { LocationInput } from './person-location';

/** Lo que el titular puede cambiar de su perfil (PUT /person/profile). */
export interface ProfileUpdate {
  username?: string;
  avatarId?: string;
  genderId?: string;
  location?: LocationInput;
  birthDate?: Date;
}

/** Cómo estaba el perfil antes del cambio. */
export interface ProfileSnapshot {
  genderId: string | null;
  birthDate: Date | null;
  location: Record<string, unknown> | null;
}

export interface ProfileFieldChange {
  changeType: 'gender' | 'birth_date' | 'location';
  previousValue: string | null;
  newValue: string;
  changeReason?: string;
}

const isoDay = (value: Date | string) => new Date(value).toISOString().slice(0, 10);

/**
 * Género y fecha de nacimiento se registran solo si cambian; la ubicación, siempre que llegue (se guarda la
 * foto completa de antes y la de ahora). Username y avatar no van a la bitácora.
 */
export function profileFieldChanges(update: ProfileUpdate, before: ProfileSnapshot): ProfileFieldChange[] {
  const changes: ProfileFieldChange[] = [];

  if (update.genderId && update.genderId !== before.genderId) {
    changes.push({ changeType: 'gender', previousValue: before.genderId ?? null, newValue: update.genderId });
  }

  if (update.birthDate) {
    const previous = before.birthDate ? isoDay(before.birthDate) : null;
    const next = isoDay(update.birthDate);
    if (previous !== next) {
      changes.push({ changeType: 'birth_date', previousValue: previous, newValue: next });
    }
  }

  if (update.location) {
    changes.push({
      changeType: 'location',
      previousValue: before.location ? JSON.stringify(before.location) : null,
      newValue: JSON.stringify(update.location),
      changeReason: 'Ubicación de residencia'
    });
  }

  return changes;
}
