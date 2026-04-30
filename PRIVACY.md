# Privacy Policy

The Prizmad MCP server is the agent-facing surface of [prizmad.com](https://prizmad.com). All data handling — accounts, tokens, generated assets, billing — is governed by the canonical Prizmad Privacy Policy:

**<https://prizmad.com/privacy>**

## What this server processes

- **Bearer credentials** (OAuth 2.1 access token or `przmad_sk_live_…` API key) — used only to authenticate the request against the Prizmad backend; not logged in plaintext.
- **Product URLs / titles / descriptions / images** you (or an agent on your behalf) pass to `create_video` — passed to the Prizmad video pipeline, stored on your account, used to render the requested video.
- **Generated artifacts** (videos, thumbnails, intermediate images / audio) — stored under your account on Prizmad's storage; access is gated to you and downstream agents holding a valid token.
- **Optional uploaded images** via `upload_image` — re-encoded to WebP, hosted on prizmad.com, scoped to your account.

## What this server does NOT do

- We do not sell, share or train models on user-submitted content beyond what is required to render the video the user explicitly requested.
- The MCP transport itself is stateless — no conversation history is logged on this endpoint.

## Data retention, deletion, contact

See <https://prizmad.com/privacy> for retention windows, deletion procedures, GDPR / CCPA rights, and the contact email for privacy requests.

For security reports, see [SECURITY.md](./SECURITY.md).
