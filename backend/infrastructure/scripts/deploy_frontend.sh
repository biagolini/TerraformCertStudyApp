#!/bin/bash
set -euo pipefail

echo "=========================================="
echo "  Frontend Deploy — Cert Study Assistant"
echo "=========================================="

FRONTEND_DIR=$(cd "$FRONTEND_DIR" && pwd)

# --- Step 1: Generate environment.ts ---
echo "[1/3] Generating environment.ts..."

cat > "$FRONTEND_DIR/src/environments/environment.ts" <<EOF
export const environment = {
  production: true,
  apiUrl: '${API_URL}',
  cognito: {
    userPoolId: '${COGNITO_USER_POOL_ID}',
    clientId: '${COGNITO_CLIENT_ID}',
    domain: '${COGNITO_DOMAIN}',
    redirectUri: 'https://${FRONTEND_DOMAIN}/callback',
    logoutUri: 'https://${FRONTEND_DOMAIN}',
  },
};
EOF

echo "  -> environment.ts generated"

# --- Step 2: Build Angular app for AWS (baseHref=/) ---
echo "[2/3] Building Angular app..."
cd "$FRONTEND_DIR"
npm install --silent --legacy-peer-deps
npx ng build --configuration=production --base-href="/"

# --- Step 3: Sync to S3 with proper cache headers ---
echo "[3/3] Syncing build to S3 bucket: $S3_BUCKET"

BUILD_DIR="$FRONTEND_DIR/dist"
PROFILE_FLAG=${AWS_PROFILE:+--profile "$AWS_PROFILE"}

# Sync hashed assets (JS/CSS chunks) — long cache (1 year), immutable
aws s3 sync "$BUILD_DIR" "s3://$S3_BUCKET" \
  --delete \
  --region "$AWS_REGION" \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "index.html" \
  $PROFILE_FLAG

# Upload index.html — no cache (always revalidate)
aws s3 cp "$BUILD_DIR/index.html" "s3://$S3_BUCKET/index.html" \
  --region "$AWS_REGION" \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html" \
  $PROFILE_FLAG

echo "=========================================="
echo "  Frontend deploy complete!"
echo "=========================================="
