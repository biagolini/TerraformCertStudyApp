# AgentCore Runtime HTTP protocol contract: ARM64, host 0.0.0.0, port 8080,
# GET /ping + POST /invocations — see docs.aws.amazon.com/bedrock-agentcore/
# latest/devguide/runtime-http-protocol-contract.html. BedrockAgentCoreApp
# (in app.py) implements that contract; this Dockerfile only has to expose it.

FROM --platform=linux/arm64 python:3.13-slim AS builder
WORKDIR /app
RUN python -m venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

FROM --platform=linux/arm64 python:3.13-slim
RUN useradd -r -u 1001 appuser
WORKDIR /app
COPY --from=builder /app /app
ENV PATH="/app/.venv/bin:$PATH"
USER appuser
EXPOSE 8080
# opentelemetry-instrument (from aws-opentelemetry-distro) auto-instruments
# the process — boto3/httpx calls plus Strands Agents' own built-in OTEL
# spans — and exports to CloudWatch GenAI Observability.
CMD ["opentelemetry-instrument", "python", "app.py"]
