# ============================================================================
# X-Ray — tracing permissions
# ============================================================================
# Every Lambda already has `tracing_config { mode = "Active" }` set on its own
# resource (see each aws_lambda_*.tf) — this file only grants the write
# permission the X-Ray daemon needs to actually emit segments, via the same
# AWS-managed policy on every Lambda execution role, plus the two Step
# Functions state machines' own equivalent grant (see aws_sfn_import.tf /
# aws_sfn_import_explain.tf, which already have their own policy resources —
# their X-Ray actions are added there, not duplicated here).

resource "aws_iam_role_policy_attachment" "lambda_xray" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "lambda_data_xray" {
  role       = aws_iam_role.lambda_data.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "lambda_review_xray" {
  role       = aws_iam_role.lambda_review.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "lambda_import_extract_xray" {
  role       = aws_iam_role.lambda_import_extract.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "lambda_import_explain_xray" {
  role       = aws_iam_role.lambda_import_explain.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "lambda_import_finalize_xray" {
  role       = aws_iam_role.lambda_import_finalize.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "lambda_import_preprocess_xray" {
  role       = aws_iam_role.lambda_import_preprocess.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "lambda_mcp_aws_docs_xray" {
  role       = aws_iam_role.lambda_mcp_aws_docs.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}
