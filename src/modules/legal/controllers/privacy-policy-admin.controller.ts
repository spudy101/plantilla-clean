import AppError from '../../../shared/presentation/http/app-error.util';
import type { Request } from 'express';
// modules/admin/privacy-policy/controllers/privacy-policy-admin.controller.ts

import PrivacyPolicyAdminService from '../services/privacy-policy-admin.service';
import ApiResponse from '../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../shared/presentation/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import routeParamUtilModule from '../../../shared/presentation/http/route-param.util';
const { routeParam } = routeParamUtilModule;
import authUserUtilModule from '../../../shared/presentation/http/auth-user.util';
import { validQuery } from '../../../shared/presentation/validation/validate';
import { PrivacyPolicyListQuery } from '../requests/legal.request';
const { requireAuthUser } = authUserUtilModule;

class PrivacyPolicyAdminController {
  /**
   * GET /admin/api/privacy-policies
   */
  listVersions = asyncHandler(async (req, res) => {
    return ApiResponse.success(
      res,
      'Versiones de política de privacidad obtenidas exitosamente',
      await PrivacyPolicyAdminService.listVersions(validQuery(req, PrivacyPolicyListQuery), requireAuthUser(req).userId)
    );
  });

  /**
   * GET /admin/api/privacy-policies/:privacyPolicyId
   */
  getVersionDetail = asyncHandler(async (req, res) => {
    return ApiResponse.success(
      res,
      'Detalle de política de privacidad obtenido exitosamente',
      await PrivacyPolicyAdminService.getVersionDetail(routeParam(req, 'privacyPolicyId'), requireAuthUser(req).userId)
    );
  });

  /**
   * POST /admin/api/privacy-policies
   * req.files.policyDocument[0] — igual que institutional email usa req.files.studentCertificate[0]
   */
  createVersion = asyncHandler(async (req, res) => {
    return ApiResponse.created(
      res,
      'Nueva versión de política de privacidad publicada exitosamente',
      await PrivacyPolicyAdminService.createVersion(
        {
          version: req.body.version,
          fileBuffer: _policyDocument(req).buffer,
          originalName: _policyDocument(req).originalname,
          summary: req.body.summary,
          effectiveDate: req.body.effectiveDate ? new Date(req.body.effectiveDate) : undefined
        },
        requireAuthUser(req).userId
      )
    );
  });
}

/** PDF subido en el campo multipart policyDocument (uploadFields); 400 si no vino. */
function _policyDocument(req: Request): Express.Multer.File {
  const files = req.files as Record<string, Express.Multer.File[] | undefined> | undefined;
  const file = files?.policyDocument?.[0];
  if (!file) {
    throw AppError.badRequest('El documento PDF de la política es requerido (campo "policyDocument")');
  }
  return file;
}

export default new PrivacyPolicyAdminController();
