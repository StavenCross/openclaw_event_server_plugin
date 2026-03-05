# Tool Guard Bundles (Examples)

These examples are intended as copy/paste starters for real deployments.

How to use this folder:
- Use `.json` files directly in config fragments (strict JSON, no comments).
- Use `.annotated.jsonc` files to understand intent and tune policy choices.
- Use scripts in `scripts/` as action handlers for `local_script` actions.

Recommended workflow:
1. Pick the closest bundle.
2. Read the matching `.annotated.jsonc` file.
3. Replace placeholder paths/channels/accounts/user IDs.
4. Replay with `npm run toolguard:replay` before enabling in production.

Files in this folder:
- `network-egress.json`: block unsafe `web_browse` URL patterns.
- `shell-guard.json`: static guardrails for `exec` commands.
- `sudo-slack-approval-allow.json`: notify Slack on `sudo`, then allow.
- `web-browse-human-approval.json`: strict human approval for web tools (`web_search`, `web_fetch`, `browser`).
- `toolguard-approval-profiles.example.json`: optional destination/approver profile file for scripts.

Script notes:
- `sudo-slack-approval-and-allow.sh` is fail-open (notification only).
- `web-browse-slack-human-approval.sh` is interactive and supports strict blocking/approval.
- `run-live-web-browse-approval-replay.sh` is a fast end-to-end replay harness.

Important:
- Keep secrets (tokens, app credentials) out of committed files.
- Prefer explicit approver allowlists (`allowedUserIds`) for production.
