/**
 * Configuration module
 *
 * Responsabilidad única: leer, parsear y validar variables de entorno.
 * Las constantes fijas de la aplicación viven en shared/constants/index.ts
 */

import dotenv from 'dotenv';

dotenv.config();

// ==============================================
// CUSTOM ERROR
// ==============================================

class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

// ==============================================
// HELPERS — parseo de env vars
// ==============================================

const parseIntEnv = <T extends number | null>(value: string | undefined, defaultValue: T): number | T => {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
};

const parseBoolEnv = (value: string | undefined, defaultValue = false): boolean => {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return value === 'true' || value === '1';
};

const getRequiredEnv = (key: string): string => {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new ConfigurationError(`Variable de entorno requerida faltante: ${key}`);
  }
  return value.trim();
};

const getOptionalEnv = (key: string, defaultValue = ''): string => {
  const value = process.env[key];
  return value && value.trim() !== '' ? value.trim() : defaultValue;
};

// ==============================================
// VALIDATORS
// ==============================================

const validateNodeEnv = (warnings: string[]): void => {
  const validEnvs = ['development', 'production', 'test'];
  const nodeEnv = process.env.NODE_ENV;
  if (!nodeEnv || !validEnvs.includes(nodeEnv)) {
    warnings.push(`NODE_ENV="${nodeEnv}" no es estándar. Valores válidos: ${validEnvs.join(', ')}`);
  }
};

const validateDatabase = (errors: string[]): void => {
  const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  for (const key of required) {
    if (!process.env[key]) {
      errors.push(`DB — variable requerida faltante: ${key}`);
    }
  }
};

const validateEncryption = (errors: string[]): void => {
  if (!process.env.AES_KEY) {
    errors.push('ENCRYPTION — AES_KEY es requerido. Generar con: node scripts/generate-keys.util.js');
  } else if (process.env.AES_KEY.length !== 64) {
    errors.push(`ENCRYPTION — AES_KEY debe tener 64 caracteres hex (32 bytes). Tiene ${process.env.AES_KEY.length}.`);
  }

  if (!process.env.AES_IV) {
    errors.push('ENCRYPTION — AES_IV es requerido. Generar con: node scripts/generate-keys.util.js');
  } else if (process.env.AES_IV.length !== 32) {
    errors.push(`ENCRYPTION — AES_IV debe tener 32 caracteres hex (16 bytes). Tiene ${process.env.AES_IV.length}.`);
  }

  if (!process.env.HASH_PEPPER) {
    const HASH_PEPPER_CMD = "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"";
    errors.push(`ENCRYPTION — HASH_PEPPER es requerido para búsquedas de campos cifrados. Generar con: ${HASH_PEPPER_CMD}`);
  } else if (process.env.HASH_PEPPER.length < 32) {
    errors.push(`ENCRYPTION — HASH_PEPPER debe tener al menos 32 caracteres. Tiene ${process.env.HASH_PEPPER.length}.`);
  }
};

const validateCors = (warnings: string[]): void => {
  if (process.env.NODE_ENV === 'production' && process.env.CORS_ORIGIN === '*') {
    warnings.push('CORS_ORIGIN="*" en producción es inseguro. Define los orígenes permitidos.');
  }
};

const validateAws = (errors: string[]): void => {
  const required = [
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'BUCKET_NAME',
    // ── Bucket público y CloudFront — requeridos para el mantenedor de políticas
    'S3_PUBLIC_BUCKET_NAME',
    'CLOUDFRONT_DISTRIBUTION_ID',
    'CLOUDFRONT_BASE_URL'
  ];
  for (const key of required) {
    if (!process.env[key]) {
      errors.push(`AWS — variable requerida faltante: ${key}`);
    }
  }
};

const validateFrontend = (errors: string[]): void => {
  if (!process.env.FRONTEND_RESET_URL) {
    errors.push('FRONTEND — FRONTEND_RESET_URL es requerido');
  }
};

const validateJwt = (errors: string[]): void => {
  if (!process.env.JWT_PRIVATE_KEY) {
    errors.push('JWT — JWT_PRIVATE_KEY es requerido (PEM RS256 PKCS#8)');
  }
  if (!process.env.JWT_PUBLIC_KEY) {
    errors.push('JWT — JWT_PUBLIC_KEY es requerido (PEM RS256 SPKI)');
  }
};

// ==============================================
// VALIDACIÓN GLOBAL
// ==============================================

const validateConfig = (): { errors: string[]; warnings: string[] } => {
  const errors: string[] = [];
  const warnings: string[] = [];

  validateNodeEnv(warnings);
  validateDatabase(errors);
  validateEncryption(errors);
  validateCors(warnings);
  validateAws(errors);
  validateJwt(errors);
  validateFrontend(errors);

  return { errors, warnings };
};

