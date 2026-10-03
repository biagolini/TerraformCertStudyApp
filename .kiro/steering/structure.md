---
inclusion: always
---

# Where Things Live

Just enough map to navigate without reading docs. Full detail is in `docs/` (see `workflow.md`).

```
TerraformCertStudyApp/
├── backend/
│   ├── infrastructure/          # Terraform module: aws_<service>.tf, lambda/, agent/, scripts/, templates/
│   └── environments/production/ # The single environment: config.tf, main.tf, backend.hcl, terraform.tfvars
├── frontend/                    # Angular 21 SPA (src/app/{core,features,shared})
├── docs/                        # Project documentation (source of truth for design detail)
├── design-system/               # Static HTML/CSS design references
└── .kiro/                       # Agent config, steering (rules), MCP settings
```

Notes that save a wrong guess:

- The deployment environment is `production`, not `dev`, and it is the only one.
- Lambda source is in `backend/infrastructure/lambda/<function>/`, not next to the `.tf`.
- The AgentCore review agent lives in `backend/infrastructure/agent/review_agent/` and ships as a container image.
- Frontend feature code is one folder per screen under `frontend/src/app/features/`; shared state is in `core/services/`.
- Settings and the packs drawer are overlays inside `AppComponent`, not routes.
- Pack template JSONs served by the app are in `frontend/public/examples/`.
