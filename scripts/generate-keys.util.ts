// scripts/generate-keys.util.ts
//
// Genera todas las claves necesarias para el archivo .env local.
// Ejecutar: npx tsx scripts/generate-keys.util.ts
//
// En producción estas claves las genera Terraform automáticamente
// y las guarda en Secrets Manager — no se ponen a mano.

import crypto from 'node:crypto';

const AES_KEY_BYTES = 32; // 256 bits para AES-256-GCM
const AES_IV_BYTES = 16; // 128 bits — solo para descifrar datos legados AES-CBC (GCM usa IV aleatorio por operación)
const HASH_PEPPER_BYTES = 32; // 256 bits para HMAC-SHA256 de búsquedas en BD
const API_KEY_BYTES = 24;

// ============================================================
// AES — cifrado de columnas sensibles en BD
// ============================================================

function generateEncryptionKeys() {
  const aesKey = crypto.randomBytes(AES_KEY_BYTES).toString('hex');
  const aesIv = crypto.randomBytes(AES_IV_BYTES).toString('hex');

  console.log('\n🔐 Claves AES para cifrado de datos sensibles en BD:');
  console.log('   Uso: cifrar national_id, email, teléfonos antes de guardar en PostgreSQL');
  console.log('   Algoritmo activo: AES-256-GCM (CBC solo como fallback de datos legados)\n');
  console.log(`AES_KEY=${aesKey}`);
  console.log(`AES_IV=${aesIv}`);
  console.log(`ENCRYPTION_ALGORITHM=aes-256-gcm`);
}

// ============================================================
// HASH PEPPER — búsquedas de campos cifrados en BD
// ============================================================

function generateHashPepper() {
  const pepper = crypto.randomBytes(HASH_PEPPER_BYTES).toString('hex');

  console.log('\n🔍 Hash Pepper para búsquedas de campos cifrados en BD:');
  console.log('   Uso: HMAC-SHA256(national_id | email | teléfono, HASH_PEPPER)');
  console.log('   Permite buscar por WHERE campo_hash = ? sin exponer el dato real');
  console.log('   ⚠️  Si cambias este valor, todos los hashes existentes en BD quedan inválidos\n');
  console.log(`HASH_PEPPER=${pepper}`);
}

// ============================================================
// HMAC por dispositivo — NO va en .env
// ============================================================
// El HMAC secret ya NO es global. Cada dispositivo mobile tiene
// su propio secret generado al hacer login, almacenado en
// user_trusted_devices.hmac_secret y entregado al mobile.
// Ver: migrations/20260418000004-add-hmac-secret-to-trusted-devices.js

// ============================================================
// API Keys — para servicios externos
// ============================================================

function generateApiKey(serviceName: string): string {
  const prefix = `key_${serviceName.toLowerCase().replace(/\s+/g, '_')}`;
  const random = crypto.randomBytes(API_KEY_BYTES).toString('hex');
  return `${prefix}_${random}`;
}

function generateApiKeys() {
  const services = ['kyc_service', 'notifications_service', 'external_client'];
  const apiKeys = services.map(s => generateApiKey(s));

  console.log('\n🔑 API Keys para servicios externos:');
  console.log(`EXTERNAL_API_KEYS=${apiKeys.join(',')}\n`);
  for (const [i, svc] of services.entries()) {
    console.log(`   ${svc.toUpperCase()}: ${apiKeys[i]}`);
  }
}

// ============================================================
// JWT RS256 — par de claves asimétricas para tokens de autorización
// ============================================================
//
// La clave privada firma los tokens (solo en este servidor).
// La clave pública los verifica (puede distribuirse a otros servicios).
//
// Formato: PKCS#8 (BEGIN PRIVATE KEY) + SPKI (BEGIN PUBLIC KEY)
// Los saltos de línea se escapan como \n para que quepa en una sola línea del .env.

function generateJwtKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  // Convertir los saltos de línea reales en literales \n para el .env
  const privateKeyEnv = privateKey.replace(/\n/g, '\\n');
  const publicKeyEnv = publicKey.replace(/\n/g, '\\n');

  console.log('\n🔏 JWT RS256 — Par de claves para firma de tokens:');
  console.log('   JWT_PRIVATE_KEY → firma access tokens y refresh tokens');
  console.log('   JWT_PUBLIC_KEY  → verifica tokens (puede compartirse con otros servicios)');
  console.log('   ⚠️  Si cambias estas claves, TODOS los tokens activos quedan invalidados\n');
  console.log(`JWT_PRIVATE_KEY="${privateKeyEnv}"`);
  console.log(`JWT_PUBLIC_KEY="${publicKeyEnv}"`);
  console.log('');
  console.log('   # Opcional — defaults: 28800 (8h) y 604800 (7d)');
  console.log('   # JWT_ACCESS_TOKEN_EXPIRY=28800');
  console.log('   # JWT_REFRESH_TOKEN_EXPIRY=604800');
}

// ============================================================
// hCaptcha — CAPTCHA del formulario de contacto público (RF-LP-04)
// ============================================================
//
// Las claves de hCaptcha NO se generan localmente — las entrega
// el dashboard de hCaptcha al registrar el sitio.
//
// Pasos para obtenerlas:
//   1. Ir a https://dashboard.hcaptcha.com/signup (cuenta gratuita)
//   2. Crear un sitio nuevo con el dominio del proyecto
//   3. Copiar la Site Key  → va en el .env del BACKEND y en el FRONTEND
//   4. Copiar la Secret Key → va SOLO en el .env del BACKEND (nunca al frontend)
//
// Para desarrollo local sin cuenta hCaptcha, usa las claves de prueba oficiales:
//   HCAPTCHA_SECRET_KEY = 0x0000000000000000000000000000000000000000
//   HCAPTCHA_SITE_KEY   = 10000000-ffff-ffff-ffff-000000000001
//   Estas claves siempre retornan válido — solo funcionan en modo test.
//
// En producción las gestiona Terraform vía Secrets Manager.

function showHCaptchaKeys() {
  console.log('\n🤖 hCaptcha — Verificación CAPTCHA (RF-LP-04 Formulario de Contacto):');
  console.log('   Las claves de hCaptcha las entrega el dashboard, no se generan localmente.');
  console.log('   Registro gratuito: https://dashboard.hcaptcha.com/signup\n');

  console.log('   ── Claves de PRUEBA para desarrollo local (siempre válidas) ──');
  console.log(`HCAPTCHA_SECRET_KEY=0x0000000000000000000000000000000000000000`);
  console.log(`HCAPTCHA_SITE_KEY=10000000-ffff-ffff-ffff-000000000001`);

  console.log('\n   ── Reemplaza con tus claves reales al hacer deploy ──');
  console.log(`# HCAPTCHA_SECRET_KEY=<secret-key-de-tu-cuenta-hcaptcha>   ← solo backend`);
  console.log(`# HCAPTCHA_SITE_KEY=<site-key-de-tu-cuenta-hcaptcha>       ← backend + frontend`);
}

// ============================================================
// Notas de seguridad
// ============================================================

function showSecurityNotes() {
  console.log('\n⚠️  IMPORTANTE:');
  console.log('   - Estas claves son SOLO para desarrollo local (.env)');
  console.log('   - En producción/qa/uat las genera Terraform automáticamente');
  console.log('   - NUNCA las subas a Git (verifica tu .gitignore)');
  console.log('   - NUNCA las pongas en terraform.tfvars — Terraform las genera solo');
  console.log('   - Cada desarrollador debe generar las suyas propias');
  console.log('   - El HMAC por dispositivo se genera en runtime — no va en .env');
  console.log('   - HCAPTCHA_SECRET_KEY nunca al frontend — solo vive en el backend\n');
}

// ============================================================
// Main
// ============================================================

if (require.main === module) {
  const [serviceName] = process.argv.slice(2);

  if (serviceName) {
    const apiKey = generateApiKey(serviceName);
    console.log(`\n🔑 API Key para "${serviceName}":\n${apiKey}\n`);
  } else {
    console.log('\n============================================================');
    console.log(' generate-keys.util.ts — Claves para desarrollo local');
    console.log('============================================================');
    console.log('\nCopia las siguientes líneas a tu archivo .env:\n');

    generateEncryptionKeys();
    generateHashPepper();
    generateJwtKeys();
    generateApiKeys();
    showHCaptchaKeys();
    showSecurityNotes();
  }
}

export default {
  generateEncryptionKeys,
  generateHashPepper,
  generateJwtKeys,
  generateApiKey,
  generateApiKeys,
  showHCaptchaKeys
};
