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
