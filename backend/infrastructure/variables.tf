# ============================================================================
# Variables
# ============================================================================

variable "project_prefix" {
  description = "Project identifier prefix for all resource names"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "aws_profile" {
  description = "AWS CLI profile for S3 deploy commands"
  type        = string
  default     = ""
}

variable "project_id" {
  description = "Project identifier for cost allocation tags"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "production"
}

variable "domain_name" {
  description = "Custom domain for CloudFront (e.g., cert.serverlessai.click)"
  type        = string
}

variable "hosted_zone_name" {
  description = "Route53 hosted zone name (e.g., serverlessai.click)"
  type        = string
}

variable "cognito_user_email" {
  description = "Email for the initial Cognito user"
  type        = string
}

variable "cognito_user_name" {
  description = "Display name for the initial Cognito user"
  type        = string
}

variable "bedrock_model_id" {
  description = "Bedrock model ID for Amazon Nova (converse API)"
  type        = string
  default     = "amazon.nova-lite-v1:0"
}
