# ============================================================================
# Lambda — Data CRUD Function (DynamoDB)
# ============================================================================

# --- Build Lambda Package ---

resource "null_resource" "lambda_data_build" {
  triggers = {
    code_hash = sha256(join("", [
      filesha256("${local.lambda_src_dir}/data/app.py"),
      filesha256("${local.lambda_src_dir}/data/run.sh"),
      filesha256("${local.lambda_src_dir}/data/requirements.txt"),
    ]))
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      BUILD="${local.lambda_build_dir}/data"
      rm -rf "$BUILD" && mkdir -p "$BUILD"
      pip3 install --platform manylinux2014_aarch64 \
        --target "$BUILD" --implementation cp --python-version 3.13 \
        --only-binary=:all: -r "${local.lambda_src_dir}/data/requirements.txt" --quiet
      cp "${local.lambda_src_dir}/data/app.py" "$BUILD/"
      cp "${local.lambda_src_dir}/data/run.sh" "$BUILD/"
      chmod +x "$BUILD/run.sh"
      find "$BUILD" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
      find "$BUILD" -name "*.pyc" -delete 2>/dev/null || true
      cd "$BUILD" && zip -qr "${local.lambda_build_dir}/data.zip" .
    EOT
  }
}

# --- Lambda Function ---

resource "aws_lambda_function" "data" {
  function_name = "${var.project_prefix}-data"
  role          = aws_iam_role.lambda_data.arn
  handler       = "run.sh"
  runtime       = "python3.13"
  architectures = ["arm64"]
  timeout       = 30
  memory_size   = 256
  filename      = "${local.lambda_build_dir}/data.zip"

  source_code_hash = null_resource.lambda_data_build.triggers.code_hash

  layers = [
    "arn:aws:lambda:${var.aws_region}:753240598075:layer:LambdaAdapterLayerArm64:27"
  ]

  environment {
    variables = {
      AWS_LAMBDA_EXEC_WRAPPER = "/opt/bootstrap"
      AWS_LWA_INVOKE_MODE     = "buffered"
      PORT                    = "8000"
      TABLE_NAME              = aws_dynamodb_table.data.name
    }
  }

  depends_on = [null_resource.lambda_data_build]
}

# --- IAM Role for Data Lambda ---

resource "aws_iam_role" "lambda_data" {
  name = "${var.project_prefix}-lambda-data-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_data_basic" {
  role       = aws_iam_role.lambda_data.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_data_dynamodb" {
  name = "${var.project_prefix}-lambda-data-dynamodb"
  role = aws_iam_role.lambda_data.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:Query",
        "dynamodb:PutItem",
        "dynamodb:DeleteItem",
        "dynamodb:BatchWriteItem",
      ]
      Resource = aws_dynamodb_table.data.arn
    }]
  })
}

# --- Lambda Permission for API Gateway ---

resource "aws_lambda_permission" "apigw_data" {
  statement_id  = "AllowAPIGatewayData"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.data.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*"
}