// ==============================================
// BUILDERS
// ==============================================

const _buildServerConfig = () => ({
  nodeEnv: getOptionalEnv('NODE_ENV', 'development'),
  port: parseIntEnv(process.env.PORT, 4000),
  host: getOptionalEnv('HOST', 'localhost'),
  corsOrigin: getOptionalEnv('CORS_ORIGIN', '*'),
  localhost: getOptionalEnv('LOCALHOST', '')
});

const _buildDatabaseConfig = () => ({
  host: getRequiredEnv('DB_HOST'),
  port: parseIntEnv(process.env.DB_PORT, 5432),
  name: getRequiredEnv('DB_NAME'),
  user: getRequiredEnv('DB_USER'),
  password: getRequiredEnv('DB_PASSWORD'),
  logging: parseBoolEnv(process.env.DB_LOGGING, false),
  schema: getOptionalEnv('DB_SCHEMA', 'public'),
  // [RF-OPS-01][CA-05]: path al bundle CA de RDS para validación
  // TLS. Vacío en localhost (SSL no aplica).
  rdsCaBundlePath: getOptionalEnv('RDS_CA_BUNDLE_PATH', '')
});

const _buildRedisConfig = () => ({
  enabled: !!(process.env.REDIS_HOST || process.env.REDIS_URL),
  url: getOptionalEnv('REDIS_URL'),
  host: getOptionalEnv('REDIS_HOST', 'localhost'),
  port: parseIntEnv(process.env.REDIS_PORT, 6379),
  password: getOptionalEnv('REDIS_PASSWORD'),
  db: parseIntEnv(process.env.REDIS_DB, 0)
});

const _buildEncryptionConfig = () => ({
  aesKey: getRequiredEnv('AES_KEY'),
  aesIv: getRequiredEnv('AES_IV'),
  hashPepper: getRequiredEnv('HASH_PEPPER'),
  // [RF-OPS-01][CA-05]: el código usa AES-256-GCM en EncryptionUtil.
  // CBC solo existe como fallback de descifrado de datos legados.
  // Este valor refleja el algoritmo activo, no el legado.
  algorithm: getOptionalEnv('ENCRYPTION_ALGORITHM', 'aes-256-gcm'),
  externalApiKeys: getOptionalEnv('EXTERNAL_API_KEYS')
});

const _buildAwsConfig = () => ({
  region: getRequiredEnv('AWS_REGION'),
  accessKeyId: getRequiredEnv('AWS_ACCESS_KEY_ID'),
  secretAccessKey: getRequiredEnv('AWS_SECRET_ACCESS_KEY'),
  // Bucket privado — datos de usuarios
  s3BucketName: getRequiredEnv('BUCKET_NAME'),
  // Bucket público — assets de empresa (logo, políticas de privacidad)
  s3PublicBucketName: getRequiredEnv('S3_PUBLIC_BUCKET_NAME'),
  cloudfrontDistributionId: getRequiredEnv('CLOUDFRONT_DISTRIBUTION_ID'),
  cloudfrontBaseUrl: getRequiredEnv('CLOUDFRONT_BASE_URL')
});

const _buildNotificationsConfig = () => ({
  sns: {
    platformArnIos: getOptionalEnv('SNS_PLATFORM_ARN_IOS'),
    platformArnAndroid: getOptionalEnv('SNS_PLATFORM_ARN_ANDROID'),
    // Topic SNS al que SES publica los bounces de correo. Si se define, el webhook rechaza mensajes
    // de otros topics (defensa extra sobre la verificación de firma).
    bounceTopicArn: getOptionalEnv('SNS_BOUNCE_TOPIC_ARN')
  },
  ses: {
    fromEmail: getOptionalEnv('SES_FROM_EMAIL'),
    // [RF-LP-01] | CA-02, CA-03 | URLs públicas CloudFront para assets institucionales
    logoUrl: getOptionalEnv('LOGO_URL'),
    adminEmail: getOptionalEnv('ADMIN_EMAIL'),
    privacyPolicyUrl: getOptionalEnv('PRIVACY_POLICY_URL')
  },
  // Tope por minuto de los envíos masivos (notificaciones globales), compartido entre instancias vía
  // Redis. Ajustar a la cuota real de la cuenta de AWS (SES: sending rate; SNS: publish rate).
  rateLimits: {
    snsPerMinute: parseIntEnv(process.env.SNS_RATE_LIMIT_PER_MINUTE, 300),
    sesPerMinute: parseIntEnv(process.env.SES_RATE_LIMIT_PER_MINUTE, 200)
  }
});

