#!/usr/bin/env python3
"""
Tests for subagent_completion_notifier.py

Run with: python3 -m pytest scripts/test_subagent_completion_notifier.py -v
"""

import json
import os
import sys
import unittest
import argparse
import logging
from io import StringIO
from unittest.mock import patch, MagicMock
from typing import Any

# Add the scripts directory to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import the module under test
import subagent_completion_notifier as notifier


class TestReadEventFromStdin(unittest.TestCase):
    """Tests for read_event_from_stdin function."""
    
    def test_valid_json_payload(self):
        """Should parse valid JSON from stdin."""
        payload = {"ruleId": "test-rule", "event": {"type": "subagent.ended"}}
        with patch.object(sys, 'stdin', StringIO(json.dumps(payload))):
            result = notifier.read_event_from_stdin()
            self.assertEqual(result["ruleId"], "test-rule")
            self.assertEqual(result["event"]["type"], "subagent.ended")
    
    def test_empty_payload_raises_error(self):
        """Should raise ValueError on empty payload."""
        with patch.object(sys, 'stdin', StringIO("   ")):
            with self.assertRaises(ValueError) as context:
                notifier.read_event_from_stdin()
            self.assertIn("Empty payload", str(context.exception))
    
    def test_invalid_json_raises_error(self):
        """Should raise ValueError on invalid JSON."""
        with patch.object(sys, 'stdin', StringIO("not valid json")):
            with self.assertRaises(ValueError) as context:
                notifier.read_event_from_stdin()
            self.assertIn("Invalid JSON", str(context.exception))


class TestExtractParentSessionInfo(unittest.TestCase):
    """Tests for extract_parent_session_info function."""
    
    def test_extracts_parent_session_key_from_data(self):
        """Should extract parent session key from event data."""
        event = {
            "type": "subagent.ended",
            "data": {
                "parentSessionKey": "parent-session-123",
                "parentAgentId": "parent-agent",
                "childSessionKey": "child-session-456",
                "childAgentId": "child-agent",
                "endReason": "completed"
            }
        }
        parent_key, parent_agent, metadata = notifier.extract_parent_session_info(event)
        self.assertEqual(parent_key, "parent-session-123")
        self.assertEqual(parent_agent, "parent-agent")
        self.assertEqual(metadata["subagent_session_key"], "child-session-456")
        self.assertEqual(metadata["end_reason"], "completed")
    
    def test_falls_back_to_session_key(self):
        """Should fall back to sessionKey if parentSessionKey not present."""
        event = {
            "type": "subagent.ended",
            "sessionKey": "fallback-session",
            "agentId": "fallback-agent",
            "data": {
                "childSessionKey": "child-456"
            }
        }
        parent_key, parent_agent, metadata = notifier.extract_parent_session_info(event)
        self.assertEqual(parent_key, "fallback-session")
        self.assertEqual(parent_agent, "fallback-agent")
    
    def test_handles_missing_fields_gracefully(self):
        """Should handle missing fields without crashing."""
        event = {"type": "subagent.ended", "data": {}}
        parent_key, parent_agent, metadata = notifier.extract_parent_session_info(event)
        self.assertIsNone(parent_key)
        self.assertIsNone(parent_agent)
        self.assertEqual(metadata["end_reason"], "unknown")


class TestBuildNotificationMessage(unittest.TestCase):
    """Tests for build_notification_message function."""
    
    def test_builds_complete_message(self):
        """Should build a complete notification message."""
        metadata = {
            "subagent_session_key": "test-session-123",
            "subagent_agent_id": "test-agent",
            "end_reason": "completed"
        }
        message = notifier.build_notification_message(metadata)
        
        self.assertIn("🔔 **Subagent Completion Notification**", message)
        self.assertIn("`test-session-123`", message)
        self.assertIn("`test-agent`", message)
        self.assertIn("`completed`", message)
        self.assertIn("If work was completed, inform the user", message)
        self.assertIn("If work was stalled, timed out, or otherwise not completed", message)
    
    def test_handles_missing_metadata(self):
        """Should handle missing metadata fields."""
        metadata = {}
        message = notifier.build_notification_message(metadata)
        
        self.assertIn("`unknown`", message)  # Should use "unknown" for missing fields


