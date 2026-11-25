// ACTUALIZADO: soporte para DOS buckets independientes
//
//   BUCKET PRIVADO (s3BucketName / BUCKET_NAME)
//     → Archivos de usuarios: documentos KYC, imágenes de perfil, etc.
//     → Acceso: presigned URLs temporales (nunca URLs públicas)
//     → Métodos: uploadImage, uploadDocument, generatePresignedUrl, deleteFile
//
//   BUCKET PÚBLICO (s3PublicBucketName / S3_PUBLIC_BUCKET_NAME)
//     → Assets de empresa: logo, políticas de privacidad
//     → Acceso: URL pública via CloudFront (cloudfront_base_url + key)
//     → Métodos: uploadPublicDocument, deletePublicFile
//     → Después de subir: invalidar caché CloudFront con invalidateCloudFront()
//
// REGLA DE ORO: nunca mezclar buckets.
//   uploadDocument  → siempre BUCKET PRIVADO
//   uploadPublicDocument → siempre BUCKET PÚBLICO

import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import loggerUtilModule from '../observability/logger.util';
const { logger } = loggerUtilModule;
import { InternalError, InvalidInputError, NotFoundError } from '../../domain/errors/domain-error';
import { isExpectedError } from '../../application/errors';
import constantsModule from '../config';
const { aws } = constantsModule;
import { callProvider, AWS_CLIENT_OPTIONS } from '../providers/provider-call.util';
import { providerFailure } from '../providers/provider-errors';
import errorMessageModule from '../../kernel/error-message.util';

const { errorMessage, errorName } = errorMessageModule;


const DEFAULT_PRESIGNED_EXPIRES = 3600; // 1 hora — documentos normales
const SENSITIVE_PRESIGNED_EXPIRES = 900; // 15 min — documentos sensibles

/** Opciones de compresión de imágenes (sharp). */
interface ImageUploadOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: keyof import('sharp').FormatEnum;
}

class S3Util {
  private static _s3Client: InstanceType<typeof S3Client> | undefined;
  private static _bucketName: string | undefined;
  private static _publicBucketName: string | undefined;
  private static _cloudFrontClient: InstanceType<typeof CloudFrontClient> | undefined;

  // ============================================================
  // CLIENTS — lazy, resueltos al primer uso
  // ============================================================

  static get s3Client() {
    if (!this._s3Client) {
      this._s3Client = new S3Client({ ...AWS_CLIENT_OPTIONS, region: aws.region });
    }
    return this._s3Client;
  }

  /** Toda llamada de red a S3 pasa por acá: circuit breaker, reintentos, timeout y log (callProvider). */
  private static call<T>(endpoint: string, run: (client: InstanceType<typeof S3Client>, abortSignal: AbortSignal) => Promise<T>): Promise<T> {
    return callProvider({ product: 's3', endpoint }, abortSignal => run(S3Util.s3Client, abortSignal));
  }

  /** Bucket PRIVADO — datos de usuarios */
  static get bucketName() {
    if (!this._bucketName) {
      this._bucketName = aws.s3BucketName;
    }
    return this._bucketName;
  }

  /** Bucket PÚBLICO — assets de empresa (logo, políticas) */
  static get publicBucketName() {
    if (!this._publicBucketName) {
      this._publicBucketName = aws.s3PublicBucketName;
    }
    return this._publicBucketName;
  }

  /** Cliente CloudFront — para invalidar caché después de subir al bucket público */
  static get cloudFrontClient() {
    if (!this._cloudFrontClient) {
      // CloudFront siempre opera en us-east-1 independientemente del bucket
      this._cloudFrontClient = new CloudFrontClient({ region: 'us-east-1' });
    }
    return this._cloudFrontClient;
  }

  // ============================================================
  // PRESIGNED URL — acceso temporal a objetos PRIVADOS
  // ============================================================

  /**
   * Genera una URL firmada para acceso temporal a un objeto del bucket PRIVADO.
   *
   * @param {string} key        - Key del objeto (ej: 'archivos_empresas/docs/uuid.pdf')
   * @param {number} expiresIn  - Segundos de validez (default: 3600)
   * @returns {Promise<string>} URL firmada
   */
  static async generatePresignedUrl(key: string, expiresIn = DEFAULT_PRESIGNED_EXPIRES) {
    if (!key) {
      throw new InvalidInputError('S3 key requerida para generar presigned URL', 'BAD_REQUEST');
    }

    try {
      const command = new GetObjectCommand({
        Bucket: S3Util.bucketName,
        Key: key
      });

      const url = await getSignedUrl(S3Util.s3Client, command, { expiresIn });

      logger.debug('Presigned URL generada', {
        key,
        expiresIn,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
      });

      return url;
    } catch (error) {
      logger.error('Error generando presigned URL', { error: errorMessage(error), key });
      throw new InternalError('Error al generar URL de acceso al archivo', 'INTERNAL_ERROR');
    }
  }

