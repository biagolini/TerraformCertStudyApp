# ============================================================================
# Lambda — Bulk Import: Preprocess (Step Functions Task #1)
# ============================================================================
# Plain Python handler, not Flask/LWA — invoked only by Step Functions, never
# behind API Gateway. Parses the uploaded file into per-question chunks.

resource "null_resource" "lambda_import_preprocess_build" {
  triggers = {
    code_hash = sha256(join("", [
      filesha256("${local.lambda_src_dir}/import_preprocess/app.py"),
      filesha256("${local.lambda_src_dir}/import_preprocess/requirements.txt"),
    ]))
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      BUILD="${local.lambda_build_dir}/import_preprocess"
      rm -rf "$BUILD" && mkdir -p "$BUILD"
      pip3 install --platform manylinux2014_aarch64 \
        --target "$BUILD" --implementation cp --python-version 3.13 \
        --only-binary=:all: -r "${local.lambda_src_dir}/import_preprocess/requirements.txt" --quiet
      cp "${local.lambda_src_dir}/import_preprocess/app.py" "$BUILD/"
      find "$BUILD" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
      find "$BUILD" -name "*.pyc" -delete 2>/dev/null || true
      cd "$BUILD" && zip -qr "${local.lambda_build_dir}/import_preprocess.zip" .
    EOT
  }
}

resource "aws_lambda_function" "import_preprocess" {
  function_name = "${var.project_prefix}-import-preprocess"
  description   = "Bulk exam import: parses the uploaded file into per-question chunks"
  role          = aws_iam_role.lambda_import_preprocess.arn
  handler       = "app.handler"
  runtime       = "python3.13"
  architectures = ["arm64"]
  timeout       = 300
  memory_size   = 1536
  filename      = "${local.lambda_build_dir}/import_preprocess.zip"

  source_code_hash = null_resource.lambda_import_preprocess_build.triggers.code_hash

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      TABLE_NAME         = aws_dynamodb_table.data.name
      ASSETS_BUCKET_NAME = aws_s3_bucket.assets.id
    }
  }

  depends_on = [null_resource.lambda_import_preprocess_build]
}

resource "aws_iam_role" "lambda_import_preprocess" {
  name = "${var.project_prefix}-lambda-import-preprocess-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_import_preprocess_basic" {
  role       = aws_iam_role.lambda_import_preprocess.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_import_preprocess_access" {
  name = "${var.project_prefix}-lambda-import-preprocess-access"
  role = aws_iam_role.lambda_import_preprocess.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.assets.arn}/uploads/*"
      },
      {
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.assets.arn}/scratch/*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
        ]
        Resource = aws_dynamodb_table.data.arn
      },
    ]
  })
}
