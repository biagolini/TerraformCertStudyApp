# ============================================================================
# Automated Frontend Deploy
# ============================================================================

variable "frontend_deploy_enabled" {
  description = "Enable automatic frontend build and deploy to S3 on apply"
  type        = bool
  default     = false
}

variable "frontend_dir" {
  description = "Relative path from infrastructure/ to the frontend directory"
  type        = string
  default     = "../../frontend"
}

resource "null_resource" "frontend_deploy" {
  count = var.frontend_deploy_enabled ? 1 : 0

  triggers = {
    always_run = timestamp()
  }

  provisioner "local-exec" {
    command = "bash ${abspath("${path.module}/scripts/deploy_frontend.sh")}"

    environment = {
      S3_BUCKET            = aws_s3_bucket.frontend.id
      FRONTEND_DIR         = abspath("${path.module}/${var.frontend_dir}")
      AWS_REGION           = var.aws_region
      AWS_PROFILE          = var.aws_profile
      API_URL              = aws_api_gateway_stage.main.invoke_url
      COGNITO_USER_POOL_ID = aws_cognito_user_pool.main.id
      COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.web.id
      COGNITO_DOMAIN       = "${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"
      FRONTEND_DOMAIN      = var.domain_name
    }
  }

  depends_on = [
    aws_s3_bucket.frontend,
    aws_cloudfront_distribution.frontend,
  ]
}

# --- CloudFront Cache Invalidation ---

resource "null_resource" "cloudfront_invalidation" {
  count = var.frontend_deploy_enabled ? 1 : 0

  triggers = {
    always_run = timestamp()
  }

  provisioner "local-exec" {
    command = "aws cloudfront create-invalidation --distribution-id ${aws_cloudfront_distribution.frontend.id} --paths '/*' --region ${var.aws_region} ${var.aws_profile != "" ? "--profile ${var.aws_profile}" : ""}"
  }

  depends_on = [null_resource.frontend_deploy]
}
