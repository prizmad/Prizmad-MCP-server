# Prizmad MCP Server

> **Generate AI UGC video ads from any product URL — straight from your AI agent.**

[![npm version](https://img.shields.io/npm/v/@prizmad/mcp-server.svg)](https://www.npmjs.com/package/@prizmad/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Model Context Protocol](https://img.shields.io/badge/Model%20Context%20Protocol-2025--06--18-blue)](https://modelcontextprotocol.io)
[![Smithery](https://img.shields.io/badge/Smithery-Listed-purple)](https://smithery.ai/server/@prizmad/mcp-server)

Model Context Protocol server for [Prizmad](https://prizmad.com). It turns any product URL — Amazon, Shopify, WooCommerce, custom store — into a platform-ready video ad in 3-8 minutes. **50+ avatars, ElevenLabs voiceover, 8 caption styles, 9 music styles, 3 CTA styles, 10 image-style presets, free-text prompt hints across image / video / music.** Output is 9:16 / 1:1 / 16:9 Full HD, ready for **TikTok, Instagram Reels, Facebook Ads, YouTube Shorts, Shopify, Amazon**. Full commercial rights included.

This server is the agent-driver surface — pick a template, attach product images, customise the look, render, and hand back a brand-safe link. Works with **Claude Desktop, Claude.ai, ChatGPT, Cursor, Zed, Continue, n8n, custom MCP SDK clients**.

- **Remote MCP**: `https://prizmad.com/api/mcp`
- **Transport**: streamable-http
- **Auth**: OAuth 2.1 + PKCE + Dynamic Client Registration (the "Connect" button) **OR** API key Bearer **OR** OAuth client_credentials.
- **npm**: `@prizmad/mcp-server`

---

## ⚡ Quickstart — pick your client

### Claude Desktop / Claude.ai / ChatGPT / Cursor / Zed (Connect button)

**Just add a custom connector with this URL** — the OAuth + DCR flow runs automatically, no install, no API key:

```
https://prizmad.com/api/mcp
```

In Claude Desktop: *Settings → Connectors → Add custom connector → URL: `https://prizmad.com/api/mcp`*. The browser opens, you sign in to Prizmad, click *Authorize*, the connector wires itself up.

Manual config when needed:

```json
{
  "mcpServers": {
    "prizmad": {
      "transport": "streamable-http",
      "url": "https://prizmad.com/api/mcp"
    }
  }
}
```

For clients that can't drive OAuth, drop in an API key instead:

```json
{
  "mcpServers": {
    "prizmad": {
      "transport": "streamable-http",
      "url": "https://prizmad.com/api/mcp",
      "headers": { "Authorization": "Bearer przmad_sk_live_..." }
    }
  }
}
```

### stdio bridge (`@prizmad/mcp-server`) — for stdio-only clients

```json
{
  "mcpServers": {
    "prizmad": {
      "command": "npx",
      "args": ["-y", "@prizmad/mcp-server"],
      "env": { "PRIZMAD_API_KEY": "przmad_sk_live_..." }
    }
  }
}
```

Or installed globally:

```bash
npm install -g @prizmad/mcp-server
```

```json
{
  "mcpServers": {
    "prizmad": {
      "command": "prizmad-mcp",
      "env": { "PRIZMAD_API_KEY": "przmad_sk_live_..." }
    }
  }
}
```

### `.cursor/mcp.json` snippet (project-scoped)

```json
{
  "mcpServers": {
    "prizmad": {
      "url": "https://prizmad.com/api/mcp"
    }
  }
}
```

---

## 🛠 Available tools

| Tool | Auth | What it does |
|------|:----:|--------------|
| `list_templates` | No | Full template catalog with features, durations, token costs. |
| `list_avatars` | No | Built-in avatar presets with name, gender, age, recommended voice. |
| `recommend_template` | No | Top-3 template suggestions from intent + voice / avatar / duration / budget constraints. **Use this before `create_video`** instead of guessing from the catalog. |
| `list_my_videos` | Yes | Recent projects with `projectUrl` / `shareUrl` / `downloadUrl`. Find a videoId from a previous session, "remix my last video", etc. |
| `upload_image` | Yes | Upload an image (URL or base64) — returns a prizmad.com-hosted URL ready for `productImages` or `avatarImageUrl`. |
| `create_video` | Yes | Start a render. Returns `videoId`. Accepts caption / music / CTA / image style presets and free-text prompt hints. |
| `get_video_status` | Yes | Snapshot status by default; `wait: true` blocks server-side and emits `notifications/progress` until terminal (up to 10 min) — preferred over polling. |
| `get_download_url` | Yes | Authenticated download URL on prizmad.com for a completed video. |
| `create_video_batch` | Yes | Launch 1-20 renders in parallel. Each item supports the **full** create_video parameter surface — perfect for A/B variant testing. |

## 🎨 Creative customisation on `create_video`

Each is optional; omit any field for a randomised pick at render time.

| Param | Values |
|---|---|
| `captionStyle` | `classic`, `bold-impact`, `karaoke`, `pop`, `bounce`, `neon`, `typewriter`, `glow` |
| `musicStyle` | `energetic`, `friendly`, `professional`, `luxury`, `funny`, `cinematic`, `lo-fi`, `hip-hop`, `acoustic` |
| `ctaStyle` | `classic`, `blurred-photo`, `dark-solid` |
| `imageStyle` | `warm-golden`, `bright-neutral`, `cool-diffused`, `window-light`, `earthy-ambient`, `studio-clean`, `moody-dramatic`, `pastel-soft`, `nordic-minimal`, `sunset-warm` |
| `imagePromptHint` | Free-text steer for AI creatives (≤ 400 chars). |
| `videoPromptHint` | Free-text steer for AI product video clips. |
| `musicPromptHint` | Free-text steer for the music generator. |
| `language`, `tone`, `voiceId`, `avatarPresetId`, `duration`, `script` | Standard. |

## 🔗 Output URLs (what to share with the user)

Every status response carries three URL kinds, in priority order:

| Field | Goes to |
|---|---|
| `projectUrl` | `https://prizmad.com/projects/<id>` — owner-only dashboard with player, remix, edit, asset library. **Primary link** for the signed-in user. |
| `shareUrl` | `https://prizmad.com/share/<token>` — public share page. Use **only** when forwarding outside the account. |
| `downloadUrl` | `https://prizmad.com/api/v1/videos/<id>/download` — authenticated mp4 stream proxied via prizmad.com. |

The raw Vercel Blob URL is **never** surfaced to the agent.

## 🔐 Authentication

| Method | When | Get it |
|---|---|---|
| **OAuth 2.1 Authorization Code + PKCE + DCR** | Interactive clients (Connect button) | Automatic — no setup |
| **API key (Bearer)** | Local stdio bridge, scripts, dev | <https://prizmad.com/api-keys> |
| OAuth 2.0 client_credentials | Headless server-to-server | [oauth skill](https://prizmad.com/.well-known/agent-skills/oauth/SKILL.md) |

API video generation requires a **Pro plan**. UI generation works on any plan; the Pro gate exists only on programmatic access.

## 🧠 Typical agent workflow

```text
recommend_template ─► (optional upload_image) ─► create_video
                                                  └─► get_video_status (wait: true)
                                                           └─► projectUrl + downloadUrl
```

Once connected you can ask your agent things like:

> "Make a 30-second energetic showcase ad for this Amazon product:
> https://amazon.com/dp/B0EXAMPLE — moody-dramatic look, cinematic music."

The agent will pick a template, drop in the URL with the style hints, kick off the render, wait through the live progress notifications, and hand back a `https://prizmad.com/projects/<id>` link.

## 🌐 Discovery & metadata

- **Server card**: <https://prizmad.com/.well-known/mcp/server-card.json>
- **OAuth metadata**: <https://prizmad.com/.well-known/oauth-authorization-server>
- **Protected resource metadata** (RFC 9728): <https://prizmad.com/.well-known/oauth-protected-resource>
- **JWKS**: <https://prizmad.com/.well-known/jwks.json>
- **Agent skills index**: <https://prizmad.com/.well-known/agent-skills/index.json>
- **OpenAPI**: <https://prizmad.com/openapi.json>
- **API catalog (RFC 9727)**: <https://prizmad.com/.well-known/api-catalog>

## 📦 Environment variables (stdio bridge only)

| Variable | Required | Description |
|---|:---:|---|
| `PRIZMAD_API_KEY` | Yes | Your Prizmad API key |
| `PRIZMAD_BASE_URL` | No | API base URL (default `https://prizmad.com`) |

## 📚 Resources

- [Prizmad](https://prizmad.com) — Main site
- [API documentation](https://prizmad.com/api/docs) — Interactive API docs (Scalar)
- [MCP server skill](https://prizmad.com/.well-known/agent-skills/mcp-server/SKILL.md) — full agent-facing reference
- [OAuth skill](https://prizmad.com/.well-known/agent-skills/oauth/SKILL.md) — three auth flows in detail
- [Privacy policy](./PRIVACY.md) · [Security policy](./SECURITY.md)

## 🏷 Topics / categories

`mcp` · `mcp-server` · `model-context-protocol` · `claude` · `chatgpt-apps` · `ai-agents` · `oauth` · `remote-mcp` · `ai-video` · `video-ads` · `ugc-ads` · `ad-creative` · `ai-avatars` · `voiceover` · `elevenlabs` · `tiktok` · `instagram-reels` · `youtube-shorts` · `shopify` · `amazon` · `marketing`

## License

MIT
