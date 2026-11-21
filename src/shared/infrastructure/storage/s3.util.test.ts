// S3Util: qué responde cuando algo falla. Regresiones: un 4xx lanzado dentro del try (key vacía, archivo
// sin contenido) terminaba como 500, y una falla transitoria de S3 también (ahora 503 temporal).

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

const awsError = (name: string, httpStatusCode: number) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });

describe('S3Util — errores', () => {
  beforeEach(() => jest.clearAllMocks());

  it('key vacía → 400 (no 500)', async () => {
    await expect(S3Util.deleteFile('')).rejects.toMatchObject({ statusCode: 400 });
    await expect(S3Util.deletePublicFile('')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('descarga sin contenido → 404 (no 500)', async () => {
    callProvider.mockResolvedValue({ Body: undefined });
    await expect(S3Util.downloadDocument('k')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('NoSuchKey → 404', async () => {
    callProvider.mockRejectedValue(awsError('NoSuchKey', 404));
    await expect(S3Util.deleteFile('k')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('S3 caído (5xx tras los reintentos) → 503 temporal', async () => {
    callProvider.mockRejectedValue(awsError('InternalError', 500));
    await expect(S3Util.uploadDocument(Buffer.from('x'), 'a.pdf')).rejects.toMatchObject({ statusCode: 503, retryable: true });
  });

  it('S3 rechazó la petición (403) → 500 permanente', async () => {
    callProvider.mockRejectedValue(awsError('AccessDenied', 403));
    await expect(S3Util.uploadDocument(Buffer.from('x'), 'a.pdf')).rejects.toMatchObject({ statusCode: 500, retryable: false });
  });
});
