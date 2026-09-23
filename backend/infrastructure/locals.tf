# ============================================================================
# Locals
# ============================================================================

locals {
  default_tags = {
    project_id  = var.project_id
    managed_by  = "terraform"
    environment = var.environment
  }

  lambda_src_dir   = "${abspath(path.module)}/lambda"
  lambda_build_dir = "${abspath(path.module)}/.build"
}

data "aws_caller_identity" "current" {}