class TestGetHmacSecret(unittest.TestCase):
    """Tests for get_hmac_secret function."""
    
    def test_from_environment_variable(self):
        """Should read secret from environment variable."""
        with patch.dict(os.environ, {"EVENT_PLUGIN_HMAC_SECRET": "test-secret-123"}):
            secret = notifier.get_hmac_secret()
            self.assertEqual(secret, "test-secret-123")
    
    def test_from_file_path(self):
        """Should read secret from file path."""
        with patch.dict(os.environ, {"EVENT_PLUGIN_HMAC_SECRET_PATH": "/tmp/test-secret"}):
            with patch("os.path.exists", return_value=True):
                with patch("builtins.open", unittest.mock.mock_open(read_data="file-secret-456")):
                    secret = notifier.get_hmac_secret()
                    self.assertEqual(secret, "file-secret-456")
    
    def test_returns_none_when_not_configured(self):
        """Should return None when no secret is configured."""
        with patch.dict(os.environ, {}, clear=True):
            with patch("os.path.exists", return_value=False):
                secret = notifier.get_hmac_secret()
                self.assertIsNone(secret)


class TestSignRequest(unittest.TestCase):
    """Tests for sign_request function."""
    
    def test_generates_valid_signature(self):
        """Should generate a valid HMAC signature."""
        method = "POST"
        path = "/api/gateway"
        body = '{"method": "sessions.send"}'
        secret = "test-secret"
        timestamp = 1234567890
        
        signature = notifier.sign_request(method, path, body, secret, timestamp)
        
        # Signature should be a 64-character hex string (SHA256)
        self.assertEqual(len(signature), 64)
        self.assertTrue(all(c in "0123456789abcdef" for c in signature))
    
    def test_signature_is_deterministic(self):
        """Same input should produce same signature."""
        args = ("POST", "/api", '{"test": true}', "secret", 12345)
        sig1 = notifier.sign_request(*args)
        sig2 = notifier.sign_request(*args)
        self.assertEqual(sig1, sig2)


class TestSendMessageToSession(unittest.TestCase):
    """Tests for send_message_to_session function."""
    
    @patch("urllib.request.urlopen")
    def test_successful_message_send(self, mock_urlopen):
        """Should return success on successful API call."""
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"success": True}).encode("utf-8")
        mock_urlopen.return_value.__enter__ = lambda s: mock_response
        mock_urlopen.return_value.__exit__ = lambda s, *args: None
        
        result = notifier.send_message_to_session(
            session_key="test-session",
            message="Test message",
            gateway_url="http://localhost:6254",
            hmac_secret="test-secret"
        )
        
        self.assertTrue(result["success"])
        self.assertEqual(result["result"], {"success": True})
        
        # Verify the request was made
        mock_urlopen.assert_called_once()
        call_args = mock_urlopen.call_args[0][0]
        self.assertEqual(call_args.method, "POST")
    
    @patch("urllib.request.urlopen")
    def test_handles_http_error(self, mock_urlopen):
        """Should handle HTTP errors gracefully."""
        mock_urlopen.side_effect = Exception("HTTP Error 500")
        
        result = notifier.send_message_to_session(
            session_key="test-session",
            message="Test message",
            gateway_url="http://localhost:6254",
            hmac_secret="test-secret"
        )
        
        self.assertFalse(result["success"])
        self.assertIn("error", result)
    
    @patch("urllib.request.urlopen")
    def test_includes_correct_headers(self, mock_urlopen):
        """Should include authentication headers."""
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({}).encode("utf-8")
        mock_urlopen.return_value.__enter__ = lambda s: mock_response
        mock_urlopen.return_value.__exit__ = lambda s, *args: None
        
        notifier.send_message_to_session(
            session_key="test-session",
            message="Test",
            gateway_url="http://localhost:6254",
            hmac_secret="test-secret"
        )
        
        # Get the request object from the call
        call_args = mock_urlopen.call_args[0][0]
        headers = call_args.headers
        
        # Headers may have different casing depending on urllib version
        content_type_key = next((k for k in headers.keys() if k.lower() == "content-type"), None)
        self.assertIsNotNone(content_type_key)
        self.assertEqual(headers[content_type_key], "application/json")
        
        timestamp_key = next((k for k in headers.keys() if k.lower() == "x-openclaw-timestamp"), None)
        self.assertIsNotNone(timestamp_key)
        
        signature_key = next((k for k in headers.keys() if k.lower() == "x-openclaw-signature"), None)
        self.assertIsNotNone(signature_key)