// TODO [RF-LP-01][CA-01]: Evaluar agregar Cache-Control headers (max-age, s-maxage) en endpoints GET públicos
// TODO [RF-LP-01][CA-01]: Evaluar cache Redis de respuestas para endpoints GET públicos de
//   solo-lectura (catálogos, banners) — actualmente leen BD en cada request
// TODO [RF-LP-01][CA-06]: No existe tabla/modelo con la identidad institucional de Base Project
//   (razón social, NIT, número SFC/Sandbox, dirección, contacto oficial). Los datos del footer
//   no están modelados en BD; hoy solo hay URLs de assets (LOGO_URL, PRIVACY_POLICY_URL).

const _buildSeedsConfig = () => ({
  adminEmail: getOptionalEnv('SEED_ADMIN_EMAIL'),
  adminFirstName: getOptionalEnv('SEED_ADMIN_FIRST_NAME'),
  adminLastName: getOptionalEnv('SEED_ADMIN_LAST_NAME'),
  adminNationalId: getOptionalEnv('SEED_ADMIN_NATIONAL_ID'),
  adminPassword: getOptionalEnv('SEED_ADMIN_PASSWORD')
});

// === RF-AUTH-02: Login, Gestión de Sesión Segura y Recuperación de Contraseña ===
const _buildJwtConfig = () => ({
  // Las claves PEM se guardan en .env con \n literal — se reemplazan al leer
  privateKey: (process.env.JWT_PRIVATE_KEY || '').replaceAll('\\n', '\n'),
  publicKey: (process.env.JWT_PUBLIC_KEY || '').replaceAll('\\n', '\n'),
  // [RF-AUTH-02] | CA-01 | Access token: 15 min (web y móvil). La sesión se corta por
  // inactividad (worker + middleware); el access corto limita la ventana de un token huérfano.
  accessTokenExpiry: parseIntEnv(process.env.JWT_ACCESS_TOKEN_EXPIRY, 900), // 15 minutos
  // [RF-AUTH-02] | CA-01 | Legacy: el tope absoluto real del refresh token son 24h, fijado en
  // JwtUtil.generateRefreshToken (exp) y RefreshTokenStore (TTL Redis). Antes de eso la sesión
  // muere por inactividad, logout o rotación. Esta env var ya no se consume en código.
  refreshTokenExpiry: parseIntEnv(process.env.JWT_REFRESH_TOKEN_EXPIRY, 604800)
});

const _buildHCaptchaConfig = () => ({
  secretKey: getOptionalEnv('HCAPTCHA_SECRET_KEY'),
  siteKey: getOptionalEnv('HCAPTCHA_SITE_KEY')
});

const loadConfig = () => {
  const { errors, warnings } = validateConfig();

  if (warnings.length > 0) {
    console.warn('\n⚠️  ADVERTENCIAS DE CONFIGURACIÓN:');
    for (const w of warnings) {
      console.warn(`   ${w}`);
    }
    console.warn('');
  }

  if (errors.length > 0) {
    console.error('\n❌ ERRORES DE CONFIGURACIÓN:');
    for (const e of errors) {
      console.error(`   • ${e}`);
    }
    console.error('\n💡 Revisa tu .env y completa las variables requeridas.\n');
    throw new ConfigurationError(`Faltan ${errors.length} variable(s) de entorno requerida(s)`);
  }

  console.log('✅ Configuración validada correctamente\n');

  return {
    server: _buildServerConfig(),
    database: _buildDatabaseConfig(),
    redis: _buildRedisConfig(),
    encryption: _buildEncryptionConfig(),
    aws: _buildAwsConfig(),
    frontend: {
      resetCredentialUrl: getRequiredEnv('FRONTEND_RESET_URL')
    },
    jwt: _buildJwtConfig(),
    seeds: _buildSeedsConfig(),
    notifications: _buildNotificationsConfig(),
    hcaptcha: _buildHCaptchaConfig(),
    workers: {
      enabled: parseBoolEnv(process.env.ENABLE_WORKERS, true)
    },
    logging: {
      level: getOptionalEnv('LOG_LEVEL', 'info'),
      // Días que se conserva la traza de operaciones (tabla operations); la auditoría tiene su propia retención
      operationsRetentionDays: parseIntEnv(process.env.OPERATIONS_RETENTION_DAYS, 90)
    },
    // Mock de proveedores externos: mientras no exista la integración real de
    // SMS/biométrico, se simula la aprobación/envío para desbloquear el onboarding
    // y el MFA. Default: activo fuera de producción, apagado en producción.
    mocks: {
      externalProviders: parseBoolEnv(process.env.MOCK_EXTERNAL_PROVIDERS, process.env.NODE_ENV !== 'production')
    }
  };
};

// ==============================================
// SINGLETON
// ==============================================

let config: ReturnType<typeof loadConfig>;

try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error(`\n❌ ERROR DE CONFIGURACIÓN: ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

export default config;
