# ============================================================================
# S3 — Private user-asset bucket (uploaded exam files + extracted question images)
# ============================================================================
# Never public and never fronted by CloudFront — every read goes through a
# presigned URL minted by the `data` Lambda, which always prepends the
# caller's own Cognito `sub` server-side (see lambda/data/app.py). Four
# top-level prefixes share this one bucket:
#   uploads/{sub}/{jobId}/{filename}              raw uploaded exam file
#   scratch/{jobId}/...                           preprocessing artifacts
#   images/{sub}/{jobId}/{questionId}/{filename}  final question images
#   notes/{sub}/{noteId}/document.md              study note body (+ images/)
# `uploads/` and `scratch/` are intermediate — never needed once the import
# job finishes — so they're expired by the lifecycle rule below; `images/`
# and `notes/` are permanent user content.
#
# Versioning is on so every save of a note body keeps the previous one, and
# the note editor can list and restore past versions. S3 versioning is
# bucket-wide; the lifecycle rules below drop noncurrent versions of
# everything except notes/ after a day, so the other prefixes cost no more
# than before. Notes keep their newest 250 versions: a lifecycle rule can
# retain at most 100, so the data Lambda prunes the rest after each save.

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

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  # Rules that act on noncurrent versions need versioning in place first.
  depends_on = [aws_s3_bucket_versioning.assets]

  rule {
    id     = "expire-uploads"
    status = "Enabled"
    filter {
      prefix = "uploads/"
    }
    expiration {
      days = 2
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  rule {
    # 14 days, not 2 — matches the import-drafts DynamoDB table's own TTL
    # window (see aws_dynamodb.tf). A draft's `chunk` field points at these
    # scratch/ keys for re-extraction; the human review step this table
    # supports is explicitly not time-pressured ("no rush"), so scratch/
    # must outlive a leisurely review, not just the few minutes Phase 1
    # itself takes to run.
    id     = "expire-scratch"
    status = "Enabled"
    filter {
      prefix = "scratch/"
    }
    expiration {
      days = 14
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  rule {
    # Replaced or deleted question images: nothing restores them, so their
    # old versions go after a day, along with leftover delete markers.
    id     = "expire-old-image-versions"
    status = "Enabled"
    filter {
      prefix = "images/"
    }
    expiration {
      expired_object_delete_marker = true
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  rule {
    # Note bodies keep their history (capped at 250 by the data Lambda);
    # this only clears delete markers left once a deleted object has no
    # versions left. Deleting a note removes every version right away.
    id     = "clean-note-delete-markers"
    status = "Enabled"
    filter {
      prefix = "notes/"
    }
    expiration {
      expired_object_delete_marker = true
    }
  }
}
