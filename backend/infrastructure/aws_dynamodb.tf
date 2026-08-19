# ============================================================================
# DynamoDB — Single-Table for User Data (Packs, Questions, Scripts, Settings)
# ============================================================================

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
