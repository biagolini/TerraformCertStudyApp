# ============================================================================
# AgentCore — Review agent Runtime (container) + Gateway (MCP AWS-docs tool)
# ============================================================================
# Terraform's aws provider has no mature native aws_bedrockagentcore_*
# resources yet (verify at any future revisit — see agent/review_agent/ and
# scripts/agentcore_deploy.py's module docstring for the full reasoning).
# Runtime/Gateway/Gateway-Target creation is therefore driven by
# scripts/agentcore_deploy.py via `data "external"`, the officially
# supported bridge for non-native resources — `terraform apply` is still the
# single deploy step, it just shells out to boto3 instead of a native
# resource's CRUD cycle. ECR, IAM, and the docs Lambda (aws_lambda_mcp_aws_docs.tf)
# are all ordinary native Terraform resources.

locals {
  agent_src_dir          = "${abspath(path.module)}/agent/review_agent"
  review_agent_image_tag = "${aws_ecr_repository.review_agent.repository_url}:latest"
  review_gateway_name    = "${var.project_prefix}-review-gateway"
  review_runtime_name    = replace("${var.project_prefix}_review_agent", "-", "_")
}

# --- Build + push the agent container image ---

resource "null_resource" "review_agent_image_build" {
  triggers = {
    code_hash = sha256(join("", [
      for f in fileset(local.agent_src_dir, "**") : filesha256("${local.agent_src_dir}/${f}")
    ]))
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      aws ecr get-login-password --region ${var.aws_region} --profile ${var.aws_profile} \
        | docker login --username AWS --password-stdin ${aws_ecr_repository.review_agent.repository_url}
      docker buildx build --platform linux/arm64 --push \
        -t ${local.review_agent_image_tag} \
        "${local.agent_src_dir}"
    EOT
  }

  depends_on = [aws_ecr_repository.review_agent]
}

# --- IAM — Gateway execution role (invokes the AWS-docs Lambda target) ---

resource "aws_iam_role" "agentcore_gateway" {
  name = "${var.project_prefix}-agentcore-gateway-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
      }
    }]
  })
}

resource "aws_iam_role_policy" "agentcore_gateway_invoke_lambda" {
  name = "${var.project_prefix}-agentcore-gateway-invoke-lambda"
  role = aws_iam_role.agentcore_gateway.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.mcp_aws_docs.arn
    }]
  })
}

# --- IAM — Runtime execution role (Bedrock, ECR pull, logs/tracing, Gateway) ---

resource "aws_iam_role" "agentcore_runtime" {
  name = "${var.project_prefix}-agentcore-runtime-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
      }
    }]
  })
}

resource "aws_iam_role_policy" "agentcore_runtime_access" {
  name = "${var.project_prefix}-agentcore-runtime-access"
  role = aws_iam_role.agentcore_runtime.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
        Resource = aws_ecr_repository.review_agent.arn
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams",
        ]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Effect    = "Allow"
        Action    = "cloudwatch:PutMetricData"
        Resource  = "*"
        Condition = { StringEquals = { "cloudwatch:namespace" = "bedrock-agentcore" } }
      },
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ]
        Resource = [
          "arn:aws:bedrock:*::foundation-model/*",
          "arn:aws:bedrock:*:${data.aws_caller_identity.current.account_id}:inference-profile/*",
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:GetWorkloadAccessToken",
          "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
        ]
        Resource = "*"
      },
      {
        # The Runtime container calls the Gateway's MCP endpoint directly
        # over SigV4-signed HTTP (see app.py's SigV4HttpxAuth) — that call
        # is itself authorized as this action, scoped to the gateway ARN.
        # Missing this was invisible in local testing (which used a broad
        # admin AWS profile) and only surfaced as a 403 from the deployed
        # Runtime, whose execution role has no implicit access.
        Effect   = "Allow"
        Action   = "bedrock-agentcore:InvokeGateway"
        Resource = "arn:aws:bedrock-agentcore:${var.aws_region}:${data.aws_caller_identity.current.account_id}:gateway/${data.external.gateway.result.gateway_id}"
      },
    ]
  })
}

# --- Gateway (create-or-update via boto3 — see scripts/agentcore_deploy.py) ---

data "external" "gateway" {
  program = ["python3", "${abspath(path.module)}/scripts/agentcore_deploy.py"]

  query = {
    action          = "gateway"
    region          = var.aws_region
    profile         = var.aws_profile
    name            = local.review_gateway_name
    role_arn        = aws_iam_role.agentcore_gateway.arn
    docs_lambda_arn = aws_lambda_function.mcp_aws_docs.arn
  }

  depends_on = [
    aws_iam_role_policy.agentcore_gateway_invoke_lambda,
    aws_lambda_permission.mcp_aws_docs_gateway_invoke,
  ]
}

# --- Runtime + DEFAULT endpoint (create-or-update via boto3) ---

data "external" "runtime" {
  program = ["python3", "${abspath(path.module)}/scripts/agentcore_deploy.py"]

  query = {
    action           = "runtime"
    region           = var.aws_region
    profile          = var.aws_profile
    name             = local.review_runtime_name
    role_arn         = aws_iam_role.agentcore_runtime.arn
    image_uri        = local.review_agent_image_tag
    gateway_url      = data.external.gateway.result.gateway_url
    bedrock_model_id = var.review_agent_model_id
  }

  depends_on = [
    null_resource.review_agent_image_build,
    aws_iam_role_policy.agentcore_runtime_access,
    data.external.gateway,
  ]
}

# --- Log group for every review call (see app.py's review_call_start/end
# log lines) — AgentCore Runtime auto-creates this log group on first
# invocation with no retention limit; managing it here caps cost/retention
# without changing where the Runtime itself writes. ---

resource "aws_cloudwatch_log_group" "agentcore_runtime" {
  name              = "/aws/bedrock-agentcore/runtimes/${data.external.runtime.result.runtime_id}-DEFAULT"
  retention_in_days = 14

  # `data.external` outputs are always "(known after apply)" during plan —
  # every single time, even when the resolved value won't change — which
  # forces a replace on `name` (a ForceNew attribute) on every apply that
  # touches this stack. That replace then races AWS's own re-creation of
  # this same log group on the Runtime's next invocation, producing a
  # ResourceAlreadyExistsException (observed directly, twice, requiring a
  # manual `terraform import` each time). The runtime_id this name is built
  # from is stable for the life of this Runtime — ignoring it here is safe;
  # a genuine Runtime recreation (new runtime_id) would need one manual
  # `terraform import` to pick up the new name, same fix as before, just no
  # longer needed on every routine apply.
  lifecycle {
    ignore_changes = [name]
  }
}
