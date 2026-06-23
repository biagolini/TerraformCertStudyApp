# ============================================================================
# Lambda — Bedrock Converse Streaming Function
# ============================================================================

# --- Build Lambda Package ---

resource "null_resource" "lambda_build" {
  triggers = {
    code_hash = sha256(join("", [
      filesha256("${local.lambda_src_dir}/converse/app.py"),
      filesha256("${local.lambda_src_dir}/converse/run.sh"),
      filesha256("${local.lambda_src_dir}/converse/requirements.txt"),
    ]))
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      BUILD="${local.lambda_build_dir}/converse"
      rm -rf "$BUILD" && mkdir -p "$BUILD"
      pip3 install --platform manylinux2014_aarch64 \
        --target "$BUILD" --implementation cp --python-version 3.13 \
        --only-binary=:all: -r "${local.lambda_src_dir}/converse/requirements.txt" --quiet
      cp "${local.lambda_src_dir}/converse/app.py" "$BUILD/"
      cp "${local.lambda_src_dir}/converse/run.sh" "$BUILD/"
      chmod +x "$BUILD/run.sh"
      find "$BUILD" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
      find "$BUILD" -name "*.pyc" -delete 2>/dev/null || true
      cd "$BUILD" && zip -qr "${local.lambda_build_dir}/converse.zip" .
    EOT
  }
}

# --- Lambda Function ---

resource "aws_lambda_function" "converse" {
  function_name = "${var.project_prefix}-converse"
  role          = aws_iam_role.lambda.arn
  handler       = "run.sh"
  runtime       = "python3.13"
  architectures = ["arm64"]
  timeout       = 900
  memory_size   = 512
  filename      = "${local.lambda_build_dir}/converse.zip"

  source_code_hash = null_resource.lambda_build.triggers.code_hash

  layers = [
    "arn:aws:lambda:${var.aws_region}:753240598075:layer:LambdaAdapterLayerArm64:27"
  ]

  environment {
    variables = {
      AWS_LAMBDA_EXEC_WRAPPER = "/opt/bootstrap"
      AWS_LWA_INVOKE_MODE     = "response_stream"
      PORT                    = "8000"
      MODEL_ID                = var.bedrock_model_id
    }
  }

  depends_on = [null_resource.lambda_build]
}

# --- Function URL for Streaming ---

resource "aws_lambda_function_url" "converse" {
  function_name      = aws_lambda_function.converse.function_name
  authorization_type = "AWS_IAM"
  invoke_mode        = "RESPONSE_STREAM"
}
