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

# --- Step 3: Sync to S3 ---
echo "[3/3] Syncing build to S3 bucket: $S3_BUCKET"

BUILD_DIR="$FRONTEND_DIR/dist"

aws s3 sync "$BUILD_DIR" "s3://$S3_BUCKET" --delete --region "$AWS_REGION" ${AWS_PROFILE:+--profile "$AWS_PROFILE"}

echo "=========================================="
echo "  Frontend deploy complete!"
echo "=========================================="