class TestMain(unittest.TestCase):
    """Tests for main function."""
    
    @patch.object(notifier, 'parse_args')
    @patch.object(sys, 'stdin')
    @patch.object(notifier, 'send_message_to_session')
    def test_successful_flow(self, mock_send, mock_stdin, mock_parse_args):
        """Should complete successfully with valid input."""
        # Mock argument parsing
        mock_parse_args.return_value = argparse.Namespace(verbose=False, dry_run=False)
        
        # Mock stdin
        payload = {
            "ruleId": "test-rule",
            "event": {
                "type": "subagent.ended",
                "data": {
                    "parentSessionKey": "parent-123",
                    "parentAgentId": "parent-agent",
                    "childSessionKey": "child-456",
                    "endReason": "completed"
                }
            }
        }
        mock_stdin.read.return_value = json.dumps(payload)
        
        # Mock successful message send
        mock_send.return_value = {"success": True, "result": {}}
        
        with patch.object(notifier, 'get_hmac_secret', return_value="test-secret"):
            result = notifier.main()
        
        self.assertEqual(result, 0)
        mock_send.assert_called_once()
    
    @patch.object(notifier, 'parse_args')
    @patch.object(sys, 'stdin')
    def test_wrong_event_type(self, mock_stdin, mock_parse_args):
        """Should fail gracefully with wrong event type."""
        # Mock argument parsing
        mock_parse_args.return_value = argparse.Namespace(verbose=False, dry_run=False)
        
        payload = {
            "ruleId": "test-rule",
            "event": {"type": "tool.called"}
        }
        mock_stdin.read.return_value = json.dumps(payload)
        
        with patch.object(notifier, 'get_hmac_secret', return_value="test-secret"):
            result = notifier.main()
        
        self.assertEqual(result, 1)
    
    @patch.object(notifier, 'parse_args')
    @patch.object(sys, 'stdin')
    def test_missing_parent_session_key(self, mock_stdin, mock_parse_args):
        """Should fail when parent session key cannot be determined."""
        # Mock argument parsing
        mock_parse_args.return_value = argparse.Namespace(verbose=False, dry_run=False)
        
        payload = {
            "ruleId": "test-rule",
            "event": {
                "type": "subagent.ended",
                "data": {}
            }
        }
        mock_stdin.read.return_value = json.dumps(payload)
        
        with patch.object(notifier, 'get_hmac_secret', return_value="test-secret"):
            result = notifier.main()
        
        self.assertEqual(result, 1)
    
    @patch.object(notifier, 'parse_args')
    @patch.object(sys, 'stdin')
    def test_missing_hmac_secret(self, mock_stdin, mock_parse_args):
        """Should fail when HMAC secret is not configured."""
        # Mock argument parsing
        mock_parse_args.return_value = argparse.Namespace(verbose=False, dry_run=False)
        
        payload = {
            "ruleId": "test-rule",
            "event": {
                "type": "subagent.ended",
                "data": {"parentSessionKey": "parent-123"}
            }
        }
        mock_stdin.read.return_value = json.dumps(payload)
        
        with patch.object(notifier, 'get_hmac_secret', return_value=None):
            result = notifier.main()
        
        self.assertEqual(result, 1)
    
    @patch.object(notifier, 'parse_args')
    @patch.object(sys, 'stdin')
    def test_dry_run_mode(self, mock_stdin, mock_parse_args):
        """Should validate but not send message in dry-run mode."""
        # Mock argument parsing with dry_run=True
        mock_parse_args.return_value = argparse.Namespace(verbose=False, dry_run=True)
        
        payload = {
            "ruleId": "test-rule",
            "event": {
                "type": "subagent.ended",
                "data": {
                    "parentSessionKey": "parent-123",
                    "parentAgentId": "parent-agent",
                    "childSessionKey": "child-456",
                    "endReason": "completed"
                }
            }
        }
        mock_stdin.read.return_value = json.dumps(payload)
        
        with patch.object(notifier, 'get_hmac_secret', return_value="test-secret"):
            result = notifier.main()
        
        self.assertEqual(result, 0)
        # Verify send_message_to_session was NOT called
        self.assertNotIn('send_message_to_session', [call[0] for call in mock_stdin.method_calls])
    
    @patch.object(notifier, 'parse_args')
    @patch.object(sys, 'stdin')
    @patch.object(notifier, 'send_message_to_session')
    def test_verbose_mode_logging(self, mock_send, mock_stdin, mock_parse_args):
        """Should enable verbose logging in verbose mode."""
        # Mock argument parsing with verbose=True
        mock_parse_args.return_value = argparse.Namespace(verbose=True, dry_run=False)
        
        payload = {
            "ruleId": "test-rule",
            "event": {
                "type": "subagent.ended",
                "data": {
                    "parentSessionKey": "parent-123",
                    "parentAgentId": "parent-agent",
                    "childSessionKey": "child-456",
                    "endReason": "completed"
                }
            }
        }
        mock_stdin.read.return_value = json.dumps(payload)
        mock_send.return_value = {"success": True, "result": {}}
        
        with patch.object(notifier, 'get_hmac_secret', return_value="test-secret"):
            result = notifier.main()
        
        self.assertEqual(result, 0)


