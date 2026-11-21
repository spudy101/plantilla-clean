// modules/schemas/kyc/helpers/internal-user.helper.ts
//
// Orquesta la creación de un usuario interno (empleado): persona → contacto →
// user, dentro de una transacción. Centraliza la lógica para no duplicarla entre
// el CRUD admin y futuros flujos (p.ej. carga masiva de empleados).
//
// Reutiliza el mismo patrón que auth-register.service, pero sin política de
// privacidad ni notificaciones de bienvenida (no aplican a usuarios internos).

import { v4 as uuidv4 } from 'uuid';

import userRepository from '../repositories/user.repository';
import personModule from '../../person';
const { personRepository, personContactRepository } = personModule;
import AppError from '../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import unitOfWork from '../../../shared/infrastructure/database/unit-of-work';
import errorMessageModule from '../../../shared/kernel/error-message.util';

const { errorMessage } = errorMessageModule;
import { shouldPropagate } from '../../../shared/presentation/http/error-propagation';


class InternalUserHelper {
  /**
   * Crea un usuario interno completo en BD.
   *
   * El caller (service) es responsable de validar unicidad de email/national_id
   * y de generar la contraseña temporal antes de invocar este helper.
   *
   * @param {Object} data
   * @param {string} data.email
   * @param {string} data.password    - contraseña temporal ya generada
   * @param {string} data.firstName
   * @param {string} [data.middleName]
   * @param {string} data.lastName
   * @param {string} [data.secondLastName]
   * @param {string} data.nationalId
   * @param {string} [data.documentTypeId]
   * @param {Object} data.role        - instancia/registro del rol { role_id, name }
   * @returns {Promise<{ user: Object, person: Object }>}
   */
  static async createInternalUser(data: InternalUserHelper.CreateInput) {
    const authUsername = `staff_${uuidv4()}`;

    try {
      return await InternalUserHelper._createInDB({ ...data, authUsername });
    } catch (error) {
      if (shouldPropagate(error)) {
        throw error;
      }
      logger.error('createInternalUser — fallo al crear en BD', { error: errorMessage(error) });
      throw AppError.internal('Error al crear el usuario interno. Intenta nuevamente');
    }
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  /** @private */
  static async _createInDB(data: InternalUserHelper.CreateInput & { authUsername: string }) {
    const { person, user } = await unitOfWork.run(async () => {
      const person = await personRepository.create({
        firstName: data.firstName,
        middleName: data.middleName || null,
        lastName: data.lastName,
        secondLastName: data.secondLastName || null,
        nationalId: data.nationalId,
        documentTypeId: data.documentTypeId || null
      });

      await personContactRepository.create({
        personId: person.personId,
        email: data.email,
        emailVerifiedAt: new Date()
      });

      const user = await userRepository.createWithPassword({
        username: data.authUsername,
        authUsername: data.authUsername,
        password: data.password,
        personId: person.personId,
        roleId: data.role.roleId
      });
      return { person, user };
    });
    logger.info('Usuario interno creado en BD', {
      userId: user.userId,
      roleId: data.role.roleId
    });
    return { user, person };
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace InternalUserHelper {
  export interface CreateInput {
    email: string;
    /** Contraseña temporal ya generada por el service */
    password: string;
    firstName: string;
    middleName?: string | null;
    lastName: string;
    secondLastName?: string | null;
    nationalId: string;
    documentTypeId?: string | null;
    role: { roleId: string; name: string };
  }
}

export default InternalUserHelper;
