# ============================================================================
# Lambda — Review generation (invokes the AgentCore Runtime review agent)
# ============================================================================

resource "null_resource" "lambda_review_build" {
  triggers = {
    code_hash = sha256(join("", [
      filesha256("${local.lambda_src_dir}/review/app.py"),
      filesha256("${local.lambda_src_dir}/review/run.sh"),
      filesha256("${local.lambda_src_dir}/review/requirements.txt"),
    ]))
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      BUILD="${local.lambda_build_dir}/review"
      rm -rf "$BUILD" && mkdir -p "$BUILD"
      pip3 install --platform manylinux2014_aarch64 \
        --target "$BUILD" --implementation cp --python-version 3.13 \
        --only-binary=:all: -r "${local.lambda_src_dir}/review/requirements.txt" --quiet
      cp "${local.lambda_src_dir}/review/app.py" "$BUILD/"
      cp "${local.lambda_src_dir}/review/run.sh" "$BUILD/"
      chmod +x "$BUILD/run.sh"
      find "$BUILD" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
      find "$BUILD" -name "*.pyc" -delete 2>/dev/null || true
      cd "$BUILD" && zip -qr "${local.lambda_build_dir}/review.zip" .
    EOT
  }
}

resource "aws_lambda_function" "review" {
  function_name = "${var.project_prefix}-review"
  description   = "Invokes the AgentCore Runtime review agent and relays its SSE response as NDJSON"
  role          = aws_iam_role.lambda_review.arn
  handler       = "run.sh"
  runtime       = "python3.13"
  architectures = ["arm64"]
  timeout       = 900
  memory_size   = 512
  filename      = "${local.lambda_build_dir}/review.zip"

  source_code_hash = null_resource.lambda_review_build.triggers.code_hash

  layers = [
    "arn:aws:lambda:${var.aws_region}:753240598075:layer:LambdaAdapterLayerArm64:27"
  ]

  environment {
    variables = {
      AWS_LAMBDA_EXEC_WRAPPER = "/opt/bootstrap"
      AWS_LWA_INVOKE_MODE     = "response_stream"
      PORT                    = "8000"
      AGENT_RUNTIME_ARN       = data.external.runtime.result.runtime_arn
    }
  }

  depends_on = [null_resource.lambda_review_build, data.external.runtime]
}

resource "aws_lambda_function_url" "review" {
  function_name      = aws_lambda_function.review.function_name
  authorization_type = "AWS_IAM"
  invoke_mode        = "RESPONSE_STREAM"
}

resource "aws_cloudwatch_log_group" "lambda_review" {
  name              = "/aws/lambda/${aws_lambda_function.review.function_name}"
  retention_in_days = 14
}

resource "aws_iam_role" "lambda_review" {
  name        = "${var.project_prefix}-lambda-review-role"
  description = "Execution role for the review Lambda (invokes AgentCore Runtime)"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_review_basic" {
  role       = aws_iam_role.lambda_review.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_review_invoke_agentcore" {
  name = "${var.project_prefix}-lambda-review-invoke-agentcore"
  role = aws_iam_role.lambda_review.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = "bedrock-agentcore:InvokeAgentRuntime"
      # InvokeAgentRuntime authorizes against the endpoint-qualified ARN
      # (".../runtime/<id>/runtime-endpoint/DEFAULT"), not the bare runtime
      # ARN — the wildcard covers both.
      Resource = "${data.external.runtime.result.runtime_arn}*"
    }]
  })
}
