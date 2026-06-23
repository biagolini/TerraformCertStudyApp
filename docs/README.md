# Cert Study Assistant — Technical Documentation

AI-powered certification exam preparation using Amazon Bedrock (Nova models) with streaming responses.

## Architecture

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
        Lambda["Lambda<br/>(Flask + Web Adapter)"]
        Bedrock["Amazon Bedrock<br/>(Nova Micro/Lite/Pro)"]
        R53["Route53<br/>cert.serverlessai.click"]
        ACM["ACM Certificate"]
    end

    Browser -->|HTTPS| CF
    CF -->|OAC| S3
    R53 -->|Alias| CF
    ACM -.->|TLS| CF

    Browser -->|"POST /converse<br/>Bearer token"| APIGW
    APIGW -->|Cognito Authorizer| Cognito
    APIGW -->|"Streaming (NDJSON)"| Lambda
    Lambda -->|converse_stream| Bedrock
```

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

## Request Flow (Streaming)

```mermaid
sequenceDiagram
    participant App as Angular App
    participant APIGW as API Gateway
    participant Lambda as Lambda (Flask)
    participant BR as Bedrock (Nova)

    App->>APIGW: POST /converse<br/>Authorization: Bearer <idToken><br/>{model_id, system_prompt, messages, max_tokens}
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

## Components

| Component | Service | Purpose |
|-----------|---------|---------|
| Frontend | S3 + CloudFront | Angular SPA with Cognito SRP auth |
| Auth | Cognito User Pool | Email/password login, JWT tokens |
| API | API Gateway (REST) | `POST /converse` with Cognito authorizer, streaming |
| Compute | Lambda + Web Adapter | Flask app, Bedrock converse_stream via NDJSON |
| AI | Amazon Bedrock | Nova Micro/Lite/Pro models |
| DNS | Route53 + ACM | Custom domain with TLS |

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

`frontend_deploy_enabled = true` automatically: generates `environment.ts` → builds Angular → syncs to S3 → invalidates CloudFront.

## Pack Examples

Pre-configured study packs in [`docs/examples/`](examples/):

| File | Certification |
|------|---------------|
| `aws-clf-c02-pack.json` | AWS Cloud Practitioner |
| `aws-aif-c01-pack.json` | AWS AI Practitioner |
| `aws-saa-c03-pack.json` | AWS Solutions Architect Associate |
| `aws-dva-c02-pack.json` | AWS Developer Associate |
| `aws-soa-c03-pack.json` | AWS CloudOps Engineer Associate |
| `aws-dea-c01-pack.json` | AWS Data Engineer Associate |
| `aws-mla-c01-pack.json` | AWS ML Engineer Associate |
| `aws-sap-c02-pack.json` | AWS Solutions Architect Professional |
| `aws-dop-c02-pack.json` | AWS DevOps Engineer Professional |
| `aws-scs-c03-pack.json` | AWS Security Specialty |
| `aws-ans-c01-pack.json` | AWS Advanced Networking Specialty |
| `aws-aip-c01-pack.json` | AWS Generative AI Developer Professional |
| `ccaf-pack.json` | Claude Certified Architect Foundations |

Import via Pack Editor → "Import file" in the app.
