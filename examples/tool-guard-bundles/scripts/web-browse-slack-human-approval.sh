#!/bin/sh
set -eu

# -----------------------------------------------------------------------------
# EXAMPLE: strict human approval over Slack thread replies/reactions
# -----------------------------------------------------------------------------
#
# Purpose
# - Provide a practical "block until human approves" Tool Guard action for
#   non-exec tools (for example `web_search`, `web_fetch`, `browser`).
#
# Approval model
# - Script posts a request message to Slack.
# - It polls thread replies and reactions.
# - It allows only explicit human signals:
#   - approve: "approve"/"approved" text or checkmark reaction
#   - reject: "reject"/"rejected"/"declined" text or X reaction
#
# Security model
# - Bot-originated approvals are rejected.
# - Optional allowlist of approver user IDs is supported and recommended.
# - Default behavior is fail-closed when approver allowlist is required but
#   not configured (`OPENCLAW_APPROVAL_REQUIRE_ALLOWED_USERS=true`).
#
# Integration pattern
# - Pair this script with one or more Tool Guard rules that point to a shared
#   action ID (for example `request-web-tool-approval`).
# - Keep `toolGuard.timeoutMs` >= script timeout to avoid premature hook timeouts.
# -----------------------------------------------------------------------------

# Tool Guard local-script action for human approval of tool calls.
#
# Behavior:
# 1) Resolve channel/account/target from env, profile file, or openclaw.json.
# 2) Post an approval request message to Slack.
# 3) Poll Slack thread replies/reactions for approval or rejection.
# 4) Return Tool Guard decision JSON.
#
# Decision signals:
# - Approve: reply contains "approve" / "approved" OR check-mark reaction.
# - Reject: reply contains "reject" / "rejected" / "declined" OR X reaction.
#
# Env knobs:
# - OPENCLAW_APPROVAL_CHANNEL / OPENCLAW_APPROVAL_ACCOUNT / OPENCLAW_APPROVAL_TARGET
# - OPENCLAW_APPROVAL_PROFILE_FILE (default: ~/.openclaw/toolguard-approval-profiles.json)
# - OPENCLAW_APPROVAL_PROFILE (default: default)
# - OPENCLAW_CONFIG_PATH or OPENCLAW_STATE_DIR/openclaw.json
# - OPENCLAW_APPROVAL_TIMEOUT_SEC (default: 90)
# - OPENCLAW_APPROVAL_POLL_INTERVAL_SEC (default: 3)
# - OPENCLAW_APPROVAL_ALLOWED_USER_IDS (CSV of Slack user IDs allowed to approve/reject)
# - OPENCLAW_APPROVAL_REQUIRE_ALLOWED_USERS=true|false (default: true)
# - OPENCLAW_APPROVAL_REQUEST_HEADER (override top-of-message text)
#
# Test helper:
# - OPENCLAW_APPROVAL_TEST_DECISION=approve|reject (short-circuit decision)

payload="$(cat)"

if ! command -v jq >/dev/null 2>&1; then
  printf '{"block":true,"blockReason":"Human approval required, but jq is not installed on host."}\n'
  exit 0
fi
if ! command -v curl >/dev/null 2>&1; then
  printf '{"block":true,"blockReason":"Human approval required, but curl is not installed on host."}\n'
  exit 0
fi

state_dir="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
config_path="${OPENCLAW_CONFIG_PATH:-$state_dir/openclaw.json}"
profiles_file="${OPENCLAW_APPROVAL_PROFILE_FILE:-$state_dir/toolguard-approval-profiles.json}"
profile_name="${OPENCLAW_APPROVAL_PROFILE:-default}"

rule_id="$(printf '%s' "$payload" | jq -r '.ruleId // "tool-requires-human-approval"')"
event_type="$(printf '%s' "$payload" | jq -r '.event.type // "unknown-event"')"
tool_name="$(printf '%s' "$payload" | jq -r '.event.data.toolName // "unknown-tool"')"
url="$(printf '%s' "$payload" | jq -r '.event.data.params.url // ""')"
agent_id="$(printf '%s' "$payload" | jq -r '.event.agentId // "unknown-agent"')"
session_id="$(printf '%s' "$payload" | jq -r '.event.sessionId // "unknown-session"')"
run_id="$(printf '%s' "$payload" | jq -r '.event.runId // "unknown-run"')"
tool_call_id="$(printf '%s' "$payload" | jq -r '.event.toolCallId // "unknown-tool-call"')"

