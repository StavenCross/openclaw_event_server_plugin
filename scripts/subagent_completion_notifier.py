#!/usr/bin/env python3
"""
Subagent Completion Notifier

Hook bridge script that fires on subagent.ended events and injects a message
into the parent agent session to notify them that their subagent has finished.

This solves the problem where subagents sometimes forget to broadcast completion,
leaving parent agents unaware that work is done.

Usage:
    This script is called by the hook bridge with JSON payload on stdin:
    {"ruleId": "...", "event": {...}}
    
    Or run manually for testing:
    python3 subagent_completion_notifier.py --verbose < event.json

Configuration:
    Add to your event-server-plugin config.json hookBridge section:
    
    {
      "hookBridge": {
        "enabled": true,
        "allowedActionDirs": ["/path/to/scripts"],
        "actions": {
          "notify_parent_subagent_done": {
            "type": "local_script",
            "path": "/path/to/subagent_completion_notifier.py",
            "timeoutMs": 10000,
            "maxPayloadBytes": 65536
          }
        },
        "rules": [
          {
            "id": "notify-parent-on-subagent-end",
            "enabled": true,
            "action": "notify_parent_subagent_done",
            "when": {
              "eventType": "subagent.ended"
            }
          }
        ]
      }
    }

Environment Variables:
    OPENCLAW_GATEWAY_URL - Gateway API base URL (default: http://localhost:6254)
    EVENT_PLUGIN_HMAC_SECRET - HMAC secret for API authentication
    EVENT_PLUGIN_HMAC_SECRET_PATH - Path to file containing HMAC secret
"""

import json
import os
import sys
import urllib.request
import urllib.error
import hashlib
import hmac
import time
import logging
import argparse
from typing import Any, Optional


# Constants
DEFAULT_GATEWAY_URL = "http://localhost:6254"
API_TIMEOUT_SECONDS = 10
SUPPORTED_EVENT_TYPES = ("subagent.ended", "subagent_ended")
HMAC_SECRET_PATH_ENV = "EVENT_PLUGIN_HMAC_SECRET_PATH"
HMAC_SECRET_ENV = "EVENT_PLUGIN_HMAC_SECRET"
DEFAULT_HMAC_SECRET_PATH = "~/.event-server/hmac.secret"

# Logging Configuration

