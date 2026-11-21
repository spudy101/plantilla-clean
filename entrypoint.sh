#!/bin/bash
# IMPORTANTE: guardar este archivo con LF (Unix), no CRLF (Windows)
set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Base Project — Iniciando"
echo "  Ambiente : ${NODE_ENV:-development}"
echo "  Secret   : ${SECRET_NAME}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -z "$SECRET_NAME" ]; then
  echo "❌ SECRET_NAME no está definido"
  exit 1
fi

echo "🔐 Leyendo configuración desde Secrets Manager..."

# Usar un script Node separado con async/await + await top-level
# para garantizar que el proceso no termine antes de resolver
EXPORTS=$(node -e "
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

async function main() {
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
  try {
    const r = await client.send(new GetSecretValueCommand({ SecretId: process.env.SECRET_NAME }));
    const data = JSON.parse(r.SecretString);
    Object.entries(data)
      .filter(([k, v]) => v !== '' && v !== null && v !== undefined)
      .forEach(([k, v]) => process.stdout.write('export ' + k + '=' + JSON.stringify(String(v)) + '\n'));
  } catch(e) {
    process.stderr.write('❌ Error leyendo secret: ' + e.message + '\n');
    process.exit(1);
  }
}

main();
")

# Verificar que obtuvimos variables
if [ -z "$EXPORTS" ]; then
  echo "❌ No se obtuvieron variables desde Secrets Manager"
  exit 1
fi

# Aplicar los exports al entorno actual
eval "$EXPORTS"

echo "✅ Variables cargadas"
echo "🔄 Ejecutando migraciones..."
npm run db:migrate --silent
echo "✅ Migraciones completadas"

if [ "$RUN_SEEDS" = "true" ]; then
  echo "🌱 Ejecutando seed..."
  npm run db:seed --silent && echo "✅ Seed completado" || echo "⚠️  Seed falló (no crítico)"
fi

echo "🚀 Iniciando servidor en puerto 4000..."
exec node dist/src/server.js