# ============================================================================
# Lambda — Bulk Import: Explain (Phase 2, Step Functions Task, one Map
# iteration per approved draft)
# ============================================================================
# Plain Python handler, not Flask/LWA — invoked only by the Step Functions
# Map state (import_explain_workflow.asl.json.tpl). Reads one human-reviewed
# draft (see lambda/import_extract for Phase 1) and calls the AgentCore
# Runtime review agent for the explanation content, then writes the final
# Question. No vision/S3 image access needed — the draft already has
# structure resolved, including image references.

resource "null_resource" "lambda_import_explain_build" {
  triggers = {
    code_hash = sha256(join("", [
      filesha256("${local.lambda_src_dir}/import_explain/app.py"),
      filesha256("${local.lambda_src_dir}/import_explain/requirements.txt"),
    ]))
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      BUILD="${local.lambda_build_dir}/import_explain"
      rm -rf "$BUILD" && mkdir -p "$BUILD"
      pip3 install --platform manylinux2014_aarch64 \
        --target "$BUILD" --implementation cp --python-version 3.13 \
        --only-binary=:all: -r "${local.lambda_src_dir}/import_explain/requirements.txt" --quiet
      cp "${local.lambda_src_dir}/import_explain/app.py" "$BUILD/"
      find "$BUILD" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
      find "$BUILD" -name "*.pyc" -delete 2>/dev/null || true
      cd "$BUILD" && zip -qr "${local.lambda_build_dir}/import_explain.zip" .
    EOT
  }
}

resource "aws_lambda_function" "import_explain" {
  function_name = "${var.project_prefix}-import-explain"
  description   = "Bulk exam import Phase 2: AgentCore review agent explanation, per approved draft"
  role          = aws_iam_role.lambda_import_explain.arn
  handler       = "app.handler"
  runtime       = "python3.13"
  architectures = ["arm64"]
  # Comfortably above the AgentCore call's own read_timeout (170s, see
  # app.py) plus DynamoDB overhead.
  timeout     = 200
  memory_size = 512
  filename    = "${local.lambda_build_dir}/import_explain.zip"

  source_code_hash = null_resource.lambda_import_explain_build.triggers.code_hash

  environment {
    variables = {
      TABLE_NAME               = aws_dynamodb_table.data.name
      IMPORT_DRAFTS_TABLE_NAME = aws_dynamodb_table.import_drafts.name
      QUESTIONS_TABLE_NAME     = aws_dynamodb_table.questions.name
      AGENT_RUNTIME_ARN        = data.external.runtime.result.runtime_arn
    }
  }

  depends_on = [null_resource.lambda_import_explain_build, data.external.runtime]
}

resource "aws_iam_role" "lambda_import_explain" {
  name = "${var.project_prefix}-lambda-import-explain-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_import_explain_basic" {
  role       = aws_iam_role.lambda_import_explain.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_import_explain_access" {
  name = "${var.project_prefix}-lambda-import-explain-access"
  role = aws_iam_role.lambda_import_explain.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.data.arn
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.import_drafts.arn
      },
      {
        Effect   = "Allow"
        Action   = "dynamodb:PutItem"
        Resource = aws_dynamodb_table.questions.arn
      },
      {
        Effect = "Allow"
        Action = "bedrock-agentcore:InvokeAgentRuntime"
        # InvokeAgentRuntime authorizes against the endpoint-qualified ARN
        # (".../runtime/<id>/runtime-endpoint/DEFAULT"), not the bare
        # runtime ARN — the wildcard covers both (see aws_lambda_review.tf
        # for the same pattern).
        Resource = "${data.external.runtime.result.runtime_arn}*"
      },
    ]
  })
}
