# ============================================================================
# Environment: production
# ============================================================================

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "aws_profile" {
  description = "AWS CLI profile name"
  type        = string
}

variable "domain_name" {
  description = "Custom domain for CloudFront"
  type        = string
}

variable "hosted_zone_name" {
  description = "Route53 hosted zone name"
  type        = string
}

variable "cognito_user_email" {
  description = "Email for initial Cognito user"
  type        = string
}

variable "cognito_user_name" {
  description = "Display name for initial Cognito user"
  type        = string
}

locals {
  default_tags = {
    project_id  = "certification-studies"
    managed_by  = "terraform"
    environment = "production"
  }
}

module "main" {
  source = "../../infrastructure"

  project_prefix          = "cert-stud"
  aws_region              = var.aws_region
  aws_profile             = var.aws_profile
  project_id              = "certification-studies"
  environment             = "production"
  domain_name             = var.domain_name
  hosted_zone_name        = var.hosted_zone_name
  cognito_user_email      = var.cognito_user_email
  cognito_user_name       = var.cognito_user_name
  frontend_deploy_enabled = true
}

# ============================================================================
# Outputs
# ============================================================================

output "cloudfront_distribution_domain" {
  value = module.main.cloudfront_distribution_domain
}

output "cloudfront_distribution_id" {
  value = module.main.cloudfront_distribution_id
}

output "s3_frontend_bucket" {
  value = module.main.s3_frontend_bucket
}

output "api_gateway_invoke_url" {
  value = module.main.api_gateway_invoke_url
}

output "cognito_user_pool_id" {
  value = module.main.cognito_user_pool_id
}

output "cognito_user_pool_client_id" {
  value = module.main.cognito_user_pool_client_id
}

output "custom_domain_url" {
  value = module.main.custom_domain_url
}
