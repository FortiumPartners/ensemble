# Integration Test Infrastructure

This directory contains the test infrastructure for headless Claude Code session testing as defined in the TRD testing-phase document.

## Directory Structure

```
test/integration/
├── config/
│   └── permissive-allowlist.json  # Permission bypass for testing (TRD-TEST-032)
├── scripts/
│   ├── run-headless.sh            # Headless execution with OTel (TRD-TEST-029)
│   ├── verify-output.sh           # Session output verification (TRD-TEST-030)
│   └── run-ab-test.sh             # A/B comparison runner (TRD-TEST-031)
├── sessions/                       # Session log output directory
├── reports/                        # A/B comparison reports
└── README.md                       # This file
```

## Prerequisites

- Claude Code CLI installed and available in PATH
- `jq` for JSON parsing
- `uuidgen` for session ID generation (usually pre-installed)
- Bash 4.0+ (for associative arrays and other features)

## Quick Start

### Run a Headless Session

```bash
# Basic usage
./scripts/run-headless.sh "Create a Python function that adds two numbers"

# With timeout
./scripts/run-headless.sh "Run the test suite" --timeout 600

# With custom session ID
./scripts/run-headless.sh "Fix the bug" --session-id my-test-123
```

### Verify Session Output

```bash
# Check if a tool was invoked
./scripts/verify-output.sh check_tool_invoked sessions/session-abc.jsonl Write

# Check if a file was created
./scripts/verify-output.sh check_file_created sessions/session-abc.jsonl src/main.py

# List all tools used in a session
./scripts/verify-output.sh list_all_tools sessions/session-abc.jsonl

# Extract tool results
./scripts/verify-output.sh extract_tool_results sessions/session-abc.jsonl Read
```

### Run A/B Comparison Tests

```bash
# With custom prompts
./scripts/run-ab-test.sh \
    --prompt-a "Create a Python function without skill" \
    --prompt-b "Use Skill tool then create a Python function"

# With predefined skill test
./scripts/run-ab-test.sh --skill developing-with-python

# Run sequentially (for debugging)
./scripts/run-ab-test.sh --skill pytest --sequential
```

## OpenTelemetry Configuration

The `run-headless.sh` script automatically enables OpenTelemetry for session observability.

### What Claude Code Exports

Claude Code exports **metrics and events** via OpenTelemetry (not distributed traces):

| Data Type | Protocol | Events/Metrics |
|-----------|----------|----------------|
| Metrics | OTLP Metrics | Token usage, API latency, session counts |
| Events | OTLP Logs | `user_prompt`, `tool_result`, `api_request`, `api_error`, `tool_decision` |

Note: Claude Code does not export distributed traces. The "tracing" capability comes from structured events exported via the OTLP logs protocol.

### Environment Variables

#### Core Configuration (Set by run-headless.sh)

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_CODE_ENABLE_TELEMETRY` | `1` | Enable telemetry export |
| `OTEL_METRICS_EXPORTER` | `console` | Metrics exporter (`console`, `otlp`, `none`) |
| `OTEL_LOGS_EXPORTER` | `console` | Logs/events exporter (`console`, `otlp`, `none`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` | OTLP collector endpoint |
| `OTEL_SERVICE_NAME` | `ensemble-vnext-test` | Service name for telemetry |
| `OTEL_RESOURCE_ATTRIBUTES` | `service.version=1.0.0` | Additional resource attributes |

#### Optional Production Configuration

| Variable | Example | Description |
|----------|---------|-------------|
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` or `http/protobuf` | OTLP transport protocol |
| `OTEL_METRIC_EXPORT_INTERVAL` | `10000` | Metrics export interval (ms) |
| `OTEL_LOGS_EXPORT_INTERVAL` | `5000` | Logs export interval (ms) |
| `OTEL_EXPORTER_OTLP_HEADERS` | `Authorization=Basic xxx` | Auth headers for collector |

### Telemetry Data Capture

Telemetry data is captured in two ways:

1. **JSONL Session Logs**: Claude Code's native output format saved to `sessions/session-<UUID>.jsonl`
2. **OTLP Export**: Metrics and events sent to configured OTLP endpoint

When using `console` exporters (default), telemetry is written to stderr and captured in the session JSONL file alongside Claude's response output.

### Using with a Collector

```bash
# Start an OTLP collector (e.g., Jaeger for viewing events)
docker run -d --name jaeger \
    -p 16686:16686 \
    -p 4317:4317 \
    jaegertracing/all-in-one:latest