  /** Presigned URL de corta duración para documentos sensibles (15 min). */
  static generateSensitivePresignedUrl(key: string) {
    return S3Util.generatePresignedUrl(key, SENSITIVE_PRESIGNED_EXPIRES);
  }

  /**
   * Descarga un objeto del bucket PRIVADO como Buffer (uso servidor→servidor, sin presigned).
   * Ej.: leer un documento almacenado para procesarlo en el servidor.
   * @param {string} key - Key del objeto
   * @returns {Promise<Buffer>}
   */
  static async downloadDocument(key: string) {
    if (!key) {
      throw new InvalidInputError('S3 key requerida para descargar el documento', 'BAD_REQUEST');
    }
    try {
      const response = await S3Util.call('S3:GetObject', (c, abortSignal) => c.send(new GetObjectCommand({ Bucket: S3Util.bucketName, Key: key }), { abortSignal }));
      if (!response.Body) {
        throw new NotFoundError('Archivo no encontrado en S3', 'NOT_FOUND');
      }
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error) {
      logger.error('Error descargando documento de S3', { error: errorMessage(error), key });
      if (errorName(error) === 'NoSuchKey' || errorName(error) === 'NotFound') {
        throw new NotFoundError('Archivo no encontrado en S3', 'NOT_FOUND');
      }
      throw providerFailure(error, 'Error al descargar el documento');
    }
  }

  // ============================================================
  // UPLOAD PRIVADO — bucket de usuarios → retorna S3 KEY
  // ============================================================

  /**
   * Sube una imagen al bucket PRIVADO con compresión.
   * Retorna la KEY — el acceso se hace vía generatePresignedUrl().
   *
   * @param {Buffer|string} imageBuffer
   * @param {string} folder
   * @param {Object} options
   * @returns {Promise<string>} S3 key
   */
  static async uploadImage(imageBuffer: Buffer | string, folder = 'images', options: ImageUploadOptions = {}) {
    try {
      if (!imageBuffer) {
        throw new InvalidInputError('No se proporcionó ninguna imagen', 'BAD_REQUEST');
      }

      let buffer = imageBuffer;
      if (typeof imageBuffer === 'string' && imageBuffer.includes('base64')) {
        const base64Data = imageBuffer.split(',')[1] || imageBuffer;
        buffer = Buffer.from(base64Data, 'base64');
      }

      const { maxWidth = 1920, maxHeight = 1080, quality = 80, format = 'jpeg' } = options;

      const compressedBuffer = await sharp(buffer)
        .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
        .toFormat(format, { quality })
        .toBuffer();

      const s3Key = `archivos_empresas/${folder}/${uuidv4()}.${format}`;
      await S3Util.call('S3:PutObject', (c, abortSignal) =>
        c.send(new PutObjectCommand({ Bucket: S3Util.bucketName, Key: s3Key, Body: compressedBuffer, ContentType: `image/${format}` }), { abortSignal })
      );

      logger.info('Imagen subida a S3 privado', {
        s3Key,
        originalSize: buffer.length,
        compressedSize: compressedBuffer.length,
        reduction: `${(((buffer.length - compressedBuffer.length) / buffer.length) * 100).toFixed(2)}%`
      });

      return s3Key;
    } catch (error) {
      logger.error('Error subiendo imagen a S3', { error: errorMessage(error), folder });
      if (isExpectedError(error)) {
        throw error;
      }
      if (errorMessage(error)?.includes('Input buffer') || errorMessage(error)?.includes('unsupported')) {
        throw new InvalidInputError('Formato de imagen no válido', 'BAD_REQUEST');
      }
      throw providerFailure(error, 'Error al subir la imagen');
    }
  }

  /**
   * Sube un documento al bucket PRIVADO.
   * Retorna la KEY — el acceso se hace vía generatePresignedUrl().
   *
   * @param {Buffer|string} fileBuffer
   * @param {string} fileName
   * @param {string} folder
   * @param {string} contentType
   * @returns {Promise<string>} S3 key
   */
  static async uploadDocument(fileBuffer: Buffer | string, fileName: string, folder = 'documents', contentType = 'application/pdf') {
    try {
      if (!fileBuffer) {
        throw new InvalidInputError('No se proporcionó ningún archivo', 'BAD_REQUEST');
      }
      if (!fileName) {
        throw new InvalidInputError('Nombre de archivo requerido', 'BAD_REQUEST');
      }

      let buffer = fileBuffer;
      if (typeof fileBuffer === 'string' && fileBuffer.includes('base64')) {
        const base64Data = fileBuffer.split(',')[1] || fileBuffer;
        buffer = Buffer.from(base64Data, 'base64');
      }

      const extension = fileName.split('.').pop();
      const s3Key = `archivos_empresas/${folder}/${uuidv4()}.${extension}`;
      await S3Util.call('S3:PutObject', (c, abortSignal) =>
        c.send(new PutObjectCommand({ Bucket: S3Util.bucketName, Key: s3Key, Body: buffer, ContentType: contentType }), { abortSignal })
      );

      logger.info('Documento subido a S3 privado', {
        s3Key,
        originalFileName: fileName,
        size: buffer.length,
        contentType
      });

      return s3Key;
    } catch (error) {
      logger.error('Error subiendo documento a S3', { error: errorMessage(error), fileName, folder });
      if (isExpectedError(error)) {
        throw error;
      }
      throw providerFailure(error, 'Error al subir el documento');
    }
  }

