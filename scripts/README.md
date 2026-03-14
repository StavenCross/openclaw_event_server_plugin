# Hook Bridge Scripts

This directory contains Python scripts that can be triggered by the event-server-plugin hook bridge.

## Subagent Completion Notifier

**File:** `subagent_completion_notifier.py`

### Purpose

Automatically injects a notification message into a parent agent session when a subagent completes. This solves the problem where subagents sometimes forget to broadcast completion, leaving parent agents unaware that work is done.

### How It Works

1. The event-server-plugin detects a `subagent.ended` event
2. The hook bridge triggers this script with the event payload on stdin
3. The script extracts parent session information from the event
4. It sends a message to the parent session via the Gateway API
5. The parent agent receives the notification and can check on the subagent's work

### Configuration

Add this to your `config.json` hook bridge configuration:

```json
{
  "hookBridge": {
    "enabled": true,
    "dryRun": false,
    "allowedActionDirs": [
      "/Users/cmiller/Documents/Projects/openclaw_event_server_plugin/scripts"
    ],
    "localScriptDefaults": {
      "timeoutMs": 10000,
      "maxPayloadBytes": 65536
    },
    "actions": {
      "notify_parent_subagent_done": {
        "type": "local_script",
        "path": "/Users/cmiller/Documents/Projects/openclaw_event_server_plugin/scripts/subagent_completion_notifier.py",
        "timeoutMs": 10000,
        "maxPayloadBytes": 65536
      }
    },
    "rules": [
      {
        "id": "notify-parent-on-subagent-end",
        "enabled": true,
        "action": "notify_parent_subagent_done",
        "cooldownMs": 0,
        "when": {
          "eventType": ["subagent.ended", "subagent_ended"]
        }
      }
    ]
  }
}
```

### Environment Variables

The script requires the following environment variables:

- `EVENT_PLUGIN_HMAC_SECRET` - HMAC secret for signing Gateway API requests (required)
  - OR set `EVENT_PLUGIN_HMAC_SECRET_PATH` to point to a file containing the secret
- `OPENCLAW_GATEWAY_URL` - Gateway API base URL (default: `http://localhost:6254`)

### Event Payload

The script receives a JSON payload on stdin:

```json
{
  "ruleId": "notify-parent-on-subagent-end",
  "event": {
    "eventId": "evt-123456",
    "type": "subagent.ended",
    "eventCategory": "subagent",
    "data": {
      "parentAgentId": "jacob",
      "parentSessionKey": "parent-session-key",
      "childAgentId": "coder-opus",
      "childSessionKey": "child-session-key",
      "endReason": "completed"
    }
  }
}
```

### Output

On success:
```json
{
  "success": true,
  "ruleId": "notify-parent-on-subagent-end",
  "parentSessionKey": "parent-session-key",
  "parentAgentId": "jacob",
  "metadata": {
    "subagent_session_key": "child-session-key",
    "subagent_agent_id": "coder-opus",
    "end_reason": "completed"
  },
  "result": {...}
}
```

On failure:
```json
{
  "success": false,
  "error": "Error message here",
  "ruleId": "notify-parent-on-subagent-end"
}
```

### Notification Message

The injected message looks like:

```
🔔 **Subagent Completion Notification**

Your subagent has finished running. Please check in on the session.

**Details:**
- Subagent Session Key: `child-session-key`
- Subagent Agent ID: `coder-opus`
- End Reason: `completed`

**Next Steps:**
- If work was completed, inform the user
- If work was stalled, timed out, or otherwise not completed, finish the work or spin up a new subagent and inform the user
```

## Testing

Run the tests:

```bash
cd /Users/cmiller/Documents/Projects/openclaw_event_server_plugin
python3 -m pytest scripts/test_subagent_completion_notifier.py -v
```

Or with unittest:

```bash
python3 scripts/test_subagent_completion_notifier.py
```

## Manual Testing

Test the script manually with a mock event:

```bash
echo '{"ruleId":"test","event":{"type":"subagent.ended","data":{"parentSessionKey":"test-123","endReason":"completed"}}}' | \
  EVENT_PLUGIN_HMAC_SECRET="test-secret" \
  python3 scripts/subagent_completion_notifier.py
```

## Security Notes

- The script uses HMAC signing for Gateway API requests
- The HMAC secret should be kept secure (use file-based storage in production)
- The `allowedActionDirs` configuration restricts which scripts can be executed
- Script execution has configurable timeouts and payload size limits

## Troubleshooting

### Script not executing

1. Check that `hookBridge.enabled` is `true` in config
2. Verify the script path is in `allowedActionDirs`
3. Ensure the script is executable: `chmod +x subagent_completion_notifier.py`
4. Check the event-server-plugin logs for errors

### HMAC authentication failures

1. Verify the HMAC secret matches the Gateway's configured secret
2. Check that the system clock is synchronized
3. Ensure the secret file (if using) is readable

### Message not delivered to parent session

1. Verify the parent session key is correct in the event
2. Check that the Gateway API is accessible
3. Review the script output for error messages
4. Check Gateway logs for session.send failures
