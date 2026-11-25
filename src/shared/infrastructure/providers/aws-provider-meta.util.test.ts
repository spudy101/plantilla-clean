// awsErrorCode normaliza el error del SDK v3 a su `name` o, en su defecto, al status HTTP del $metadata.

import awsProviderMetaUtilModule from './aws-provider-meta.util';
const { awsErrorCode } = awsProviderMetaUtilModule;

describe('aws-provider-meta.util', () => {
  describe('awsErrorCode', () => {
    it('usa error.name cuando existe (ej: MessageRejected, NoSuchKey)', () => {
      expect(awsErrorCode({ name: 'MessageRejected' })).toBe('MessageRejected');
      expect(awsErrorCode({ name: 'NoSuchKey' })).toBe('NoSuchKey');
    });

    it('cae al httpStatusCode del $metadata cuando no hay name', () => {
      expect(awsErrorCode({ $metadata: { httpStatusCode: 503 } })).toBe(503);
    });

    it('el name tiene prioridad sobre el status del $metadata', () => {
      expect(awsErrorCode({ name: 'Throttling', $metadata: { httpStatusCode: 400 } })).toBe('Throttling');
    });

    it('devuelve null si no hay name ni status', () => {
      expect(awsErrorCode({})).toBeNull();
      expect(awsErrorCode({ $metadata: {} })).toBeNull();
    });

    it('devuelve null ante error nulo/undefined (no lanza)', () => {
      expect(awsErrorCode(null)).toBeNull();
      expect(awsErrorCode(undefined)).toBeNull();
    });
  });
});
