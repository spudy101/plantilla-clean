import { interopDefault } from '../../../shared/utils/interop.util';
import auditModule from '../../audit';
const { audit } = auditModule;
import type { ChangeInput } from '../../audit';
import crypto from 'node:crypto';

/**
 * Utilidades compartidas entre KycPerson y KycProfile services
 *
 * Este archivo contiene funciones comunes que son utilizadas por:
 * - kycPerson_service.js (operaciones de admin sobre usuarios)
 * - kycProfile_service.js (operaciones del usuario sobre su propio perfil)
 */
const DELETED_PREFIX_LENGTH = 4;

class KycSharedUtil {
  /**
   * Genera contraseña segura aleatoria
   * Formato: 12 caracteres con mayúsculas, minúsculas, números y símbolos
   *
   * @returns {string} Contraseña generada
   */
  static generateSecurePassword() {
    const length = 12;
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*';

    const allChars = uppercase + lowercase + numbers + symbols;

    const getRandomChar = (chars: string) => {
      const index = crypto.randomInt(0, chars.length);
      return chars[index];
    };

    const passwordArray = [];

    // Asegurar al menos 1 de cada tipo
    passwordArray.push(getRandomChar(uppercase), getRandomChar(lowercase), getRandomChar(numbers), getRandomChar(symbols));

    // Completar el resto
    for (let i = passwordArray.length; i < length; i++) {
      passwordArray.push(getRandomChar(allChars));
    }

    // Fisher-Yates shuffle seguro
    for (let i = passwordArray.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [passwordArray[i], passwordArray[j]] = [passwordArray[j], passwordArray[i]];
    }

    return passwordArray.join('');
  }

  /** Registra un cambio sobre la cuenta en la bitácora (audit_logs, acción USER_FIELD_CHANGED). */
  static logChange(change: ChangeInput) {
    return audit.recordChange(change);
  }

  /**
   * Valida national_id según el rol
   *
   * @param {string} nationalId - National ID a validar
   * @param {Object} role - Objeto del rol con propiedad 'name'
   * @throws {AppError} Si la validación falla
   * @returns {boolean} true si es válido
   */
  // ============================================================
  // FORMAT DELETED — ofuscacion de datos en eliminacion de cuenta
  // ============================================================

  /**
   * Ofusca el nationalId para soft-delete.
   * Formato: deleted_<timestamp>_<primeros4chars>
   */
  static formatDeletedNationalId(nationalId: string | null | undefined) {
    const prefix = (nationalId || 'unknown').slice(0, DELETED_PREFIX_LENGTH);
    return `deleted_${Date.now()}_${prefix}`;
  }

  /**
   * Ofusca el username para soft-delete.
   * Formato: deleted_<timestamp>_<primeros4chars>
   */
  static formatDeletedUsername(username: string | null | undefined) {
    const prefix = (username || 'unknown').slice(0, DELETED_PREFIX_LENGTH);
    return `deleted_${Date.now()}_${prefix}`;
  }

  /**
   * Ofusca el email para soft-delete.
   * Formato: deleted_<timestamp>@deleted.invalid
   */
  static formatDeletedEmail(_email?: string | null) {
    return `deleted_${Date.now()}@deleted.invalid`;
  }

  /**
   * Ofusca un numero de telefono para soft-delete.
   * Formato: 0000000000<timestamp_ultimos4>
   */
  static formatDeletedPhone(_phone?: string | null) {
    const PHONE_SUFFIX_LENGTH = -4;
    const suffix = String(Date.now()).slice(PHONE_SUFFIX_LENGTH);
    return `0000000000${suffix}`;
  }

  static validateNationalIdByRole(nationalId: string, role: { name: string }) {
    const AppError = interopDefault(require('../../../shared/http/app-error.util') as typeof import('../../../shared/http/app-error.util'));

    const isAdmin = role.name.toLowerCase() === 'admin';

    if (isAdmin) {
      if (!nationalId || typeof nationalId !== 'string') {
        throw AppError.badRequest('National ID debe ser un texto válido');
      }

      const validPattern = /^[a-zA-Z0-9_-]+$/;
      if (!validPattern.test(nationalId)) {
        throw AppError.badRequest('National ID solo puede contener letras, números, guiones y guiones bajos');
      }
    } else if (!nationalId || typeof nationalId !== 'string') {
      throw AppError.badRequest('National ID es requerido');
    }

    return true;
  }
}

export default KycSharedUtil;