class TestIntegration(unittest.TestCase):
    """Integration tests simulating real hook bridge flow."""
    
    @patch.object(notifier, 'parse_args')
    @patch.object(sys, 'stdin')
    @patch.object(notifier, 'send_message_to_session')
    def test_full_subagent_ended_flow(self, mock_send, mock_stdin, mock_parse_args):
        """Test complete flow from event to message injection."""
        # Mock argument parsing
        mock_parse_args.return_value = argparse.Namespace(verbose=False, dry_run=False)
        
        # Simulate a real subagent.ended event
        event = {
            "ruleId": "notify-parent-on-subagent-end",
            "event": {
                "eventId": "evt-123456",
                "type": "subagent.ended",
                "eventCategory": "subagent",
                "eventName": "subagent_ended",
                "source": "plugin-hook",
                "agentId": "child-agent",
                "sessionId": "child-session",
                "sessionKey": "child-session-key",
                "timestamp": "2026-03-14T12:00:00Z",
                "data": {
                    "parentAgentId": "jacob",
                    "parentSessionId": "parent-session-id",
                    "parentSessionKey": "parent-session-key-abc123",
                    "childAgentId": "coder-opus",
                    "childSessionKey": "child-session-key-xyz789",
                    "endReason": "completed"
                }
            }
        }
        
        mock_stdin.read.return_value = json.dumps(event)
        mock_send.return_value = {
            "success": True,
            "result": {"delivered": True}
        }
        
        with patch.object(notifier, 'get_hmac_secret', return_value="test-secret"):
            result = notifier.main()
        
        self.assertEqual(result, 0)
        
        # Verify the message was sent to the correct session
        call_args = mock_send.call_args
        self.assertEqual(call_args[1]["session_key"], "parent-session-key-abc123")
        
        # Verify the message content
        message_sent = call_args[1]["message"]
        self.assertIn("child-session-key-xyz789", message_sent)
        self.assertIn("coder-opus", message_sent)
        self.assertIn("completed", message_sent)


class TestLoggingAndArgs(unittest.TestCase):
    """Tests for logging setup and argument parsing."""
    
    def test_parse_args_default(self):
        """Should parse default arguments correctly."""
        with patch.object(sys, 'argv', ['subagent_completion_notifier.py']):
            args = notifier.parse_args()
            self.assertFalse(args.verbose)
            self.assertFalse(args.dry_run)
    
    def test_parse_args_verbose(self):
        """Should parse --verbose flag correctly."""
        with patch.object(sys, 'argv', ['subagent_completion_notifier.py', '--verbose']):
            args = notifier.parse_args()
            self.assertTrue(args.verbose)
            self.assertFalse(args.dry_run)
    
    def test_parse_args_short_verbose(self):
        """Should parse -v flag correctly."""
        with patch.object(sys, 'argv', ['subagent_completion_notifier.py', '-v']):
            args = notifier.parse_args()
            self.assertTrue(args.verbose)
            self.assertFalse(args.dry_run)
    
    def test_parse_args_dry_run(self):
        """Should parse --dry-run flag correctly."""
        with patch.object(sys, 'argv', ['subagent_completion_notifier.py', '--dry-run']):
            args = notifier.parse_args()
            self.assertFalse(args.verbose)
            self.assertTrue(args.dry_run)
    
    def test_parse_args_combined(self):
        """Should parse combined flags correctly."""
        with patch.object(sys, 'argv', ['subagent_completion_notifier.py', '-v', '--dry-run']):
            args = notifier.parse_args()
            self.assertTrue(args.verbose)
            self.assertTrue(args.dry_run)
    
    @patch('logging.basicConfig')
    def test_setup_logging_info_level(self, mock_basic_config):
        """Should setup logging at INFO level by default."""
        test_logger = notifier.setup_logging(verbose=False)
        mock_basic_config.assert_called_once()
        call_kwargs = mock_basic_config.call_args[1]
        self.assertEqual(call_kwargs['level'], logging.INFO)
    
    @patch('logging.basicConfig')
    def test_setup_logging_debug_level(self, mock_basic_config):
        """Should setup logging at DEBUG level when verbose."""
        test_logger = notifier.setup_logging(verbose=True)
        mock_basic_config.assert_called_once()
        call_kwargs = mock_basic_config.call_args[1]
        self.assertEqual(call_kwargs['level'], logging.DEBUG)


