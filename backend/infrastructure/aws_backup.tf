# ============================================================================
# AWS Backup — daily backup of the student's data
# ============================================================================
#
# One recovery point per day of every table that holds user data and of the
# assets bucket (note bodies and images, question images), kept for
# `backup_retention_days` (15 by default). This complements, not replaces,
# the in-app version history of notes and the /backup page: those cover "I
# changed something by mistake", this covers "a table or the bucket was
# damaged or deleted".
#
# Deliberately left out:
#   - study-import-drafts: temporary review data with its own 14-day TTL.
#   - the frontend bucket: rebuilt from source on every deploy.
#
# The account's AWS Backup region settings (which resource types are opted in)
# are not declared here: they are account-wide, and S3 and DynamoDB are
# already opted in. Declaring them would make this project own a setting that
# other projects in the same account depend on.

resource "aws_backup_vault" "main" {
  count = var.backup_enabled ? 1 : 0

  name = "${var.project_prefix}-backup-vault"

  # Off by default: a vault that empties itself on `terraform destroy` would
  # lose the backups exactly when the application is gone. With it off, a
  # destroy stops at a non-empty vault; set backup_vault_force_destroy = true
  # first when tearing everything down on purpose.
  force_destroy = var.backup_vault_force_destroy
}

resource "aws_backup_plan" "main" {
  count = var.backup_enabled ? 1 : 0

  name = "${var.project_prefix}-backup-plan"

  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.main[0].name
    schedule          = var.backup_schedule

    # A job that has not started within the window is recorded as missed
    # rather than running hours late and overlapping the next one.
    start_window      = 60
    completion_window = 360

    lifecycle {
      delete_after = var.backup_retention_days
    }
  }
}

# One selection per resource type, so a failed job says which half it was.
resource "aws_backup_selection" "dynamodb" {
  count = var.backup_enabled ? 1 : 0

  name         = "${var.project_prefix}-dynamodb"
  iam_role_arn = aws_iam_role.backup[0].arn
  plan_id      = aws_backup_plan.main[0].id

  resources = [
    aws_dynamodb_table.data.arn,
    aws_dynamodb_table.questions.arn,
    aws_dynamodb_table.quiz_attempts.arn,
    aws_dynamodb_table.costs.arn,
  ]
}

resource "aws_backup_selection" "s3" {
  count = var.backup_enabled ? 1 : 0

  name         = "${var.project_prefix}-s3"
  iam_role_arn = aws_iam_role.backup[0].arn
  plan_id      = aws_backup_plan.main[0].id

  # S3 backups require bucket versioning, which the assets bucket has (see
  # aws_s3_assets.tf). Without it the job fails at run time, not at plan time.
  resources = [aws_s3_bucket.assets.arn]

  depends_on = [aws_s3_bucket_versioning.assets]
}

# ----------------------------------------------------------------------------
# IAM — the role AWS Backup assumes
# ----------------------------------------------------------------------------
# Its own role rather than the console's AWSBackupDefaultServiceRole, which
# exists only if someone once ran the console wizard in this account.

resource "aws_iam_role" "backup" {
  count = var.backup_enabled ? 1 : 0

  name = "${var.project_prefix}-backup-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "backup.amazonaws.com" }
      Action    = "sts:AssumeRole"
      # Confused-deputy guard: only AWS Backup acting for this account.
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

# The AWS managed policies the service documentation prescribes; hand-written
# copies would silently fall behind when AWS adds a permission the service
# needs. Restore is granted with backup on purpose: a backup that needs an IAM
# change before it can be restored fails at the worst possible moment.
locals {
  backup_policies = {
    backup     = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
    restore    = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"
    s3_backup  = "arn:aws:iam::aws:policy/AWSBackupServiceRolePolicyForS3Backup"
    s3_restore = "arn:aws:iam::aws:policy/AWSBackupServiceRolePolicyForS3Restore"
  }
}

resource "aws_iam_role_policy_attachment" "backup" {
  for_each = var.backup_enabled ? local.backup_policies : {}

  role       = aws_iam_role.backup[0].name
  policy_arn = each.value
}
