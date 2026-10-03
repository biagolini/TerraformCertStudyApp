# ============================================================================
# ECR — Container repository for the review agent (AgentCore Runtime)
# ============================================================================

resource "aws_ecr_repository" "review_agent" {
  name                 = "${var.project_prefix}-review-agent"
  image_tag_mutability = "MUTABLE"

  # Permite que o terraform destroy remova o repositório mesmo que ele
  # ainda contenha imagens, evitando o erro RepositoryNotEmptyException.
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true
  }
}
