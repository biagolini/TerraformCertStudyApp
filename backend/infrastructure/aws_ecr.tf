# ============================================================================
# ECR — Container repository for the review agent (AgentCore Runtime)
# ============================================================================

resource "aws_ecr_repository" "review_agent" {
  name                 = "${var.project_prefix}-review-agent"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}
