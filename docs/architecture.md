# Architecture

AI-powered certification exam preparation using Amazon Bedrock with streaming responses.

## Overview

```mermaid
graph TB
    subgraph Client
        Browser["Angular SPA<br/>(cert.serverlessai.click)"]
    end

    subgraph AWS Cloud
        CF["CloudFront<br/>Distribution"]
        S3["S3 Bucket<br/>(static frontend)"]
        APIGW["API Gateway<br/>(REST API)"]
        Cognito["Cognito<br/>User Pool"]
        LConverse["Lambda converse<br/>(Flask + Web Adapter)"]
        LData["Lambda data<br/>(Flask + Web Adapter)"]
        Bedrock["Amazon Bedrock<br/>(dynamic model list)"]
        DynamoDB["DynamoDB<br/>(user data)"]
        R53["Route53<br/>cert.serverlessai.click"]
        ACM["ACM Certificate"]
    end

    Browser -->|HTTPS| CF
    CF -->|OAC| S3
    R53 -->|Alias| CF
    ACM -.->|TLS| CF

    Browser -->|"POST /converse<br/>Bearer token"| APIGW
    Browser -->|"GET/PUT/DELETE /data<br/>Bearer token"| APIGW
    APIGW -->|Cognito Authorizer| Cognito
    APIGW -->|"Streaming (NDJSON)"| LConverse
    APIGW -->|"Buffered (JSON)"| LData
    LConverse -->|converse_stream| Bedrock
    LData -->|ListFoundationModels<br/>ListInferenceProfiles| Bedrock
    LData -->|CRUD| DynamoDB
```

## Components

| Component | Service | Purpose |
|-----------|---------|---------|
| Frontend | S3 + CloudFront | Angular 21 SPA with Cognito SRP auth |
| Auth | Cognito User Pool | Email/password login, JWT tokens |
| API | API Gateway (REST) | Routes with Cognito authorizer, streaming support |
| Converse | Lambda + Web Adapter | Flask app, Bedrock `converse_stream` via NDJSON |
| Data | Lambda + Web Adapter | CRUD for packs/questions/scripts, model discovery |
| Storage | DynamoDB | Single-table design for user data |
| AI | Amazon Bedrock | Dynamic model list (Nova, Claude, etc.) |
| DNS | Route53 + ACM | Custom domain with TLS |

## Authentication Flow

```mermaid
sequenceDiagram
    participant U as User
    participant App as Angular App
    participant Auth as AuthService (SRP)
    participant C as Cognito User Pool

    U->>App: Access site
    App->>Auth: ensureTokenValid()
    alt No token
        Auth-->>App: redirect /login
        U->>App: Enter email + password
        App->>Auth: login(email, pwd)
        Auth->>C: InitiateAuth (USER_SRP_AUTH)
        C-->>Auth: JWT tokens (id, access, refresh)
        Auth-->>App: authenticated
    else Token valid
        Auth-->>App: proceed
    end
    App->>U: Show main app
```

## Streaming Request Flow

```mermaid
sequenceDiagram
    participant App as Angular App
    participant APIGW as API Gateway
    participant Lambda as Lambda converse
    participant BR as Bedrock

    App->>APIGW: POST /converse<br/>Authorization: Bearer idToken<br/>{model_id, system_prompt, messages}
    APIGW->>APIGW: Validate JWT (Cognito)
    APIGW->>Lambda: Invoke (RESPONSE_STREAM)
    Lambda->>BR: converse_stream(modelId, messages, system, inferenceConfig)
    loop For each token
        BR-->>Lambda: contentBlockDelta
        Lambda-->>APIGW: {"type":"TOKEN","text":"..."}
        APIGW-->>App: NDJSON line
    end
    BR-->>Lambda: messageStop
    Lambda-->>App: {"type":"END","stopReason":"end_turn"}
```

## Deploy

### Prerequisites

- AWS CLI configured with profile
- Terraform >= 1.7
- Node.js + npm
- Amazon Nova models enabled in Bedrock (us-east-1)

### Steps

```bash
cd backend/environments/production
cp backend.hcl.example backend.hcl          # fill values
cp terraform.tfvars.example terraform.tfvars # fill values
terraform init -backend-config=backend.hcl
terraform apply
```

Setting `frontend_deploy_enabled = true` automatically: generates `environment.ts` → builds Angular → syncs to S3 → invalidates CloudFront.

## Related docs

- [Backend documentation](./backend.md)
- [Frontend documentation](./frontend.md)
