// S3Util: qué error lanza cuando algo falla (la presentación lo traduce: domain-error.mapper.test.ts). Regresiones:
// un error de entrada lanzado dentro del try (key vacía, archivo sin contenido) terminaba como interno, y una falla
// transitoria de S3 también (ahora "no disponible", reintentable).

jest.mock('../providers/provider-call.util', () => ({ callProvider: jest.fn(), AWS_CLIENT_OPTIONS: {} }));
jest.mock('../observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../config', () => ({
  __esModule: true,
  default: { aws: { region: 'us-east-1', s3BucketName: 'b', s3PublicBucketName: 'p' } }
}));

import { mocked } from 'tests/helpers/mock';
import providerCallModule from '../providers/provider-call.util';
const { callProvider } = mocked(providerCallModule);
import S3Util from './s3.util';
import { ServiceUnavailableError } from '../../application/errors';

const awsError = (name: string, httpStatusCode: number) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });

describe('S3Util — errores', () => {
  beforeEach(() => jest.clearAllMocks());

  it('key vacía → dato inválido (400, no 500)', async () => {
    await expect(S3Util.deleteFile('')).rejects.toMatchObject({ kind: 'invalid_input', code: 'BAD_REQUEST', message: 'S3 key requerida' });
    await expect(S3Util.deletePublicFile('')).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('descarga sin contenido → no encontrado (404, no 500)', async () => {
    callProvider.mockResolvedValue({ Body: undefined });
    await expect(S3Util.downloadDocument('k')).rejects.toMatchObject({ kind: 'not_found', code: 'NOT_FOUND', message: 'Archivo no encontrado en S3' });
  });

  it('NoSuchKey → no encontrado', async () => {
    callProvider.mockRejectedValue(awsError('NoSuchKey', 404));
    await expect(S3Util.deleteFile('k')).rejects.toMatchObject({ kind: 'not_found', message: 'Archivo no encontrado' });
  });

  it('S3 caído (5xx tras los reintentos) → no disponible, reintentable (503)', async () => {
    callProvider.mockRejectedValue(awsError('InternalError', 500));
    const error = await S3Util.uploadDocument(Buffer.from('x'), 'a.pdf').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error).toMatchObject({ message: 'Error al subir el documento', retryable: true });
  });

  it('S3 rechazó la petición (403) → error interno (500, permanente)', async () => {
    callProvider.mockRejectedValue(awsError('AccessDenied', 403));
    await expect(S3Util.uploadDocument(Buffer.from('x'), 'a.pdf')).rejects.toMatchObject({ kind: 'internal', code: 'INTERNAL_ERROR' });
  });
});