  // ============================================================
  // UPLOAD PÚBLICO — bucket de empresa → retorna URL CloudFront
  // ============================================================

  /**
   * Sube un documento al bucket PÚBLICO de empresa.
   * Retorna la URL pública de CloudFront (no una key).
   *
   * Usar para: políticas de privacidad, logo, assets estáticos.
   * El archivo es accesible públicamente vía CloudFront.
   *
   * @param {Buffer} fileBuffer    - Buffer del archivo
   * @param {string} s3Key         - Key destino (ej: 'legal/privacy-policy-v1.1.pdf')
   * @param {string} contentType   - MIME type (default: 'application/pdf')
   * @returns {Promise<string>}    URL pública CloudFront del archivo
   *
   * @example
   *   const url = await S3Util.uploadPublicDocument(
   *     buffer,
   *     'legal/privacy-policy-v1.1.pdf',
   *     'application/pdf'
   *   );
   *   // url = 'https://xxx.cloudfront.net/legal/privacy-policy-v1.1.pdf'
   */
  /**
   * Copia de archivo (retención fría) en el bucket privado: clase STANDARD_IA. Sobrescribe si la key existe,
   * así el que la llama puede reintentar sin duplicar.
   */
  static async uploadArchive(s3Key: string, body: string, contentType = 'application/x-ndjson'): Promise<void> {
    await S3Util.call('S3:PutObject', (c, abortSignal) =>
      c.send(
        new PutObjectCommand({ Bucket: S3Util.bucketName, Key: s3Key, Body: Buffer.from(body), ContentType: contentType, StorageClass: 'STANDARD_IA' }),
        { abortSignal }
      )
    );
  }

  static async uploadPublicDocument(fileBuffer: Buffer, s3Key: string, contentType = 'application/pdf') {
    try {
      if (!fileBuffer) {
        throw new InvalidInputError('No se proporcionó ningún archivo', 'BAD_REQUEST');
      }
      if (!s3Key) {
        throw new InvalidInputError('S3 key de destino requerida', 'BAD_REQUEST');
      }

      await S3Util.call('S3:PutObject', (c, abortSignal) =>
        c.send(new PutObjectCommand({ Bucket: S3Util.publicBucketName, Key: s3Key, Body: fileBuffer, ContentType: contentType }), { abortSignal })
      );

      // Construir URL pública via CloudFront
      const cloudfrontBaseUrl = aws.cloudfrontBaseUrl.replace(/\/$/, '');
      const publicUrl = `${cloudfrontBaseUrl}/${s3Key}`;

      logger.info('Documento subido a S3 público', {
        s3Key,
        publicUrl,
        size: fileBuffer.length,
        contentType
      });

      return publicUrl;
    } catch (error) {
      logger.error('Error subiendo documento público a S3', { error: errorMessage(error), s3Key });
      if (isExpectedError(error)) {
        throw error;
      }
      throw providerFailure(error, 'Error al subir el documento público');
    }
  }

  // ============================================================
  // CLOUDFRONT — invalidación de caché
  // ============================================================

  /**
   * Invalida uno o varios paths en CloudFront.
   * Llamar siempre después de uploadPublicDocument() para que
   * el nuevo archivo sea visible de inmediato.
   *
   * @param {string|string[]} paths - Paths a invalidar (ej: '/legal/privacy-policy-v1.1.pdf')
   * @returns {Promise<string>} ID de la invalidación creada
   *
   * @example
   *   await S3Util.invalidateCloudFront('/legal/privacy-policy-v1.1.pdf');
   *   await S3Util.invalidateCloudFront(['/legal/*', '/brand/logo.png']);
   */
  static async invalidateCloudFront(paths: string | string[]) {
    try {
      const pathArray = Array.isArray(paths) ? paths : [paths];
      const normalized = pathArray.map(p => (p.startsWith('/') ? p : `/${p}`));

      const command = new CreateInvalidationCommand({
        DistributionId: aws.cloudfrontDistributionId,
        InvalidationBatch: {
          CallerReference: `invalidation-${Date.now()}`,
          Paths: {
            Quantity: normalized.length,
            Items: normalized
          }
        }
      });

      const response = await S3Util.cloudFrontClient.send(command);
      const invalidationId = response.Invalidation?.Id;

      logger.info('Invalidación CloudFront creada', {
        invalidationId,
        paths: normalized,
        distributionId: aws.cloudfrontDistributionId
      });

      return invalidationId;
    } catch (error) {
      // No es crítico — el archivo ya está en S3, solo la caché tardará en actualizarse
      logger.error('Error creando invalidación CloudFront', {
        error: errorMessage(error),
        paths
      });
      // No lanzar — dejar que el flujo continúe
      return null;
    }
  }

