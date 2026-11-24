// Rutas del módulo person (todas bajo /api/v1/kyc). Cada router se arma con su controlador y las guardas que
// recibe: no importa el módulo iam.
//
//   admin           panel de clientes (/person, /person/:userId/…), con permisos RBAC de CLIENTS_LIST
//   admin y client  perfil propio (/person/profile/…): basta con estar autenticado
//   client          referencias personales (/person/person-references)
//
// El documento de identidad (RUT + tipo) es inmutable para el propio usuario: se fija en el registro. Su
// corrección es potestad del admin (PUT /person/:userId/national-id).
import express from 'express';
import type { Router } from 'express';
import { validate } from '../../../../shared/presentation/validation/validate';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../../shared/presentation/http/request-lock.middleware';
import type { RouteGuards } from '../../../../shared/presentation/http/route-guards';
import rbacModule from '../../../../shared/domain/constants/rbac';
import {
  AdminDeleteAccountBody,
  ChangeEmailBody,
  ChangeNationalIdBody,
  ChangeRoleBody,
  CreatePersonBody,
  CreateReferenceBody,
  DeleteAccountBody,
  DeletedPersonListQuery,
  PersonListQuery,
  PersonUserIdParams,
  ReferenceIdParams,
  UpdateEmailBody,
  UpdateNamesBody,
  UpdatePasswordBody,
  UpdatePhoneBody,
  UpdateProfileBody,
  UpdateReferenceBody
} from './requests/person.request';
import type { AdminPersonController } from './admin-person.controller';
import type { ProfileController } from './profile.controller';
import type { PersonReferenceController } from './person-reference.controller';

const { RBAC_MODULES, RBAC_ACTIONS, RBAC_ROLES } = rbacModule;

/** Roles que pueden usar las rutas del portal cliente. */
const CLIENT_ACCESS_ROLES = [RBAC_ROLES.CLIENTE];

/** :userId de las rutas del panel (un UUID: así /person/deleted y /person/roles no caen en el parámetro). */
const USER = '/person/:userId([0-9a-fA-F-]{36})';

export function createAdminPersonRouter(controller: AdminPersonController, guards: RouteGuards): Router {
  const router = express.Router();
  const clients = (action: string) => [
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.CLIENTS_LIST, action),
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers()
  ];
  const userParam = () => validate({ params: PersonUserIdParams });

  // Búsqueda por texto en username, nombre y apellido (documento y email van cifrados: solo búsqueda exacta)
  router.get('/person', ...clients(RBAC_ACTIONS.READ), validate({ query: PersonListQuery }), controller.list);
  router.get('/person/deleted', ...clients(RBAC_ACTIONS.READ), validate({ query: DeletedPersonListQuery }), controller.listDeleted);
  router.get('/person/roles', ...clients(RBAC_ACTIONS.READ), controller.listRoleOptions);
  router.get(USER, ...clients(RBAC_ACTIONS.READ), userParam(), controller.getById);

  // Alta: devuelve la contraseña temporal (solo en esta respuesta) y la manda por correo
  router.post('/person', ...clients(RBAC_ACTIONS.CREATE), validate({ body: CreatePersonBody }), controller.create);

  router.put(`${USER}/activate`, ...clients(RBAC_ACTIONS.UPDATE), userParam(), controller.activate);
  router.put(`${USER}/deactivate`, ...clients(RBAC_ACTIONS.UPDATE), userParam(), controller.deactivate);
  router.put(`${USER}/reset-password`, ...clients(RBAC_ACTIONS.UPDATE), userParam(), controller.resetPassword);
  router.put(`${USER}/disable-mfa`, ...clients(RBAC_ACTIONS.UPDATE), userParam(), controller.disableMFA);
  router.put(`${USER}/email`, ...clients(RBAC_ACTIONS.UPDATE), userParam(), validate({ body: ChangeEmailBody }), controller.changeEmail);
  router.put(
    `${USER}/national-id`,
    ...clients(RBAC_ACTIONS.UPDATE),
    userParam(),
    validate({ body: ChangeNationalIdBody }),
    controller.changeNationalId
  );
  router.put(`${USER}/role`, ...clients(RBAC_ACTIONS.UPDATE), userParam(), validate({ body: ChangeRoleBody }), controller.changeRole);

  // Baja irreversible: el admin confirma su contraseña; con doble aprobación responde 202
  router.delete(
    `${USER}/delete-account`,
    ...clients(RBAC_ACTIONS.DELETE),
    userParam(),
    validate({ body: AdminDeleteAccountBody }),
    controller.deleteAccount
  );

  return router;
}

export function createProfileRouter(controller: ProfileController, guards: RouteGuards): Router {
  const router = express.Router();
  // Cada ruta con su propio limitador y su lock, como en el resto de los routers
  const own = () => [guards.authenticate, RateLimitMiddleware.apiLimiter(), RequestLockMiddleware.forAuthenticatedUsers()];

  router.get('/person/profile', ...own(), controller.getProfile);
  router.get('/person/profile/extended', ...own(), controller.getExtendedProfile);
  router.get('/person/profile/location', ...own(), controller.getLocation);
  router.get('/person/profile/contact', ...own(), controller.getContactInfo);
  router.put('/person/profile', ...own(), validate({ body: UpdateProfileBody }), controller.updateProfile);
  router.put('/person/profile/email', ...own(), validate({ body: UpdateEmailBody }), controller.updateEmail);
  router.put('/person/profile/phone', ...own(), validate({ body: UpdatePhoneBody }), controller.updatePhone);
  router.put('/person/profile/password', ...own(), validate({ body: UpdatePasswordBody }), controller.updatePassword);
  router.put('/person/profile/names', ...own(), validate({ body: UpdateNamesBody }), controller.updateNames);
  router.delete('/person/profile/delete-account', ...own(), validate({ body: DeleteAccountBody }), controller.deleteAccount);

  return router;
}

export function createPersonReferenceRouter(controller: PersonReferenceController, guards: RouteGuards): Router {
  const router = express.Router();
  const client = guards.requireRole(CLIENT_ACCESS_ROLES);
  const lock = () => RequestLockMiddleware.forAuthenticatedUsers();

  router.get('/person/person-references', client, RateLimitMiddleware.apiLimiter(), controller.list);
  router.post('/person/person-references', client, RateLimitMiddleware.apiLimiter(), lock(), validate({ body: CreateReferenceBody }), controller.create);
  router.put(
    '/person/person-references/:referenceId',
    client,
    RateLimitMiddleware.apiLimiter(),
    lock(),
    validate({ params: ReferenceIdParams, body: UpdateReferenceBody }),
    controller.update
  );
  router.delete(
    '/person/person-references/:referenceId',
    client,
    RateLimitMiddleware.apiLimiter(),
    lock(),
    validate({ params: ReferenceIdParams }),
    controller.remove
  );

  return router;
}
