# ============================================================================
# S3 — Private user-asset bucket (uploaded exam files + extracted question images)
# ============================================================================
# Never public and never fronted by CloudFront — every read goes through a
# presigned URL minted by the `data` Lambda, which always prepends the
# caller's own Cognito `sub` server-side (see lambda/data/app.py). Three
# top-level prefixes share this one bucket:
#   uploads/{sub}/{jobId}/{filename}              raw uploaded exam file
#   scratch/{jobId}/...                           preprocessing artifacts
#   images/{sub}/{jobId}/{questionId}/{filename}  final question images
# `uploads/` and `scratch/` are intermediate — never needed once the import
# job finishes — so they're expired by the lifecycle rule below; `images/`
# is permanent, since it's embedded in saved questions.

resource "aws_s3_bucket" "assets" {
  bucket        = "${var.project_prefix}-assets-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# The browser uploads the raw exam file and fetches images directly against
# S3 via presigned URLs — a different origin than the API, so CORS is needed
# here too, mirroring the permissive stance already used in aws_apigateway.tf.
resource "aws_s3_bucket_cors_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  cors_rule {
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
  }
}

# Delivers Object Created events to the default EventBridge bus, so the
# import state machine can be triggered without a glue Lambda (see
# aws_eventbridge_import.tf).
resource "aws_s3_bucket_notification" "assets" {
  bucket      = aws_s3_bucket.assets.id
  eventbridge = true
}

resource "aws_s3_bucket_lifecycle_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    id     = "expire-uploads"
    status = "Enabled"
    filter {
      prefix = "uploads/"
    }
    expiration {
      days = 2
    }
  }

  rule {
    id     = "expire-scratch"
    status = "Enabled"
    filter {
      prefix = "scratch/"
    }
    expiration {
      days = 2
    }
  }
}
