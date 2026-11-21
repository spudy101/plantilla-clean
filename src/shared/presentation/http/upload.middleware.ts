import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import AppError from './app-error.util';
import loggerUtilModule from '../../infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import errorMessageModule from '../../kernel/error-message.util';

const { errorMessage } = errorMessageModule;
import { shouldPropagate } from './error-propagation';

type UploadedFile = Express.Multer.File;
type FileFilterCallback = multer.FileFilterCallback;

interface UploadOptions {
  maxFileSize?: number;
  imagesOnly?: boolean;
  /** Lista explícita de MIME types permitidos (tiene prioridad sobre imagesOnly). */
  mimeTypes?: string[] | null;
}

// Rechazo de archivo: multer recibe el error y aborta (la firma de multer es cb(error) o cb(null, acepta)).
const reject = (cb: FileFilterCallback, error: Error) => cb(error);

const MB = 1024 * 1024;
const MAX_IMAGE_SIZE_MB = 10;
const MAX_PDF_SIZE_MB = 10;
const MAX_DOCUMENT_SIZE_MB = 50;

class UploadMiddleware {
  static storage = multer.memoryStorage();

  static ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

  static ALLOWED_DOC_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];

  static MAX_IMAGE_SIZE = MAX_IMAGE_SIZE_MB * MB; // 10MB
  static MAX_PDF_SIZE = MAX_PDF_SIZE_MB * MB; // 10MB
  static MAX_DOCUMENT_SIZE = MAX_DOCUMENT_SIZE_MB * MB; // 50MB

  /**
   * Filtro genérico que acepta imágenes y documentos
   */
  static fileFilter = (_req: Request, file: UploadedFile, cb: FileFilterCallback) => {
    const allowedTypes = [...this.ALLOWED_IMAGE_TYPES, ...this.ALLOWED_DOC_TYPES];

    if (allowedTypes.includes(file.mimetype)) {
      logger.debug('Archivo aceptado', {
        fieldname: file.fieldname,
        mimetype: file.mimetype,
        originalname: file.originalname
      });
      return cb(null, true);
    }

    logger.info('Tipo de archivo rechazado', {
      fieldname: file.fieldname,
      mimetype: file.mimetype,
      originalname: file.originalname
    });

    return reject(
      cb,
      AppError.badRequest(`Tipo de archivo no permitido: ${file.mimetype}`, {
        field: file.fieldname,
        allowedTypes
      })
    );
  };

  /**
   * Middleware para múltiples campos
   * @param {Array} fields - Array de objetos { name, maxCount }
   * @param {Object} options - Opciones de configuración
   * @param {number} options.maxFileSize - Tamaño máximo por archivo
   * @param {boolean} options.imagesOnly - Solo permitir imágenes
   * @param {string[]} options.mimeTypes - Lista explícita de MIME types permitidos (más restrictiva que
   *        el filtro genérico, que acepta imágenes + Word/Excel/PDF). Tiene prioridad sobre `imagesOnly`.
   */
  static uploadFields(fields: multer.Field[], options: UploadOptions = {}) {
    const { maxFileSize = this.MAX_IMAGE_SIZE, imagesOnly = false, mimeTypes = null } = options;

    let fileFilter: (req: Request, file: UploadedFile, cb: FileFilterCallback) => void;
    if (Array.isArray(mimeTypes) && mimeTypes.length > 0) {
      fileFilter = (_req: Request, file: UploadedFile, cb: FileFilterCallback) => {
        if (mimeTypes.includes(file.mimetype)) {
          return cb(null, true);
        }
        return reject(cb, AppError.badRequest(`Tipo de archivo no permitido: ${file.mimetype}`, { field: file.fieldname }));
      };
    } else if (imagesOnly) {
      fileFilter = (_req: Request, file: UploadedFile, cb: FileFilterCallback) => {
        if (this.ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
          return cb(null, true);
        }
        return reject(cb, AppError.badRequest(`Solo se permiten imágenes en ${file.fieldname}`));
      };
    } else {
      fileFilter = this.fileFilter;
    }

    return multer({
      storage: this.storage,
      fileFilter,
      limits: {
        fileSize: maxFileSize,
        files: fields.reduce((sum, field) => sum + (field.maxCount ?? 0), 0)
      }
    }).fields(fields);
  }

  /**
   * Manejo de errores de multer
   */
  static handleMulterError = (err: unknown, _req: Request, _res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const errorMessages: Record<string, string> = {
        LIMIT_FILE_SIZE: 'El archivo excede el tamaño máximo permitido',
        LIMIT_FILE_COUNT: 'Se excedió el número máximo de archivos',
        LIMIT_UNEXPECTED_FILE: `Campo de archivo inesperado: ${err.field}`,
        LIMIT_PART_COUNT: 'Demasiadas partes en la solicitud',
        LIMIT_FIELD_KEY: 'Nombre de campo demasiado largo',
        LIMIT_FIELD_VALUE: 'Valor de campo demasiado largo',
        LIMIT_FIELD_COUNT: 'Demasiados campos en la solicitud'
      };

      logger.info('Error de Multer', {
        code: err.code,
        field: err.field,
        message: err.message
      });

      return next(
        AppError.badRequest(errorMessages[err.code] || `Error al procesar archivo: ${err.message}`, {
          code: err.code,
          field: err.field
        })
      );
    }

    if (shouldPropagate(err)) {
      return next(err);
    }

    logger.error('Error desconocido en upload', {
      error: errorMessage(err),
      stack: err instanceof Error ? err.stack : undefined
    });

    return next(AppError.internal('Error al procesar archivos'));
  };
}

export default UploadMiddleware;