class TestGatewayUrlConfig(unittest.TestCase):
    """Tests for gateway URL configuration."""
    
    def test_get_gateway_url_default(self):
        """Should return default URL when not configured."""
        with patch.dict(os.environ, {}, clear=True):
            url = notifier.get_gateway_api_url()
            self.assertEqual(url, notifier.DEFAULT_GATEWAY_URL)
    
    def test_get_gateway_url_from_env(self):
        """Should read URL from environment variable."""
        custom_url = "http://custom-host:9999"
        with patch.dict(os.environ, {"OPENCLAW_GATEWAY_URL": custom_url}):
            url = notifier.get_gateway_api_url()
            self.assertEqual(url, custom_url)


class TestResponseValidation(unittest.TestCase):
    """Tests for API response validation."""
    
    @patch("urllib.request.urlopen")
    def test_validates_json_response(self, mock_urlopen):
        """Should handle invalid JSON response gracefully."""
        mock_response = MagicMock()
        mock_response.read.return_value = b"not valid json"
        mock_urlopen.return_value.__enter__ = lambda s: mock_response
        mock_urlopen.return_value.__exit__ = lambda s, *args: None
        
        result = notifier.send_message_to_session(
            session_key="test-session",
            message="Test",
            gateway_url="http://localhost:6254",
            hmac_secret="test-secret"
        )
        
        self.assertFalse(result["success"])
        self.assertIn("Invalid JSON", result["error"])
    
    @patch("urllib.request.urlopen")
    def test_validates_response_type(self, mock_urlopen):
        """Should handle non-dict response gracefully."""
        mock_response = MagicMock()
        mock_response.read.return_value = b'"just a string"'
        mock_urlopen.return_value.__enter__ = lambda s: mock_response
        mock_urlopen.return_value.__exit__ = lambda s, *args: None
        
        result = notifier.send_message_to_session(
            session_key="test-session",
            message="Test",
            gateway_url="http://localhost:6254",
            hmac_secret="test-secret"
        )
        
        self.assertFalse(result["success"])
        self.assertIn("Unexpected response format", result["error"])
    
    @patch("urllib.request.urlopen")
    def test_accepts_valid_dict_response(self, mock_urlopen):
        """Should accept valid dict response."""
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"success": True}).encode("utf-8")
        mock_urlopen.return_value.__enter__ = lambda s: mock_response
        mock_urlopen.return_value.__exit__ = lambda s, *args: None
        
        result = notifier.send_message_to_session(
            session_key="test-session",
            message="Test",
            gateway_url="http://localhost:6254",
            hmac_secret="test-secret"
        )
        
        self.assertTrue(result["success"])


class TestConstants(unittest.TestCase):
    """Tests to verify constants are properly defined."""
    
    def test_default_gateway_url_defined(self):
        """Should have default gateway URL constant."""
        self.assertEqual(notifier.DEFAULT_GATEWAY_URL, "http://localhost:6254")
    
    def test_api_timeout_seconds_defined(self):
        """Should have API timeout constant."""
        self.assertEqual(notifier.API_TIMEOUT_SECONDS, 10)
    
    def test_supported_event_types_defined(self):
        """Should have supported event types constant."""
        self.assertIn("subagent.ended", notifier.SUPPORTED_EVENT_TYPES)
        self.assertIn("subagent_ended", notifier.SUPPORTED_EVENT_TYPES)
    
    def test_hmac_secret_paths_defined(self):
        """Should have HMAC secret path constants."""
        self.assertEqual(notifier.HMAC_SECRET_PATH_ENV, "EVENT_PLUGIN_HMAC_SECRET_PATH")
        self.assertEqual(notifier.HMAC_SECRET_ENV, "EVENT_PLUGIN_HMAC_SECRET")


if __name__ == "__main__":
    unittest.main()