if [ -n "${OPENCLAW_APPROVAL_TEST_DECISION:-}" ]; then
  case "$(printf '%s' "$OPENCLAW_APPROVAL_TEST_DECISION" | tr '[:upper:]' '[:lower:]')" in
    approve|approved|allow)
      printf '{"block":false}\n'
      exit 0
      ;;
    reject|rejected|decline|declined|block)
      printf '{"block":true,"blockReason":"Rejected by human approval policy (test mode)."}\n'
      exit 0
      ;;
  esac
fi

approval_channel="${OPENCLAW_APPROVAL_CHANNEL:-}"
approval_account="${OPENCLAW_APPROVAL_ACCOUNT:-}"
approval_target="${OPENCLAW_APPROVAL_TARGET:-}"

if [ -f "$profiles_file" ]; then
  if [ -z "$approval_channel" ]; then
    approval_channel="$(jq -r --arg p "$profile_name" '(.profiles[$p] // .[$p] // {}) | .channel // empty' "$profiles_file" 2>/dev/null || true)"
  fi
  if [ -z "$approval_account" ]; then
    approval_account="$(jq -r --arg p "$profile_name" '(.profiles[$p] // .[$p] // {}) | .account // empty' "$profiles_file" 2>/dev/null || true)"
  fi
  if [ -z "$approval_target" ]; then
    approval_target="$(jq -r --arg p "$profile_name" '(.profiles[$p] // .[$p] // {}) | .target // empty' "$profiles_file" 2>/dev/null || true)"
  fi
  if [ -z "${OPENCLAW_APPROVAL_ALLOWED_USER_IDS:-}" ]; then
    profile_allowed_ids="$(jq -r --arg p "$profile_name" '
      (.profiles[$p] // .[$p] // {}) as $profile |
      if ($profile.allowedUserIds | type) == "array" then ($profile.allowedUserIds | join(","))
      elif ($profile.allowedUserIds | type) == "string" then $profile.allowedUserIds
      else ""
      end
    ' "$profiles_file" 2>/dev/null || true)"
    if [ -n "$profile_allowed_ids" ]; then
      OPENCLAW_APPROVAL_ALLOWED_USER_IDS="$profile_allowed_ids"
      export OPENCLAW_APPROVAL_ALLOWED_USER_IDS
    fi
  fi
fi

if [ -f "$config_path" ]; then
  if [ -z "$approval_channel" ]; then
    approval_channel="$(jq -r '.channels | to_entries | map(select((.value.enabled // true) == true)) | .[0].key // empty' "$config_path" 2>/dev/null || true)"
  fi

  if [ -n "$approval_channel" ] && [ -z "$approval_account" ]; then
    approval_account="$(jq -r --arg ch "$approval_channel" '.channels[$ch].accounts // {} | to_entries | map(select(.key != "default" and ((.value.enabled // true) == true))) | .[0].key // empty' "$config_path" 2>/dev/null || true)"
  fi

  if [ -z "$approval_target" ]; then
    if [ -n "$approval_account" ]; then
      approval_target="$(jq -r --arg ch "$approval_channel" --arg acc "$approval_account" '.channels[$ch].accounts[$acc].dm.groupChannels[0] // .channels[$ch].accounts[$acc].defaultTarget // .channels[$ch].defaultTarget // empty' "$config_path" 2>/dev/null || true)"
    else
      approval_target="$(jq -r --arg ch "$approval_channel" '.channels[$ch].defaultTarget // empty' "$config_path" 2>/dev/null || true)"
    fi
  fi
fi

if [ -z "$approval_channel" ] || [ -z "$approval_target" ]; then
  printf '{"block":true,"blockReason":"No approval destination resolved. Set OPENCLAW_APPROVAL_CHANNEL/OPENCLAW_APPROVAL_TARGET or configure approval profiles/openclaw.json defaults."}\n'
  exit 0
fi

slack_bot_token=""
if [ "$approval_channel" = "slack" ] && [ -f "$config_path" ] && [ -n "$approval_account" ]; then
  slack_bot_token="$(jq -r --arg acc "$approval_account" '.channels.slack.accounts[$acc].botToken // empty' "$config_path" 2>/dev/null || true)"
fi

if [ "$approval_channel" != "slack" ]; then
  printf '{"block":true,"blockReason":"This approval script currently supports only channel=slack for interactive reply/reaction decisions."}\n'
  exit 0
fi
if [ -z "$approval_account" ]; then
  printf '{"block":true,"blockReason":"Slack approval account was not resolved. Set OPENCLAW_APPROVAL_ACCOUNT or configure account defaults."}\n'
  exit 0
fi
if [ -z "$slack_bot_token" ]; then
  printf '{"block":true,"blockReason":"Slack bot token not found for resolved account in openclaw.json."}\n'
  exit 0
fi

auth_resp="$(curl -sS -X POST https://slack.com/api/auth.test \
  -H "Authorization: Bearer ${slack_bot_token}" || true)"
bot_user_id="$(printf '%s' "$auth_resp" | jq -r '.user_id // empty' 2>/dev/null || true)"
allowed_user_ids="${OPENCLAW_APPROVAL_ALLOWED_USER_IDS:-}"
require_allowed_users="$(printf '%s' "${OPENCLAW_APPROVAL_REQUIRE_ALLOWED_USERS:-true}" | tr '[:upper:]' '[:lower:]')"
case "$require_allowed_users" in
  1|true|yes|on) require_allowed_users="true" ;;
  *) require_allowed_users="false" ;;
