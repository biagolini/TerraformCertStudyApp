# ============================================================================
# Cognito — User Pool, Domain, Client, and Initial User
# ============================================================================

resource "aws_cognito_user_pool" "main" {
  name = "${var.project_prefix}-user-pool"

  auto_verified_attributes = ["email"]
  username_attributes      = ["email"]

  password_policy {
    minimum_length                   = 8
    require_uppercase                = true
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true
  }

  admin_create_user_config {
    invite_message_template {
      email_subject = "Cert Study Assistant — Your temporary credentials"
      email_message = file("${path.module}/templates/cognito-invite/email.html")
      sms_message   = "Your credentials — Username: {username}, Password: {####}"
    }
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Cert Study Assistant — Verify your email"
    email_message        = file("${path.module}/templates/cognito-verify/email.html")
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

# --- Cognito Domain (Managed Login) ---

resource "aws_cognito_user_pool_domain" "main" {
  domain       = "${var.project_prefix}-${random_string.cognito_domain_suffix.result}"
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "random_string" "cognito_domain_suffix" {
  length  = 8
  special = false
  upper   = false
}

# --- App Client (with OAuth) ---

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.project_prefix}-web-client"
  user_pool_id = aws_cognito_user_pool.main.id

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "email", "profile"]

  callback_urls = [
    "https://${var.domain_name}/callback",
    "http://localhost:4200/callback",
  ]

  logout_urls = [
    "https://${var.domain_name}",
    "http://localhost:4200",
  ]

  supported_identity_providers = ["COGNITO"]
  generate_secret              = false
}

# --- Initial User ---

resource "random_password" "initial_user_temp" {
  length           = 16
  special          = true
  override_special = "!@#$%&*()-_=+"
  min_special      = 2
  min_upper        = 2
  min_lower        = 2
  min_numeric      = 2
}

resource "aws_cognito_user" "initial" {
  user_pool_id = aws_cognito_user_pool.main.id
  username     = var.cognito_user_email

  attributes = {
    email          = var.cognito_user_email
    email_verified = "true"
    name           = var.cognito_user_name
  }

  temporary_password = random_password.initial_user_temp.result

  lifecycle {
    ignore_changes = [temporary_password]
  }
}
