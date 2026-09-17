"""AWS Documentation lookup — Gateway Lambda target.

Exposed to the review agent as an MCP tool via AgentCore Gateway (a Gateway
"Lambda" target maps MCP tool schemas straight to a Lambda invocation — see
docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-add-target-api-target-config.html).
Gateway cannot proxy a stdio-based MCP server directly (only Streamable
HTTP), so instead of running awslabs.aws-documentation-mcp-server as a
subprocess, this Lambda implements the same two tools it exposes
(search_documentation, read_documentation) against the same public AWS
documentation endpoints that package itself calls.

Gateway invokes this Lambda directly (no MCP protocol code needed here) with
an event shaped like {"toolName": "...", "arguments": {...}} — the field
names match how AgentCore Gateway is documented to invoke Lambda targets.
"""

import json
import re
from html.parser import HTMLParser
from urllib.request import Request, urlopen

SEARCH_ENDPOINT = "https://proxy.search.docs.aws.amazon.com/search"
USER_AGENT = "cert-study-assistant-review-agent/1.0 (aws-documentation-lookup-tool)"


class _TextExtractor(HTMLParser):
    """Minimal HTML-to-text extractor — good enough for grounding an
    explanation; avoids pulling in a third-party HTML/Markdown library for
    a Lambda that only ever reads AWS's own documentation pages."""

    _SKIP_TAGS = {"script", "style", "nav", "header", "footer"}

    def __init__(self):
        super().__init__()
        self._skip_depth = 0
        self.chunks = []

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP_TAGS:
            self._skip_depth += 1
        elif tag in ("p", "li", "h1", "h2", "h3", "h4", "br", "tr"):
            self.chunks.append("\n")

    def handle_endtag(self, tag):
        if tag in self._SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data):
        if self._skip_depth == 0 and data.strip():
            self.chunks.append(data.strip())

    def text(self):
        return re.sub(r"\n{3,}", "\n\n", " ".join(self.chunks).replace(" \n", "\n")).strip()


def _http_get(url, data=None, headers=None):
    req = Request(url, data=data, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urlopen(req, timeout=15) as resp:  # noqa: S310 — fixed, non-user-controlled AWS domains only
        return resp.read()


def search_documentation(search_phrase: str, limit: int = 5) -> list:
    """Search official AWS documentation, mirroring the awslabs
    aws-documentation-mcp-server's search_documentation tool."""
    body = json.dumps({"search_phrase": search_phrase, "size": min(max(limit, 1), 10)}).encode("utf-8")
    raw = _http_get(SEARCH_ENDPOINT, data=body, headers={"Content-Type": "application/json"})
    data = json.loads(raw)
    results = []
    for item in (data.get("suggestions") or [])[:limit]:
        text_item = item.get("textExcerptSuggestion") or {}
        results.append(
            {
                "title": text_item.get("title", ""),
                "url": text_item.get("link", ""),
                "context": text_item.get("summary", ""),
            }
        )
    return results


def read_documentation(url: str, max_length: int = 8000) -> str:
    """Fetch an AWS documentation page and return its readable text content,
    mirroring the awslabs aws-documentation-mcp-server's read_documentation
    tool. Restricted to docs.aws.amazon.com to avoid this tool being used as
    an open fetch proxy."""
    if not re.match(r"^https://docs\.aws\.amazon\.com/", url):
        raise ValueError("read_documentation only supports docs.aws.amazon.com URLs")
    raw = _http_get(url)
    parser = _TextExtractor()
    parser.feed(raw.decode("utf-8", errors="replace"))
    text = parser.text()
    return text[:max_length]


_TOOLS = {
    "search_documentation": lambda args: search_documentation(
        args.get("search_phrase", ""), args.get("limit", 5)
    ),
    "read_documentation": lambda args: read_documentation(
        args.get("url", ""), args.get("max_length", 8000)
    ),
}


def handler(event, context):
    tool_name = event.get("toolName") or event.get("tool_name") or ""
    arguments = event.get("arguments") or event.get("input") or {}

    tool = _TOOLS.get(tool_name)
    if not tool:
        return {"error": f"Unknown tool: {tool_name}"}

    try:
        return {"result": tool(arguments)}
    except Exception as e:  # noqa: BLE001 — return a tool-call error, never raise into Gateway
        return {"error": str(e)}
