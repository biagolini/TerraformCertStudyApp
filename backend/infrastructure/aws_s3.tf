# ============================================================================
# S3 — Frontend Static Hosting Bucket
# ============================================================================

resource "aws_s3_bucket" "frontend" {
  bucket        = "${var.project_prefix}-frontend-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