  // ============================================================
  // DELETE
  // ============================================================

  /**
   * Elimina un archivo del bucket PRIVADO por su KEY.
   * @param {string} s3Key
   */
  static async deleteFile(s3Key: string) {
    try {
      if (!s3Key) {
        throw new InvalidInputError('S3 key requerida', 'BAD_REQUEST');
      }

      await S3Util.call('S3:DeleteObject', (c, abortSignal) => c.send(new DeleteObjectCommand({ Bucket: S3Util.bucketName, Key: s3Key }), { abortSignal }));

      logger.info('Archivo eliminado de S3 privado', { s3Key });
      return true;
    } catch (error) {
      logger.error('Error eliminando archivo de S3', { error: errorMessage(error), s3Key });
      if (isExpectedError(error)) {
        throw error;
      }
      if (errorName(error) === 'NoSuchKey') {
        throw new NotFoundError('Archivo no encontrado', 'NOT_FOUND');
      }
      throw providerFailure(error, 'Error al eliminar el archivo');
    }
  }

  /**
   * Elimina un archivo del bucket PÚBLICO de empresa por su KEY.
   * @param {string} s3Key - Key del objeto (ej: 'legal/privacy-policy-v1.0.pdf')
   */
  static async deletePublicFile(s3Key: string) {
    try {
      if (!s3Key) {
        throw new InvalidInputError('S3 key requerida', 'BAD_REQUEST');
      }

      await S3Util.call('S3:DeleteObject', (c, abortSignal) => c.send(new DeleteObjectCommand({ Bucket: S3Util.publicBucketName, Key: s3Key }), { abortSignal }));

      logger.info('Archivo eliminado de S3 público', { s3Key });
      return true;
    } catch (error) {
      logger.error('Error eliminando archivo público de S3', { error: errorMessage(error), s3Key });
      if (isExpectedError(error)) {
        throw error;
      }
      if (errorName(error) === 'NoSuchKey') {
        throw new NotFoundError('Archivo no encontrado', 'NOT_FOUND');
      }
      throw providerFailure(error, 'Error al eliminar el archivo público');
    }
  }

  // ============================================================
  // HELPERS
  // ============================================================

  /**
   * Extrae la S3 key de una URL pública antigua (migración).
   */
  static extractKeyFromUrl(publicUrl: string | null | undefined) {
    if (!publicUrl) {
      return null;
    }
    try {
      const url = new URL(publicUrl);
      const parts = url.pathname.split(`/${S3Util.bucketName}/`);
      if (parts.length === 2) {
        return parts[1];
      }
      return url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
    } catch {
      return null;
    }
  }

  /**
   * Verifica si un objeto existe en el bucket PRIVADO.
   */
  static async fileExists(s3Key: string) {
    try {
      if (!s3Key) {
        return false;
      }
      await S3Util.call('S3:HeadObject', (c, abortSignal) => c.send(new HeadObjectCommand({ Bucket: S3Util.bucketName, Key: s3Key }), { abortSignal }));
      return true;
    } catch (error) {
      if (errorName(error) === 'NotFound' || errorName(error) === 'NoSuchKey') {
        return false;
      }
      logger.error('Error verificando existencia en S3', { error: errorMessage(error), s3Key });
      return false;
    }
  }

  // ============================================================
  // BATCH
  // ============================================================

  static uploadMultipleImages(images: Array<Buffer | string>, folder = 'images', options: ImageUploadOptions = {}) {
    if (!Array.isArray(images) || images.length === 0) {
      throw new InvalidInputError('Se requiere un array de imágenes', 'BAD_REQUEST');
    }
    return Promise.all(images.filter(Boolean).map(img => S3Util.uploadImage(img, folder, options)));
  }

  static async deleteMultipleFiles(s3Keys: string[]) {
    if (!Array.isArray(s3Keys) || s3Keys.length === 0) {
      throw new InvalidInputError('Se requiere un array de keys', 'BAD_REQUEST');
    }
    await Promise.all(s3Keys.filter(Boolean).map(key => S3Util.deleteFile(key)));
    return true;
  }
}

export default S3Util;
