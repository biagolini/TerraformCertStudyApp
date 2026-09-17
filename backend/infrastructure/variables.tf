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
  description = "Custom domain for CloudFront (e.g., cert.yourdomain.com)"
  type        = string
}

variable "hosted_zone_name" {
  description = "Route53 hosted zone name (e.g., yourdomain.com)"
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

variable "bedrock_extraction_model_id" {
  description = "Fallback Bedrock model ID for the bulk exam import pipeline (vision + forced tool-use), used only when a job has no per-request model override — see the \"Exam import model\" setting"
  type        = string
  default     = "us.amazon.nova-pro-v1:0"
}

variable "review_agent_model_id" {
  description = "Bedrock model ID the AgentCore Runtime review agent uses to write question explanations. Quality over speed is the explicit priority for this pipeline, which originally pointed this at Claude Sonnet — but Anthropic models are blocked in this account behind an AWS Marketplace payment-instrument issue (see docs/review-agent-model-cost-comparison.md). Using Nova 2 Lite (with reasoning — see REASONING_MODEL_PATTERNS in agent/review_agent/app.py) as the interim default: already working in this account, cheaper than Nova Pro, and reasoning fits the agent's research-then-write pattern. Swap back to a Claude id here once Marketplace billing is fixed — no other code changes needed."
  type        = string
  default     = "us.amazon.nova-2-lite-v1:0"
}
