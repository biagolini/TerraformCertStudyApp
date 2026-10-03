# ============================================================================
# Step Functions — Bulk Exam Import Workflow, Phase 2 (Explanations)
# ============================================================================
# Triggered explicitly by the `data` Lambda's generate-explanations route
# once the user approves reviewed drafts — mirrors aws_sfn_import.tf's
# structure (own IAM role, own log group) rather than sharing Phase 1's
# state machine, since the two phases are independently triggerable steps,
# not a single continuous execution (see import_workflow.asl.json.tpl's
# comment on why this repo avoids a long-running wait-for-approval design).

resource "aws_cloudwatch_log_group" "sfn_import_explain" {
  name              = "/aws/vendedlogs/states/${var.project_prefix}-import-exam-explain"
  retention_in_days = 14
}

resource "aws_sfn_state_machine" "import_exam_explain" {
  name     = "${var.project_prefix}-import-exam-explain"
  role_arn = aws_iam_role.sfn_import_explain.arn
  type     = "STANDARD"

  definition = templatefile("${path.module}/templates/step-functions/import_explain_workflow.asl.json.tpl", {
    explain_lambda_arn  = aws_lambda_function.import_explain.arn
    finalize_lambda_arn = aws_lambda_function.import_finalize.arn
  })

  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.sfn_import_explain.arn}:*"
    include_execution_data = true
    level                  = "ALL"
  }

  tracing_configuration {
    enabled = true
  }
}

resource "aws_iam_role" "sfn_import_explain" {
  name = "${var.project_prefix}-sfn-import-explain-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "states.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "sfn_import_explain_invoke" {
  name = "${var.project_prefix}-sfn-import-explain-invoke"
  role = aws_iam_role.sfn_import_explain.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = "lambda:InvokeFunction"
      Resource = [
        aws_lambda_function.import_explain.arn,
        aws_lambda_function.import_finalize.arn,
      ]
    }]
  })
}

# Required by AWS for Step Functions CloudWatch Logs delivery — see
# https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html
resource "aws_iam_role_policy" "sfn_import_explain_logs" {
  name = "${var.project_prefix}-sfn-import-explain-logs"
  role = aws_iam_role.sfn_import_explain.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogDelivery",
        "logs:GetLogDelivery",
        "logs:UpdateLogDelivery",
        "logs:DeleteLogDelivery",
        "logs:ListLogDeliveries",
        "logs:PutResourcePolicy",
        "logs:DescribeResourcePolicies",
        "logs:DescribeLogGroups",
      ]
      Resource = "*"
    }]
  })
}

resource "aws_iam_role_policy" "sfn_import_explain_xray" {
  name = "${var.project_prefix}-sfn-import-explain-xray"
  role = aws_iam_role.sfn_import_explain.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "xray:PutTraceSegments",
        "xray:PutTelemetryRecords",
        "xray:GetSamplingRules",
        "xray:GetSamplingTargets",
      ]
      Resource = "*"
    }]
  })
}
