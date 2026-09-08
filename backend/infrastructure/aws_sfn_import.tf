# ============================================================================
# Step Functions — Bulk Exam Import Workflow
# ============================================================================
# First Step Functions usage in this repo — logging is enabled from the
# start (unlike the Lambdas' default CloudWatch logs) since a Map state's
# per-iteration failures are otherwise hard to debug after the fact.

resource "aws_cloudwatch_log_group" "sfn_import" {
  name              = "/aws/vendedlogs/states/${var.project_prefix}-import-exam"
  retention_in_days = 14
}

resource "aws_sfn_state_machine" "import_exam" {
  name     = "${var.project_prefix}-import-exam"
  role_arn = aws_iam_role.sfn_import.arn
  type     = "STANDARD"

  definition = templatefile("${path.module}/templates/step-functions/import_workflow.asl.json.tpl", {
    preprocess_lambda_arn = aws_lambda_function.import_preprocess.arn
    extract_lambda_arn    = aws_lambda_function.import_extract.arn
    finalize_lambda_arn   = aws_lambda_function.import_finalize.arn
  })

  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.sfn_import.arn}:*"
    include_execution_data = true
    level                  = "ALL"
  }
}

resource "aws_iam_role" "sfn_import" {
  name = "${var.project_prefix}-sfn-import-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "states.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "sfn_import_invoke" {
  name = "${var.project_prefix}-sfn-import-invoke"
  role = aws_iam_role.sfn_import.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = "lambda:InvokeFunction"
      Resource = [
        aws_lambda_function.import_preprocess.arn,
        aws_lambda_function.import_extract.arn,
        aws_lambda_function.import_finalize.arn,
      ]
    }]
  })
}

# Required by AWS for Step Functions CloudWatch Logs delivery — see
# https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html
resource "aws_iam_role_policy" "sfn_import_logs" {
  name = "${var.project_prefix}-sfn-import-logs"
  role = aws_iam_role.sfn_import.id

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
