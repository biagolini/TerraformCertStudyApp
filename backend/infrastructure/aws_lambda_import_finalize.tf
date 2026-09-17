# ============================================================================
# Lambda — Bulk Import: Finalize (Step Functions Task #3)
# ============================================================================
# Plain Python handler, not Flask/LWA — invoked only by Step Functions, after
# the extraction Map completes. Aggregates results into the job's final status.

resource "null_resource" "lambda_import_finalize_build" {
  triggers = {
    code_hash = sha256(join("", [
      filesha256("${local.lambda_src_dir}/import_finalize/app.py"),
      filesha256("${local.lambda_src_dir}/import_finalize/requirements.txt"),
    ]))
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      BUILD="${local.lambda_build_dir}/import_finalize"
      rm -rf "$BUILD" && mkdir -p "$BUILD"
      pip3 install --platform manylinux2014_aarch64 \
        --target "$BUILD" --implementation cp --python-version 3.13 \
        --only-binary=:all: -r "${local.lambda_src_dir}/import_finalize/requirements.txt" --quiet
      cp "${local.lambda_src_dir}/import_finalize/app.py" "$BUILD/"
      find "$BUILD" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
      find "$BUILD" -name "*.pyc" -delete 2>/dev/null || true
      cd "$BUILD" && zip -qr "${local.lambda_build_dir}/import_finalize.zip" .
    EOT
  }
}

resource "aws_lambda_function" "import_finalize" {
  function_name = "${var.project_prefix}-import-finalize"
  description   = "Bulk exam import: aggregates the extraction Map's results into a final job status"
  role          = aws_iam_role.lambda_import_finalize.arn
  handler       = "app.handler"
  runtime       = "python3.13"
  architectures = ["arm64"]
  timeout       = 30
  memory_size   = 256
  filename      = "${local.lambda_build_dir}/import_finalize.zip"

  source_code_hash = null_resource.lambda_import_finalize_build.triggers.code_hash

  environment {
    variables = {
      TABLE_NAME               = aws_dynamodb_table.data.name
      IMPORT_DRAFTS_TABLE_NAME = aws_dynamodb_table.import_drafts.name
    }
  }

  depends_on = [null_resource.lambda_import_finalize_build]
}

resource "aws_iam_role" "lambda_import_finalize" {
  name = "${var.project_prefix}-lambda-import-finalize-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_import_finalize_basic" {
  role       = aws_iam_role.lambda_import_finalize.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_import_finalize_access" {
  name = "${var.project_prefix}-lambda-import-finalize-access"
  role = aws_iam_role.lambda_import_finalize.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
        ]
        Resource = aws_dynamodb_table.data.arn
      },
      {
        Effect   = "Allow"
        Action   = "dynamodb:Query"
        Resource = aws_dynamodb_table.import_drafts.arn
      },
    ]
  })
}
