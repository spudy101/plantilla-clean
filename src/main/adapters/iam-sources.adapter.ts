// Adaptadores: lo que iam necesita de otros módulos. Viven acá porque conectan módulos; iam no los importa.
//
//   holders, identity, anonymizer     person: la persona de cada cuenta, la unicidad de documento y email, la baja
//   temporaryPasswords                person: las contraseñas temporales de los usuarios internos
//   privacyPolicies, consents         legal: la política vigente y la constancia de lo aceptado
//   verificationCodes, sms, pushDevices, preferences   notification: OTP, SMS, push del login, preferencia inicial
//   catalogs                          catalogs: país, tipo de documento y género
//   changeLog, authAttempts, changeHistory             audit: la bitácora y lo que muestran las vistas admin
//   approvals                         approvals: el gate maker-checker y el badge de pendientes
//   errors                            qué errores inesperados se re-lanzan tal cual
import type { IamModuleDeps } from '../../modules/iam/iam.module';
import { securePasswordGenerator } from '../../modules/person/infrastructure/security/secure-password.generator';
import { shouldPropagate } from '../../shared/presentation/http/error-propagation';
import type { ModuleRegistry } from './module-registry';

type IamSources = Omit<IamModuleDeps, 'policy' | 'audit' | 'logger' | 'notifier' | 'unitOfWork'>;

export function iamSourcesAdapter(modules: ModuleRegistry): IamSources {
  return {
    // Se propagan los errores que ya dicen qué responder (de negocio, técnicos o HTTP) y los temporales de la base
    // (caída, conflicto de transacción), que el manejador de errores responde 503 / 409 temporal.
    errors: { shouldPropagate },

    // ── person ──
    holders: {
      create: (holder, contact) => modules.person.useCases.accountHolders.create(holder, contact),
      emailInUse: email => modules.person.useCases.accountHolders.emailInUse(email),
      nationalIdInUse: nationalId => modules.person.useCases.accountHolders.nationalIdInUse(nationalId),
      findByEmail: email => modules.person.useCases.accountHolders.findByEmail(email),
      updateNames: (personId, names) => modules.person.useCases.accountHolders.updateNames(personId, names)
    },
    identity: {
      assertNationalIdAvailable: nationalId => modules.person.useCases.identityChecks.assertNationalIdAvailable(nationalId),
      assertEmailAvailable: email => modules.person.useCases.identityChecks.assertEmailAvailable(email)
    },
    anonymizer: {
      async anonymize(input) {
        await modules.person.useCases.anonymizeAccount.execute(input);
      }
    },
    temporaryPasswords: { generate: () => securePasswordGenerator.generate() },

    // ── legal ──
    privacyPolicies: { findActive: () => modules.legal.useCases.findActivePrivacyPolicy.execute() },
    consents: {
      grantPrivacyPolicy: input => modules.legal.useCases.grantPrivacyPolicyConsent.execute(input),
      grantCommercialCommunications: input => modules.legal.useCases.grantCommercialCommunicationsConsent.execute(input)
    },

    // ── notification ──
    verificationCodes: {
      secondsUntilNewCode: (kind, value) => modules.notification.useCases.otpCodes.secondsUntilNewCode(kind, value),
      create: code => modules.notification.useCases.otpCodes.create(code),
      findActive: (kind, value) => modules.notification.useCases.otpCodes.findActive(kind, value),
      incrementAttempts: id => modules.notification.useCases.otpCodes.incrementAttempts(id),
      markAsVerified: id => modules.notification.useCases.otpCodes.markAsVerified(id),
      isVerified: (kind, value) => modules.notification.useCases.otpCodes.isVerified(kind, value),
      consumeVerified: (kind, value) => modules.notification.useCases.otpCodes.consumeVerified(kind, value)
    },
    sms: {
      send: sms => modules.notification.useCases.sms.send(sms),
      resolveE164: (localNumber, prefixId) => modules.notification.useCases.sms.resolveE164(localNumber, prefixId)
    },
    pushDevices: { register: device => modules.notification.useCases.registerPushDevice.execute(device) },
    preferences: { createDefault: userId => modules.notification.useCases.createDefaultPreference.execute(userId) },

    // ── catalogs ──
    catalogs: {
      countryByCode: code => modules.catalogs.lookups.countryByCode.execute(code),
      documentType: id => modules.catalogs.lookups.documentType.execute(id),
      documentTypeByCode: code => modules.catalogs.lookups.documentTypeByCode.execute(code),
      genderExists: async id => (await modules.catalogs.lookups.gender.execute(id)) !== null
    },

    // ── audit ──
    changeLog: { record: change => modules.audit.recordAccountChange(change) },
    authAttempts: { list: (criteria, page) => modules.audit.useCases.listAuthAttempts.execute(criteria, page) },
    changeHistory: { listByUser: (userId, page) => modules.audit.useCases.listAccountChanges.execute(userId, page) },

    // ── approvals ──
    approvals: {
      async gate(operationKey, input) {
        const result = await modules.approvals.useCases.gate.execute(operationKey, input);
        return result.pending ? { pending: true, request: result.request } : { pending: false };
      },
      findPending: (entityType, entityIds) => modules.approvals.useCases.findPending.execute(entityType, entityIds)
    }
  };
}