# Run with OTLP export enabled
OTEL_METRICS_EXPORTER=otlp \
OTEL_LOGS_EXPORTER=otlp \
OTEL_ENDPOINT=http://localhost:4317 \
./scripts/run-headless.sh "Your prompt"

# View in Jaeger UI: http://localhost:16686
```

### Using with Grafana Cloud

```bash
OTEL_METRICS_EXPORTER=otlp \
OTEL_LOGS_EXPORTER=otlp \
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
OTEL_EXPORTER_OTLP_ENDPOINT="https://otlp-gateway-prod-us-east-0.grafana.net/otlp" \
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <token>" \
./scripts/run-headless.sh "Your prompt"
```

### Using with SigNoz

```bash
OTEL_METRICS_EXPORTER=otlp \
OTEL_LOGS_EXPORTER=otlp \
OTEL_EXPORTER_OTLP_PROTOCOL=grpc \
OTEL_EXPORTER_OTLP_ENDPOINT="https://ingest.<region>.signoz.cloud:443" \
OTEL_EXPORTER_OTLP_HEADERS="signoz-access-token=<token>" \
./scripts/run-headless.sh "Your prompt"
```

## Permission Bypass

The `permissive-allowlist.json` provides a comprehensive permission configuration for automated testing. It allows:

- All file read operations
- File write operations (except node_modules and .git)
- Common shell commands (npm, node, python, git, etc.)
- Localhost network access
- All tool invocations
- All agent delegations
- All skill invocations

**Warning**: This allowlist is for testing only. Do not use in production.

## A/B Test Workflow

1. **Define Variants**: Create prompts for variant A (without feature) and B (with feature)
2. **Run Test**: Execute both variants (parallel by default)
3. **Collect Results**: Session logs saved to `sessions/`
4. **Compare**: Comparison report generated in `reports/`
5. **Analyze**: Review tools used, success rates, and output metrics

### Predefined Skill Tests

| Skill | Variant A | Variant B |
|-------|-----------|-----------|
| `developing-with-python` | Create without skill | Invoke skill first |
| `developing-with-flutter` | Create without skill | Invoke skill first |
| `developing-with-typescript` | Create without skill | Invoke skill first |
| `using-fastapi` | Create without skill | Invoke skill first |
| `pytest` | Write tests without skill | Invoke skill first |

## Output Files

### Session Logs (`sessions/session-<UUID>.jsonl`)

JSONL format with Claude Code execution events:
- Tool invocations and results
- Assistant messages
- System events
- Error information

### Comparison Reports (`reports/<test>_<timestamp>_comparison.json`)

JSON format with:
- Variant A and B metadata
- Tools used by each variant
- Success/failure status
- Output metrics (lines, bytes)
- Comparison summary

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Check failed / Error |
| 2 | Invalid arguments / Missing dependencies |
| 124 | Timeout |

## TRD Task References

| File | TRD Task | Description |
|------|----------|-------------|
| `run-headless.sh` | TRD-TEST-029 | Headless execution with OpenTelemetry |
| `verify-output.sh` | TRD-TEST-030 | Output verification utilities |
| `run-ab-test.sh` | TRD-TEST-031 | A/B comparison runner |
| `permissive-allowlist.json` | TRD-TEST-032 | Permission bypass config |

## Related Documentation

- [Testing Phase TRD](../../docs/TRD/testing-phase.md)
- [Ensemble vNext PRD](../../docs/PRD/ensemble-vnext.md)
- [Constitution](../../.claude/rules/constitution.md)