def setup_logging(verbose: bool = False) -> logging.Logger:
    """Configure logging for the script."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        stream=sys.stderr
    )
    return logging.getLogger(__name__)


logger = logging.getLogger(__name__)


def read_event_from_stdin() -> dict[str, Any]:
    """Read the hook bridge payload from stdin."""
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            raise ValueError("Empty payload from stdin")
        payload = json.loads(raw)
        return payload
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON from stdin: {e}")


def extract_parent_session_info(event: dict[str, Any]) -> tuple[Optional[str], Optional[str], dict[str, Any]]:
    """
    Extract parent session information from a subagent.ended event.
    
    Returns:
        Tuple of (parent_session_key, parent_agent_id, event_metadata)
    """
    data = event.get("data", {})
    
    # Try multiple field names for parent session key
    parent_session_key = (
        data.get("parentSessionKey")
        or data.get("parentSessionId")
        or event.get("sessionKey")
        or event.get("sessionId")
    )
    
    parent_agent_id = (
        data.get("parentAgentId")
        or event.get("agentId")
    )
    
    # Extract subagent metadata for the notification
    subagent_key = (
        data.get("childSessionKey")
        or data.get("subagentKey")
        or event.get("sessionKey")
    )
    
    end_reason = data.get("endReason", "unknown")
    
    metadata = {
        "subagent_session_key": subagent_key,
        "subagent_agent_id": data.get("childAgentId"),
        "end_reason": end_reason,
        "event_id": event.get("eventId"),
        "event_type": event.get("type"),
        "timestamp": event.get("timestamp"),
    }
    
    return parent_session_key, parent_agent_id, metadata


def build_notification_message(metadata: dict[str, Any]) -> str:
    """Build the notification message to inject into the parent session."""
    subagent_key = metadata.get("subagent_session_key", "unknown")
    end_reason = metadata.get("end_reason", "unknown")
    subagent_agent_id = metadata.get("subagent_agent_id", "unknown")
    
    message = (
        f"🔔 **Subagent Completion Notification**\n\n"
        f"Your subagent has finished running. Please check in on the session.\n\n"
        f"**Details:**\n"
        f"- Subagent Session Key: `{subagent_key}`\n"
        f"- Subagent Agent ID: `{subagent_agent_id}`\n"
        f"- End Reason: `{end_reason}`\n\n"
        f"**Next Steps:**\n"
        f"- If work was completed, inform the user\n"
        f"- If work was stalled, timed out, or otherwise not completed, "
        f"finish the work or spin up a new subagent and inform the user\n"
    )
    
    return message


def get_gateway_api_url() -> str:
    """
    Get the Gateway API base URL from environment or default.
    
    Returns:
        Gateway API base URL
        
    Environment Variables:
        OPENCLAW_GATEWAY_URL: Custom gateway URL (default: http://localhost:6254)
    """
    url = os.environ.get("OPENCLAW_GATEWAY_URL", DEFAULT_GATEWAY_URL)
    logger.debug(f"Gateway URL: {url}")
    return url


def get_hmac_secret() -> Optional[str]:
    """
    Get the HMAC secret for signing requests.
    
    Checks in order of precedence:
    1. EVENT_PLUGIN_HMAC_SECRET_PATH environment variable (file path)
    2. Default location: ~/.event-server/hmac.secret
    3. EVENT_PLUGIN_HMAC_SECRET environment variable (direct value)
    
    Returns:
        HMAC secret string, or None if not configured
        
    Environment Variables:
        EVENT_PLUGIN_HMAC_SECRET_PATH: Path to file containing secret
        EVENT_PLUGIN_HMAC_SECRET: Direct secret value
    """
    # Check environment variable for file path
    secret_path = os.environ.get(HMAC_SECRET_PATH_ENV)
    if secret_path:
        if os.path.exists(secret_path):
            with open(secret_path, "r") as f:
                secret = f.read().strip()
            logger.debug(f"Loaded HMAC secret from path: {secret_path}")
            return secret
        else:
            logger.warning(f"HMAC secret path specified but not found: {secret_path}")
    
    # Check default location
    default_path = os.path.expanduser(DEFAULT_HMAC_SECRET_PATH)
    if os.path.exists(default_path):
        with open(default_path, "r") as f:
            secret = f.read().strip()
        logger.debug(f"Loaded HMAC secret from default path: {default_path}")
        return secret
    
    # Check environment variable for direct value
    secret = os.environ.get(HMAC_SECRET_ENV)
    if secret:
        logger.debug("Loaded HMAC secret from environment variable")
        return secret
    
    logger.warning("HMAC secret not configured")
    return None


def sign_request(method: str, path: str, body: str, secret: str, timestamp: int) -> str:
    """Generate HMAC signature for request."""
    message = f"{method}:{path}:{timestamp}:{body}"
    signature = hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    return signature


def send_message_to_session(
    session_key: str,
    message: str,
    gateway_url: str,
    hmac_secret: str
) -> dict[str, Any]:
    """
    Send a message to a session via the Gateway API.
    
    Uses the sessions.send method to inject a message into the target session.
    
    Args:
        session_key: Target session key to send message to
        message: Message content to send
        gateway_url: Gateway API base URL
        hmac_secret: HMAC secret for request signing
        
    Returns:
        Dict with 'success' boolean and either 'result' or 'error' key
        
    Response Validation:
        Validates that API response contains expected structure.
        Returns error if response format is unexpected.
    """
    path = "/api/gateway"
    url = f"{gateway_url}{path}"
    
    payload = {
        "method": "sessions.send",
        "params": {
            "sessionKey": session_key,
            "message": message,
            "metadata": {
                "source": "subagent_completion_notifier",
                "injected": True
            }
        }
    }
    
    body = json.dumps(payload)
    timestamp = int(time.time())
    signature = sign_request("POST", path, body, hmac_secret, timestamp)
    
    headers = {
        "Content-Type": "application/json",
        "X-OpenClaw-Timestamp": str(timestamp),
        "X-OpenClaw-Signature": f"sha256={signature}",
    }
    
    req = urllib.request.Request(url, data=body.encode("utf-8"), headers=headers, method="POST")
    
    logger.info(f"Sending message to session {session_key[:8]}...")
    logger.debug(f"Gateway URL: {url}")
    logger.debug(f"Request payload: {payload}")
    
    try:
        with urllib.request.urlopen(req, timeout=API_TIMEOUT_SECONDS) as response:
            raw_response = response.read().decode("utf-8")
            logger.debug(f"API response: {raw_response}")
            
            # Validate response structure
            try:
                result = json.loads(raw_response)
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON in API response: {e}")
                return {
                    "success": False,
                    "error": f"Invalid JSON response from API: {str(e)}"
                }
            
            # Basic validation - response should be a dict
            if not isinstance(result, dict):
                logger.error(f"Unexpected response type: {type(result)}")
                return {
                    "success": False,
                    "error": f"Unexpected response format (expected dict, got {type(result).__name__})"
                }
            
            logger.info(f"Message sent successfully to session {session_key[:8]}...")
            return {"success": True, "result": result}
            
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else ""
        logger.error(f"HTTP error {e.code}: {error_body}")
        return {
            "success": False,
            "error": f"HTTP {e.code}: {error_body}",
            "status_code": e.code
        }
    except urllib.error.URLError as e:
        logger.error(f"Connection error: {e.reason}")
        return {"success": False, "error": f"Connection error: {e.reason}"}
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        return {"success": False, "error": f"Unexpected error: {str(e)}"}


def parse_args() -> argparse.Namespace:
    """
    Parse command-line arguments.
    
    Returns:
        Parsed arguments namespace
    """
    parser = argparse.ArgumentParser(
        description="Subagent Completion Notifier - Hook bridge script for subagent completion notifications"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose (debug) logging output"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse event and validate configuration without sending message"
    )
    return parser.parse_args()


def main() -> int:
    """
    Main entry point.
    
    Returns:
        Exit code: 0 for success, 1 for failure
    """
    args = parse_args()
    
    # Setup logging based on verbosity
    global logger
    logger = setup_logging(args.verbose)
    
    logger.info("Subagent Completion Notifier starting")
    
    try:
        # Read event from stdin
        logger.debug("Reading event from stdin")
        payload = read_event_from_stdin()
        rule_id = payload.get("ruleId", "unknown")
        event = payload.get("event", {})
        
        logger.info(f"Processing rule: {rule_id}")
        
        # Validate event type
        event_type = event.get("type", "")
        if event_type not in SUPPORTED_EVENT_TYPES:
            logger.error(f"Invalid event type: {event_type}")
            output = {
                "success": False,
                "error": f"Expected subagent.ended event, got: {event_type}",
                "ruleId": rule_id
            }
            print(json.dumps(output, indent=2), file=sys.stderr)
            return 1
        
        logger.debug(f"Event type validated: {event_type}")
        
        # Extract parent session info
        parent_session_key, parent_agent_id, metadata = extract_parent_session_info(event)
        
        if not parent_session_key:
            logger.error("Could not determine parent session key from event")
            output = {
                "success": False,
                "error": "Could not determine parent session key from event",
                "ruleId": rule_id,
                "event": event
            }
            print(json.dumps(output, indent=2), file=sys.stderr)
            return 1
        
        logger.info(f"Parent session identified: {parent_session_key[:8]}...")
        
        # Build notification message
        message = build_notification_message(metadata)
        logger.debug(f"Notification message built ({len(message)} chars)")
        
        # Get configuration
        gateway_url = get_gateway_api_url()
        hmac_secret = get_hmac_secret()
        
        if not hmac_secret:
            logger.error("HMAC secret not configured")
            output = {
                "success": False,
                "error": "HMAC secret not configured. Set EVENT_PLUGIN_HMAC_SECRET or EVENT_PLUGIN_HMAC_SECRET_PATH",
                "ruleId": rule_id
            }
            print(json.dumps(output, indent=2), file=sys.stderr)
            return 1
        
        # Dry run mode - validate but don't send
        if args.dry_run:
            logger.info("Dry run mode - skipping message send")
            output = {
                "success": True,
                "ruleId": rule_id,
                "parentSessionKey": parent_session_key,
                "parentAgentId": parent_agent_id,
                "metadata": metadata,
                "dry_run": True,
                "message_preview": message[:200] + "..." if len(message) > 200 else message
            }
            print(json.dumps(output, indent=2))
            return 0
        
        # Send message to parent session
        result = send_message_to_session(
            session_key=parent_session_key,
            message=message,
            gateway_url=gateway_url,
            hmac_secret=hmac_secret
        )
        
        # Output result
        output = {
            "success": result.get("success", False),
            "ruleId": rule_id,
            "parentSessionKey": parent_session_key,
            "parentAgentId": parent_agent_id,
            "metadata": metadata,
        }
        
        if result.get("success"):
            output["result"] = result.get("result")
            logger.info("Notification sent successfully")
            print(json.dumps(output, indent=2))
            return 0
        else:
            output["error"] = result.get("error")
            logger.error(f"Failed to send notification: {result.get('error')}")
            print(json.dumps(output, indent=2), file=sys.stderr)
            return 1
            
    except Exception as e:
        logger.exception(f"Unexpected error: {str(e)}")
        error_output = {
            "success": False,
            "error": str(e),
            "type": type(e).__name__
        }
        print(json.dumps(error_output, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
