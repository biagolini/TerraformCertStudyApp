# ============================================================================
# Lambda — Bulk Import: Extract (Step Functions Task #2, one Map iteration)
# ============================================================================
# Plain Python handler, not Flask/LWA — invoked only by the Step Functions
# Map state. One Bedrock Converse call (vision + forced tool-use) per chunk.

resource "null_resource" "lambda_import_extract_build" {
  triggers = {
    code_hash = sha256(join("", [
      filesha256("${local.lambda_src_dir}/import_extract/app.py"),
      filesha256("${local.lambda_src_dir}/import_extract/prompt.py"),
      filesha256("${local.lambda_src_dir}/import_extract/requirements.txt"),
    ]))
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      BUILD="${local.lambda_build_dir}/import_extract"
      rm -rf "$BUILD" && mkdir -p "$BUILD"
      pip3 install --platform manylinux2014_aarch64 \
        --target "$BUILD" --implementation cp --python-version 3.13 \
        --only-binary=:all: -r "${local.lambda_src_dir}/import_extract/requirements.txt" --quiet
      cp "${local.lambda_src_dir}/import_extract/app.py" "$BUILD/"
      cp "${local.lambda_src_dir}/import_extract/prompt.py" "$BUILD/"
      find "$BUILD" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
      find "$BUILD" -name "*.pyc" -delete 2>/dev/null || true
      cd "$BUILD" && zip -qr "${local.lambda_build_dir}/import_extract.zip" .
    EOT
  }
}

resource "aws_lambda_function" "import_extract" {
  function_name = "${var.project_prefix}-import-extract"
  description   = "Bulk exam import: one Bedrock vision/tool-use call per question chunk"
  role          = aws_iam_role.lambda_import_extract.arn
  handler       = "app.handler"
  runtime       = "python3.13"
  architectures = ["arm64"]
  timeout       = 180
  memory_size   = 1024
  filename      = "${local.lambda_build_dir}/import_extract.zip"

  source_code_hash = null_resource.lambda_import_extract_build.triggers.code_hash

  environment {
    variables = {
      TABLE_NAME                  = aws_dynamodb_table.data.name
      QUESTIONS_TABLE_NAME        = aws_dynamodb_table.questions.name
      ASSETS_BUCKET_NAME          = aws_s3_bucket.assets.id
      BEDROCK_EXTRACTION_MODEL_ID = var.bedrock_extraction_model_id
    }
  }

  depends_on = [null_resource.lambda_import_extract_build]
}

resource "aws_iam_role" "lambda_import_extract" {
  name = "${var.project_prefix}-lambda-import-extract-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_import_extract_basic" {
  role       = aws_iam_role.lambda_import_extract.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_import_extract_access" {
  name = "${var.project_prefix}-lambda-import-extract-access"
  role = aws_iam_role.lambda_import_extract.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.assets.arn}/scratch/*"
      },
      {
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.assets.arn}/images/*"
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.data.arn
      },
      {
        Effect   = "Allow"
        Action   = "dynamodb:PutItem"
        Resource = aws_dynamodb_table.questions.arn
      },
      {
        Effect   = "Allow"
        Action   = "bedrock:InvokeModel"
        Resource = "*"
      },
    ]
  })
}
