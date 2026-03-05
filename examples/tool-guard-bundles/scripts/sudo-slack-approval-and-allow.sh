#!/bin/sh
set -eu

# -----------------------------------------------------------------------------
# EXAMPLE: sudo notification + allow
# -----------------------------------------------------------------------------
#
# Purpose
# - Show how Tool Guard can call a local script for side effects (notify humans)
#   while still allowing the guarded call.
#
# Typical use
# - Pair with a rule that matches `exec` commands containing `sudo`.
# - Use this for "awareness" workflows where you want a human-in-the-loop signal
#   but do not want to hard-block execution.
#
# Decision behavior
# - This script is intentionally fail-open.
# - It always returns `{"block":false}` (even if Slack delivery fails).
# - If you need strict approvals, use the interactive script
#   `web-browse-slack-human-approval.sh` as a pattern and return `block:true`
#   on timeout/rejection.
#
# Security notes
# - Keep message payloads minimal (command text may contain sensitive values).
# - Prefer routing alerts to private channels.
# -----------------------------------------------------------------------------
#
# Expected stdin payload shape:
# { "ruleId": "...", "event": { ... canonical event envelope ... } }
#
# Environment variables:
# - OPENCLAW_SLACK_CHANNEL: destination channel (default: #approvals)
# - OPENCLAW_APPROVAL_MENTION: optional plain-text mention prefix (default: empty)
# - OPENCLAW_APPROVAL_URL: optional URL for approval workflow (default: empty)
# - OPENCLAW_SLACK_SEND_CMD: command that sends JSON payload to bundled Slack plugin
#   (default: openclaw tools call slack.post_message --json @-)

payload="$(cat)"

if ! command -v jq >/dev/null 2>&1; then
  # If jq is unavailable, fail open and let execution continue.
  printf '{"block":false}\n'
  exit 0
fi

rule_id="$(printf '%s' "$payload" | jq -r '.ruleId // "unknown-rule"')"
event_type="$(printf '%s' "$payload" | jq -r '.event.type // "unknown-event"')"
tool_name="$(printf '%s' "$payload" | jq -r '.event.data.toolName // "unknown-tool"')"
command_text="$(printf '%s' "$payload" | jq -r '.event.data.params.command // ""')"
agent_id="$(printf '%s' "$payload" | jq -r '.event.agentId // "unknown-agent"')"
session_id="$(printf '%s' "$payload" | jq -r '.event.sessionId // "unknown-session"')"
run_id="$(printf '%s' "$payload" | jq -r '.event.runId // "unknown-run"')"
tool_call_id="$(printf '%s' "$payload" | jq -r '.event.toolCallId // "unknown-tool-call"')"

auto_channel="${OPENCLAW_SLACK_CHANNEL:-#approvals}"
mention_prefix="${OPENCLAW_APPROVAL_MENTION:-}"
approval_url="${OPENCLAW_APPROVAL_URL:-}"
slack_send_cmd="${OPENCLAW_SLACK_SEND_CMD:-openclaw tools call slack.post_message --json @-}"

message="Tool approval requested. Rule=${rule_id}. Event=${event_type}. Tool=${tool_name}. Agent=${agent_id}. Session=${session_id}. Run=${run_id}. ToolCall=${tool_call_id}. Command=${command_text}."

if [ -n "$mention_prefix" ]; then
  message="${mention_prefix} ${message}"
fi

if [ -n "$approval_url" ]; then
  message="${message} Approval URL: ${approval_url}"
fi

slack_payload="$(jq -n \
  --arg channel "$auto_channel" \
  --arg text "$message" \
  '{channel: $channel, text: $text}')"

# Best effort notification: never block the tool call if Slack delivery fails.
printf '%s\n' "$slack_payload" | sh -c "$slack_send_cmd" >/dev/null 2>&1 || true

# Explicitly allow the guarded tool call to proceed.
printf '{"block":false}\n'