esac
if [ "$require_allowed_users" = "true" ] && [ -z "$allowed_user_ids" ]; then
  printf '{"block":true,"blockReason":"No approver IDs configured. Set OPENCLAW_APPROVAL_ALLOWED_USER_IDS or profile.allowedUserIds."}\n'
  exit 0
fi

is_human_user_cache=""
is_human_user() {
  candidate="$1"
  [ -z "$candidate" ] && return 1
  if printf '%s\n' "$is_human_user_cache" | grep -Fq "${candidate}:human"; then
    return 0
  fi
  if printf '%s\n' "$is_human_user_cache" | grep -Fq "${candidate}:bot"; then
    return 1
  fi

  info_resp="$(curl -sS -G https://slack.com/api/users.info \
    -H "Authorization: Bearer ${slack_bot_token}" \
    --data-urlencode "user=${candidate}" || true)"
  info_ok="$(printf '%s' "$info_resp" | jq -r '.ok // false' 2>/dev/null || printf 'false')"
  if [ "$info_ok" != "true" ]; then
    is_human_user_cache="${is_human_user_cache}
${candidate}:bot"
    return 1
  fi

  is_bot="$(printf '%s' "$info_resp" | jq -r '.user.is_bot // false' 2>/dev/null || printf 'false')"
  deleted="$(printf '%s' "$info_resp" | jq -r '.user.deleted // false' 2>/dev/null || printf 'false')"
  if [ "$is_bot" = "true" ] || [ "$deleted" = "true" ]; then
    is_human_user_cache="${is_human_user_cache}
${candidate}:bot"
    return 1
  fi

  is_human_user_cache="${is_human_user_cache}
${candidate}:human"
  return 0
}

user_is_allowed_approver() {
  candidate="$1"
  if [ -z "$candidate" ]; then
    return 1
  fi
  if [ -n "$bot_user_id" ] && [ "$candidate" = "$bot_user_id" ]; then
    return 1
  fi
  if ! is_human_user "$candidate"; then
    return 1
  fi
  if [ "$require_allowed_users" != "true" ] && [ -z "$allowed_user_ids" ]; then
    return 0
  fi
  printf '%s' "$allowed_user_ids" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -Fxq "$candidate"
}

request_header="${OPENCLAW_APPROVAL_REQUEST_HEADER:-Tool Guard has blocked agent \"${agent_id}\" from using a tool. To approve, reply \"I approve\" or react with a check mark. To reject, reply \"rejected\" or react with an X emoji. See additional details:}"

details="<details>\nRule: ${rule_id}\nEvent: ${event_type}\nTool: ${tool_name}\nURL: ${url}\nAgent: ${agent_id}\nSession: ${session_id}\nRun: ${run_id}\nToolCall: ${tool_call_id}\n</details>"

message_text="${request_header}\n${details}"

post_payload="$(jq -n --arg channel "$approval_target" --arg text "$message_text" '{channel: $channel, text: $text}')"
post_resp="$(curl -sS -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer ${slack_bot_token}" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d "$post_payload" || true)"

post_ok="$(printf '%s' "$post_resp" | jq -r '.ok // false' 2>/dev/null || printf 'false')"
if [ "$post_ok" != "true" ]; then
  err="$(printf '%s' "$post_resp" | jq -r '.error // "unknown"' 2>/dev/null || printf 'unknown')"
  jq -n --arg reason "Failed to send Slack approval request (${err}). Blocking tool call." '{block: true, blockReason: $reason}'
  exit 0
fi

thread_ts="$(printf '%s' "$post_resp" | jq -r '.ts // empty')"
channel_id="$(printf '%s' "$post_resp" | jq -r '.channel // empty')"
if [ -z "$thread_ts" ] || [ -z "$channel_id" ]; then
  printf '{"block":true,"blockReason":"Slack approval request sent but message id/channel missing; blocking tool call."}\n'
  exit 0
