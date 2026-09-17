# ============================================================================
# Lambda — AWS Documentation lookup (AgentCore Gateway "Lambda" target)
# ============================================================================
# Plain Python handler, no dependencies (stdlib only — see
# lambda/mcp_aws_docs/app.py for why Gateway can't proxy the stdio
# awslabs.aws-documentation-mcp-server directly). Invoked only by the
# AgentCore Gateway, never by API Gateway or the frontend.

resource "null_resource" "lambda_mcp_aws_docs_build" {
  triggers = {
    code_hash = sha256(join("", [
      filesha256("${local.lambda_src_dir}/mcp_aws_docs/app.py"),
      filesha256("${local.lambda_src_dir}/mcp_aws_docs/requirements.txt"),
    ]))
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      BUILD="${local.lambda_build_dir}/mcp_aws_docs"
      rm -rf "$BUILD" && mkdir -p "$BUILD"
      cp "${local.lambda_src_dir}/mcp_aws_docs/app.py" "$BUILD/"
      find "$BUILD" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
      find "$BUILD" -name "*.pyc" -delete 2>/dev/null || true
      cd "$BUILD" && zip -qr "${local.lambda_build_dir}/mcp_aws_docs.zip" .
    EOT
  }
}

resource "aws_lambda_function" "mcp_aws_docs" {
  function_name = "${var.project_prefix}-mcp-aws-docs"
  description   = "AWS documentation search/read — exposed as MCP tools via AgentCore Gateway"
  role          = aws_iam_role.lambda_mcp_aws_docs.arn
  handler       = "app.handler"
  runtime       = "python3.13"
  architectures = ["arm64"]
  timeout       = 30
  memory_size   = 256
  filename      = "${local.lambda_build_dir}/mcp_aws_docs.zip"

  source_code_hash = null_resource.lambda_mcp_aws_docs_build.triggers.code_hash

  depends_on = [null_resource.lambda_mcp_aws_docs_build]
}

resource "aws_cloudwatch_log_group" "lambda_mcp_aws_docs" {
  name              = "/aws/lambda/${aws_lambda_function.mcp_aws_docs.function_name}"
  retention_in_days = 14
}

resource "aws_iam_role" "lambda_mcp_aws_docs" {
  name = "${var.project_prefix}-lambda-mcp-aws-docs-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_mcp_aws_docs_basic" {
  role       = aws_iam_role.lambda_mcp_aws_docs.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# --- Permission for the AgentCore Gateway to invoke this Lambda ---
# No source_arn condition: the Gateway's ARN includes an AWS-generated
# random suffix only known after the Gateway itself is created (see
# aws_agentcore.tf's data.external.gateway), so this can't be pre-computed
# without a circular dependency. Scoped to this account only — acceptable
# for this prototype; tighten with source_arn once the gateway ID is known,
# if this pattern is reused in a less disposable project.
resource "aws_lambda_permission" "mcp_aws_docs_gateway_invoke" {
  statement_id   = "AllowAgentCoreGatewayInvoke"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.mcp_aws_docs.function_name
  principal      = "bedrock-agentcore.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
}
