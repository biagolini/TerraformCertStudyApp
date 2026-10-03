# ============================================================================
# DynamoDB — General/config table (Packs, Scripts, Chats, Settings)
# ============================================================================
# Questions get their own table below: they're the largest, most structured
# entity and may need independent scaling/GSIs later, while everything here
# is small, low-churn config. See docs/dynamodb-schema.md.

resource "aws_dynamodb_table" "data" {
  name         = "${var.project_prefix}-data"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }
}

# ============================================================================
# DynamoDB — Questions table
# ============================================================================

resource "aws_dynamodb_table" "questions" {
  name         = "${var.project_prefix}-questions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }
}

# ============================================================================
# DynamoDB — Quiz attempts table
# ============================================================================
# sk embeds the exam slug (sk = ATTEMPT#{examSlug}#{startedAt}#{id}) so listing
# a given exam's attempts is a begins_with prefix Query, not a scan or GSI.

resource "aws_dynamodb_table" "quiz_attempts" {
  name         = "${var.project_prefix}-quiz-attempts"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }
}

# ============================================================================
# DynamoDB — Import drafts table
# ============================================================================
# Structure-extraction results awaiting human review before explanation
# generation (see the bulk-import pipeline's Phase 1/Phase 2 split). Kept
# out of both the `data` table (which gets a full-partition Query on every
# login — see lambda/data/app.py's get_all) and the `questions` table
# (whose items the frontend's full-dataset PUT/GET /data sync payload
# assumes always carry a `comment`/`generalComment`, which a draft doesn't
# have yet) — a dedicated table lets these transient, job-scoped rows churn
# freely without touching either synced-state path. TTL doubles as the
# "review isn't urgent" cleanup mechanism, matched to the `scratch/` S3
# lifecycle rule's own 14-day window (see aws_s3_assets.tf).

resource "aws_dynamodb_table" "import_drafts" {
  name         = "${var.project_prefix}-import-drafts"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

# ============================================================================
# DynamoDB — Costs table (AI token/spend usage log + monthly budget config)
# ============================================================================
# Kept out of the `data` table for the same reason import_drafts is: that
# table is read in full on every login (lambda/data/app.py's get_all), and
# usage history should be free to grow without inflating that hot path. TTL
# is what actually makes the retention window real — `data` has no
# table-level TTL enabled, so the `ttl` attribute usage-log code wrote there
# earlier was inert. See docs/dynamodb-schema.md.

resource "aws_dynamodb_table" "costs" {
  name         = "${var.project_prefix}-costs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}