fi

timeout_sec="${OPENCLAW_APPROVAL_TIMEOUT_SEC:-90}"
poll_sec="${OPENCLAW_APPROVAL_POLL_INTERVAL_SEC:-3}"
if [ "$timeout_sec" -le 0 ] 2>/dev/null; then timeout_sec=90; fi
if [ "$poll_sec" -le 0 ] 2>/dev/null; then poll_sec=3; fi

start_ts="$(date +%s)"

is_approved_text() {
  text_lc="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$text_lc" in
    *"i approve"*|*"approved"*|*"approve"*) return 0 ;;
  esac
  return 1
}

is_rejected_text() {
  text_lc="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$text_lc" in
    *"declined"*|*"rejected"*|*"reject"*) return 0 ;;
  esac
  return 1
}

has_check_reaction() {
  names="$1"
  printf '%s' "$names" | tr '[:upper:]' '[:lower:]' | grep -Eq 'check|white_check_mark|heavy_check_mark'
}

has_x_reaction() {
  names="$1"
  printf '%s' "$names" | tr '[:upper:]' '[:lower:]' | grep -Eq '(^|,)x(,|$)|xmark|heavy_multiplication_x|cross_mark|no_entry'
}

while :; do
  now_ts="$(date +%s)"
  elapsed=$((now_ts - start_ts))
  if [ "$elapsed" -ge "$timeout_sec" ]; then
    jq -n --arg reason "No human approval decision received within ${timeout_sec}s. Tool call remains blocked." '{block: true, blockReason: $reason}'
    exit 0
  fi

  replies_resp="$(curl -sS -G https://slack.com/api/conversations.replies \
    -H "Authorization: Bearer ${slack_bot_token}" \
    --data-urlencode "channel=${channel_id}" \
    --data-urlencode "ts=${thread_ts}" || true)"

  replies_ok="$(printf '%s' "$replies_resp" | jq -r '.ok // false' 2>/dev/null || printf 'false')"
  if [ "$replies_ok" = "true" ]; then
    # Replies (excluding the root request message at index 0), with actor user id.
    decision_from_reply="$(printf '%s' "$replies_resp" | jq -c '
      .messages[1:] // [] |
      map(select((.subtype // "") == "")) |
      map({user: (.user // ""), text: (.text // "")}) |
      .[]
    ' 2>/dev/null || true)"

    if [ -n "$decision_from_reply" ]; then
      # Evaluate newest lines first for latest intent.
      rev_lines="$(printf '%s\n' "$decision_from_reply" | awk '{a[NR]=$0} END{for(i=NR;i>=1;i--) print a[i]}')"
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        actor_user="$(printf '%s' "$line" | jq -r '.user // ""' 2>/dev/null || true)"
        actor_text="$(printf '%s' "$line" | jq -r '.text // ""' 2>/dev/null || true)"
        if ! user_is_allowed_approver "$actor_user"; then
          continue
        fi
        if is_rejected_text "$actor_text"; then
          printf '{"block":true,"blockReason":"Rejected by human approval in Slack thread."}\n'
          exit 0
        fi
        if is_approved_text "$actor_text"; then
          printf '{"block":false}\n'
          exit 0
        fi
      done <<EOF_REPLIES
$rev_lines
EOF_REPLIES
    fi

    reaction_rows="$(printf '%s' "$replies_resp" | jq -c '.messages[0].reactions // [] | .[]' 2>/dev/null || true)"
    if [ -n "$reaction_rows" ]; then
      while IFS= read -r reaction; do
        [ -z "$reaction" ] && continue
        reaction_name="$(printf '%s' "$reaction" | jq -r '.name // ""' 2>/dev/null || true)"
        reaction_users="$(printf '%s' "$reaction" | jq -r '.users // [] | .[]' 2>/dev/null || true)"
        matched_human="false"
        if [ -n "$reaction_users" ]; then
          while IFS= read -r u; do
            [ -z "$u" ] && continue
            if user_is_allowed_approver "$u"; then
              matched_human="true"
              break
            fi
          done <<EOF_USERS
$reaction_users
EOF_USERS
        fi
        if [ "$matched_human" != "true" ]; then
          continue
        fi

        if has_x_reaction "$reaction_name"; then
          printf '{"block":true,"blockReason":"Rejected by human X reaction on Slack approval request."}\n'
          exit 0
        fi
        if has_check_reaction "$reaction_name"; then
          printf '{"block":false}\n'
          exit 0
        fi
      done <<EOF_REACTIONS
$reaction_rows
EOF_REACTIONS
    fi
  fi

  sleep "$poll_sec"
done
