#!/bin/sh
set -eu

# -----------------------------------------------------------------------------
# EXAMPLE RUNNER: live Tool Guard replay for interactive approvals
# -----------------------------------------------------------------------------
#
# Purpose
# - Exercise approval rules end-to-end without waiting for a real agent turn.
# - Quickly validate that your policy/action/script wiring is correct.
#
# What this script does
# 1) Builds a temporary Tool Guard config using the interactive approval script.
# 2) Generates one synthetic tool call input.
# 3) Runs `npm run toolguard:replay` against that input.
# 4) Prints allow/block result and exits.
#
# Why this is useful
# - You can test policy behavior in isolation before enabling it globally.
# - Great for CI smoke tests or local onboarding demos.
#
# Safety
# - Uses temporary files and deletes them at the end.
# - Does not mutate your main OpenClaw config.
# -----------------------------------------------------------------------------
#
# Required env (recommended):
# - OPENCLAW_APPROVAL_ALLOWED_USER_IDS: CSV Slack user IDs allowed to approve/reject.
#
# Optional env:
# - TEST_URL (default: https://example.com/live-approval-test)
# - TEST_QUERY (default: President of Brazil 2026)
# - TEST_AGENT_ID (default: main)
# - TEST_TOOL_NAME (default: web_search; supported: web_search|web_fetch|browser)
# - TEST_TIMEOUT_MS (default: 120000)
# - OPENCLAW_APPROVAL_TIMEOUT_SEC (default: 120)
# - OPENCLAW_APPROVAL_POLL_INTERVAL_SEC (default: 3)

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_dir="$(CDPATH= cd -- "$script_dir/../../.." && pwd)"
approval_script="$script_dir/web-browse-slack-human-approval.sh"

if [ ! -x "$approval_script" ]; then
  echo "approval script not executable: $approval_script" >&2
  exit 1
fi

test_url="${TEST_URL:-https://example.com/live-approval-test}"
test_query="${TEST_QUERY:-President of Brazil 2026}"
test_agent_id="${TEST_AGENT_ID:-main}"
test_tool_name="${TEST_TOOL_NAME:-web_search}"
test_timeout_ms="${TEST_TIMEOUT_MS:-120000}"

case "$test_tool_name" in
  web_search)
    test_params="$(jq -cn --arg query "$test_query" '{query: $query}')"
    test_rule_id="web-search-requires-human-approval"
    ;;
  web_fetch)
    test_params="$(jq -cn --arg url "$test_url" '{url: $url}')"
    test_rule_id="web-fetch-requires-human-approval"
    ;;
  browser)
    test_params="$(jq -cn --arg url "$test_url" '{url: $url, action: "goto"}')"
    test_rule_id="browser-requires-human-approval"
    ;;
  *)
    echo "Unsupported TEST_TOOL_NAME: $test_tool_name (supported: web_search|web_fetch|browser)" >&2
    exit 1
    ;;
esac

cfg="$(mktemp /tmp/toolguard-live-cfg.XXXXXX).json"
input="$(mktemp /tmp/toolguard-live-input.XXXXXX).ndjson"

cat > "$cfg" <<JSON
{
  "hookBridge": {
    "enabled": false,
    "allowedActionDirs": ["$script_dir"],
    "actions": {
      "request-web-tool-approval": {
        "type": "local_script",
        "path": "$approval_script",
        "args": [],
        "timeoutMs": $test_timeout_ms
      }
    },
    "toolGuard": {
      "enabled": true,
      "timeoutMs": $test_timeout_ms,
      "scopeKeyBy": "tool_and_params",
      "approvalCacheTtlMs": 0,
      "retryBackoffMs": 0,
      "rules": [
        {
          "id": "$test_rule_id",
          "priority": 100,
          "when": {"toolName": "$test_tool_name"},
          "action": "request-web-tool-approval"
        }
      ]
    }
  }
}
JSON

cat > "$input" <<NDJSON
{"toolName":"$test_tool_name","params":$test_params,"agentId":"$test_agent_id","sessionId":"sess-live-approval","runId":"run-live-approval","toolCallId":"tc-live-approval"}
NDJSON

echo "Running live replay..."
echo "Config: $cfg"
echo "Input:  $input"
echo "Tool:   $test_tool_name"
echo "URL:    $test_url"
echo "Query:  $test_query"

auto_timeout="${OPENCLAW_APPROVAL_TIMEOUT_SEC:-120}"
export OPENCLAW_APPROVAL_TIMEOUT_SEC="$auto_timeout"
export OPENCLAW_APPROVAL_POLL_INTERVAL_SEC="${OPENCLAW_APPROVAL_POLL_INTERVAL_SEC:-3}"

( cd "$repo_dir" && npm run -s toolguard:replay -- --config "$cfg" --input "$input" )

rm -f "$cfg" "$input"
