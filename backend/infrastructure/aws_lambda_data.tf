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
  description   = "User data CRUD (packs, questions, scripts, settings) and Bedrock model discovery"
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

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      AWS_LAMBDA_EXEC_WRAPPER          = "/opt/bootstrap"
      AWS_LWA_INVOKE_MODE              = "buffered"
      PORT                             = "8000"
      TABLE_NAME                       = aws_dynamodb_table.data.name
      QUESTIONS_TABLE_NAME             = aws_dynamodb_table.questions.name
      QUIZ_ATTEMPTS_TABLE_NAME         = aws_dynamodb_table.quiz_attempts.name
      IMPORT_DRAFTS_TABLE_NAME         = aws_dynamodb_table.import_drafts.name
      ASSETS_BUCKET_NAME               = aws_s3_bucket.assets.id
      IMPORT_STATE_MACHINE_ARN         = aws_sfn_state_machine.import_exam.arn
      IMPORT_EXPLAIN_STATE_MACHINE_ARN = aws_sfn_state_machine.import_exam_explain.arn
      IMPORT_EXTRACT_LAMBDA_ARN        = aws_lambda_function.import_extract.arn
      IMPORT_FINALIZE_LAMBDA_ARN       = aws_lambda_function.import_finalize.arn
      IMPORT_EXPLAIN_LOG_GROUP_NAME    = aws_cloudwatch_log_group.lambda_import_explain.name
    }
  }

  depends_on = [null_resource.lambda_data_build]
}

# --- IAM Role for Data Lambda ---

resource "aws_iam_role" "lambda_data" {
  name        = "${var.project_prefix}-lambda-data-role"
  description = "Execution role for the data CRUD Lambda (DynamoDB + Bedrock model listing)"

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
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:PutItem",
        "dynamodb:DeleteItem",
        "dynamodb:BatchWriteItem",
      ]
      Resource = [
        aws_dynamodb_table.data.arn,
        aws_dynamodb_table.questions.arn,
        aws_dynamodb_table.quiz_attempts.arn,
        aws_dynamodb_table.import_drafts.arn,
      ]
    }]
  })
}

# --- S3 asset bucket access (presigned PUT for uploads, presigned GET for images) ---

resource "aws_iam_role_policy" "lambda_data_s3_assets" {
  name = "${var.project_prefix}-lambda-data-s3-assets"
  role = aws_iam_role.lambda_data.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.assets.arn}/uploads/*"
      },
      {
        # "View original file" (see lambda/data/app.py's
        # get_original_upload_url) — presigns the exact file the user
        # uploaded, while it's still within the 2-day uploads/ lifecycle.
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.assets.arn}/uploads/*"
      },
      {
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.assets.arn}/images/*"
      },
      {
        Effect   = "Allow"
        Action   = "s3:DeleteObject"
        Resource = "${aws_s3_bucket.assets.arn}/images/*"
      },
      {
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.assets.arn}/images/*"
      },
      {
        # Immediate cleanup of a deleted job's temporary storage (see
        # lambda/data/app.py's delete_import/_delete_s3_prefix) — without
        # this, uploads/scratch only disappear after the bucket's 14-day
        # lifecycle rule, not when the user actually deletes the job.
        Effect   = "Allow"
        Action   = "s3:DeleteObject"
        Resource = [
          "${aws_s3_bucket.assets.arn}/uploads/*",
          "${aws_s3_bucket.assets.arn}/scratch/*",
        ]
      },
      {
        # list_objects_v2 needs bucket-level ListBucket, not object-level —
        # scoped by a prefix condition so this role can only ever list
        # under uploads/ or scratch/, never the whole bucket (e.g. images/
        # or another user's keys, though pk already isolates that logically).
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.assets.arn
        Condition = {
          StringLike = {
            "s3:prefix" = ["uploads/*", "scratch/*"]
          }
        }
      },
    ]
  })
}

# --- Start the import Step Functions execution (explicit "Process" action) ---

resource "aws_iam_role_policy" "lambda_data_sfn_start" {
  name = "${var.project_prefix}-lambda-data-sfn-start"
  role = aws_iam_role.lambda_data.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = "states:StartExecution"
      Resource = [
        aws_sfn_state_machine.import_exam.arn,
        aws_sfn_state_machine.import_exam_explain.arn,
      ]
    }]
  })
}

# --- Per-question re-extract: direct synchronous invoke of the Phase 1
# extraction Lambda (see lambda/data/app.py's re_extract_draft) ---

resource "aws_iam_role_policy" "lambda_data_invoke_extract" {
  name = "${var.project_prefix}-lambda-data-invoke-extract"
  role = aws_iam_role.lambda_data.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = "lambda:InvokeFunction"
      Resource = [
        aws_lambda_function.import_extract.arn,
        # "Save as is" (see lambda/data/app.py's save_drafts_as_is) reuses
        # import-finalize's own status decision synchronously rather than
        # duplicating that logic.
        aws_lambda_function.import_finalize.arn,
      ]
    }]
  })
}

# --- "Show logs" on a failed AI-refine draft (see lambda/data/app.py's
# get_draft_logs) — scoped to exactly the import-explain Lambda's own log
# group, never a blanket logs:* grant. ---

resource "aws_iam_role_policy" "lambda_data_read_import_explain_logs" {
  name = "${var.project_prefix}-lambda-data-read-import-explain-logs"
  role = aws_iam_role.lambda_data.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "logs:FilterLogEvents"
      Resource = "${aws_cloudwatch_log_group.lambda_import_explain.arn}:*"
    }]
  })
}

# --- Bedrock model discovery (control-plane list APIs) ---

resource "aws_iam_role_policy" "lambda_data_bedrock_list" {
  name = "${var.project_prefix}-lambda-data-bedrock-list"
  role = aws_iam_role.lambda_data.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "bedrock:ListFoundationModels",
        "bedrock:ListInferenceProfiles",
      ]
      Resource = "*"
    }]
  })
}

# --- Generate-title button (edit form): one-off plain Bedrock Converse
# call, no tool-use — see lambda/data/app.py's generate_draft_title ---

resource "aws_iam_role_policy" "lambda_data_bedrock_invoke" {
  name = "${var.project_prefix}-lambda-data-bedrock-invoke"
  role = aws_iam_role.lambda_data.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "bedrock:InvokeModel"
      Resource = "*"
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
