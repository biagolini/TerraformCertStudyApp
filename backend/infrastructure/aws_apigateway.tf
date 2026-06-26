# ============================================================================
# API Gateway — REST API with Cognito Authorizer + Streaming Route
# ============================================================================

resource "aws_api_gateway_rest_api" "main" {
  name = "${var.project_prefix}-api"

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

# --- Cognito Authorizer ---

resource "aws_api_gateway_authorizer" "cognito" {
  name            = "${var.project_prefix}-cognito-authorizer"
  rest_api_id     = aws_api_gateway_rest_api.main.id
  type            = "COGNITO_USER_POOLS"
  identity_source = "method.request.header.Authorization"
  provider_arns   = [aws_cognito_user_pool.main.arn]
}

# --- /converse resource ---

resource "aws_api_gateway_resource" "converse" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "converse"
}

# --- POST /converse (streaming) ---

resource "aws_api_gateway_method" "converse_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.converse.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "converse_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.converse.id
  http_method             = aws_api_gateway_method.converse_post.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.converse.response_streaming_invoke_arn
  response_transfer_mode  = "STREAM"
  timeout_milliseconds    = 900000
  credentials             = aws_iam_role.api_gateway_lambda.arn
}

# --- OPTIONS /converse (CORS) ---

resource "aws_api_gateway_method" "converse_options" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.converse.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "converse_options" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.converse.id
  http_method = aws_api_gateway_method.converse_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "converse_options_200" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.converse.id
  http_method = aws_api_gateway_method.converse_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }

  response_models = {
    "application/json" = "Empty"
  }
}

resource "aws_api_gateway_integration_response" "converse_options_200" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.converse.id
  http_method = aws_api_gateway_method.converse_options.http_method
  status_code = aws_api_gateway_method_response.converse_options_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# --- Gateway Responses (CORS on errors) ---

resource "aws_api_gateway_gateway_response" "default_4xx" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  response_type = "DEFAULT_4XX"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
  }
}

resource "aws_api_gateway_gateway_response" "default_5xx" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  response_type = "DEFAULT_5XX"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
  }
}

# ============================================================================
# /data resource — CRUD for DynamoDB user data
# ============================================================================

resource "aws_api_gateway_resource" "data" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "data"
}

resource "aws_api_gateway_resource" "data_proxy" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.data.id
  path_part   = "{proxy+}"
}

# --- GET /data ---

resource "aws_api_gateway_method" "data_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.data.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "data_get" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.data.id
  http_method             = aws_api_gateway_method.data_get.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.data.invoke_arn

  request_parameters = {
    "integration.request.header.x-user-id" = "context.authorizer.claims.sub"
  }
}

# --- PUT /data ---

resource "aws_api_gateway_method" "data_put" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.data.id
  http_method   = "PUT"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "data_put" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.data.id
  http_method             = aws_api_gateway_method.data_put.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.data.invoke_arn

  request_parameters = {
    "integration.request.header.x-user-id" = "context.authorizer.claims.sub"
  }
}

# --- OPTIONS /data (CORS) ---

resource "aws_api_gateway_method" "data_options" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.data.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "data_options" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.data.id
  http_method = aws_api_gateway_method.data_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "data_options_200" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.data.id
  http_method = aws_api_gateway_method.data_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }

  response_models = { "application/json" = "Empty" }
}

resource "aws_api_gateway_integration_response" "data_options_200" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.data.id
  http_method = aws_api_gateway_method.data_options.http_method
  status_code = aws_api_gateway_method_response.data_options_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# --- PUT /data/{proxy+} ---

resource "aws_api_gateway_method" "data_proxy_put" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.data_proxy.id
  http_method   = "PUT"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id

  request_parameters = {
    "method.request.path.proxy" = true
  }
}

resource "aws_api_gateway_integration" "data_proxy_put" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.data_proxy.id
  http_method             = aws_api_gateway_method.data_proxy_put.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.data.invoke_arn

  request_parameters = {
    "integration.request.header.x-user-id" = "context.authorizer.claims.sub"
  }
}

# --- DELETE /data/{proxy+} ---

resource "aws_api_gateway_method" "data_proxy_delete" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.data_proxy.id
  http_method   = "DELETE"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id

  request_parameters = {
    "method.request.path.proxy" = true
  }
}

resource "aws_api_gateway_integration" "data_proxy_delete" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.data_proxy.id
  http_method             = aws_api_gateway_method.data_proxy_delete.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.data.invoke_arn

  request_parameters = {
    "integration.request.header.x-user-id" = "context.authorizer.claims.sub"
  }
}

# --- GET /data/{proxy+} (model discovery: GET /data/models) ---

resource "aws_api_gateway_method" "data_proxy_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.data_proxy.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id

  request_parameters = {
    "method.request.path.proxy" = true
  }
}

resource "aws_api_gateway_integration" "data_proxy_get" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.data_proxy.id
  http_method             = aws_api_gateway_method.data_proxy_get.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.data.invoke_arn

  request_parameters = {
    "integration.request.header.x-user-id" = "context.authorizer.claims.sub"
  }
}

# --- OPTIONS /data/{proxy+} (CORS) ---

resource "aws_api_gateway_method" "data_proxy_options" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.data_proxy.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "data_proxy_options" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.data_proxy.id
  http_method = aws_api_gateway_method.data_proxy_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "data_proxy_options_200" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.data_proxy.id
  http_method = aws_api_gateway_method.data_proxy_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }

  response_models = { "application/json" = "Empty" }
}

resource "aws_api_gateway_integration_response" "data_proxy_options_200" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.data_proxy.id
  http_method = aws_api_gateway_method.data_proxy_options.http_method
  status_code = aws_api_gateway_method_response.data_proxy_options_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# --- Deployment + Stage ---

resource "aws_api_gateway_deployment" "main" {
  rest_api_id = aws_api_gateway_rest_api.main.id

  triggers = {
    redeployment = sha256(jsonencode([
      aws_api_gateway_integration.converse_post.uri,
      aws_api_gateway_integration.data_get.uri,
      aws_api_gateway_integration.data_put.uri,
      aws_api_gateway_integration.data_proxy_put.uri,
      aws_api_gateway_integration.data_proxy_delete.uri,
      aws_api_gateway_integration.data_proxy_get.uri,
      aws_api_gateway_gateway_response.default_4xx.response_parameters,
      aws_api_gateway_gateway_response.default_5xx.response_parameters,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_method.converse_post,
    aws_api_gateway_integration.converse_post,
    aws_api_gateway_method.converse_options,
    aws_api_gateway_integration.converse_options,
    aws_api_gateway_method.data_get,
    aws_api_gateway_integration.data_get,
    aws_api_gateway_method.data_put,
    aws_api_gateway_integration.data_put,
    aws_api_gateway_method.data_options,
    aws_api_gateway_integration.data_options,
    aws_api_gateway_method.data_proxy_put,
    aws_api_gateway_integration.data_proxy_put,
    aws_api_gateway_method.data_proxy_delete,
    aws_api_gateway_integration.data_proxy_delete,
    aws_api_gateway_method.data_proxy_get,
    aws_api_gateway_integration.data_proxy_get,
    aws_api_gateway_method.data_proxy_options,
    aws_api_gateway_integration.data_proxy_options,
    aws_api_gateway_gateway_response.default_4xx,
    aws_api_gateway_gateway_response.default_5xx,
  ]
}

resource "aws_api_gateway_stage" "main" {
  deployment_id = aws_api_gateway_deployment.main.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  stage_name    = var.environment
}

# --- Lambda Permission ---

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.converse.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*"
}
