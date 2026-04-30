# Prizmad MCP Server

Model Context Protocol server for [Prizmad](https://prizmad.com) — generate AI-powered UGC video ads from any product URL. 50+ avatars, ElevenLabs voiceover, 8 caption styles, 9 music styles, 3 CTA styles, 10 image-style presets, and free-text prompt hints across image, video and music.

This server lets AI agents (Claude Desktop, Claude.ai, ChatGPT, Cursor, Zed, Continue, custom MCP clients) drive the full Prizmad studio — pick a template, attach a product URL or images, customise the look, render, and hand back a brand-safe link.

## Two ways to connect

### 1. Remote MCP (preferred — OAuth Connect, no install)

Most modern MCP clients support a **Connect** flow that handles OAuth, Dynamic Client Registration and PKCE for you. Just:

- **Add custom connector → URL: `https://prizmad.com/api/mcp`**

That's it. The browser opens, you sign in to Prizmad, click **Authorize**, and the connector is wired up. Refresh tokens rotate; you don't need to manage keys.

Manual config (Claude Desktop / Cursor / Continue) for clients that need an explicit entry:

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

If your client cannot drive the OAuth flow, you can pre-fill an API key:

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

OAuth discovery: <https://prizmad.com/.well-known/oauth-authorization-server>
Server card: <https://prizmad.com/.well-known/mcp/server-card.json>

### 2. Local stdio bridge (`@prizmad/mcp-server`)

For stdio-only clients or air-gapped environments. Uses an API key — no browser flow.

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

## Authentication options

| Method | When | Get it |
|---|---|---|
| **OAuth 2.1 Authorization Code + PKCE + DCR** | Interactive clients (the **Connect** button) | Automatic — no setup |
| **API key (Bearer)** | Local stdio bridge, scripts, dev | <https://prizmad.com/api-keys> |
| OAuth 2.0 client_credentials | Headless server-to-server (exchanges API key for short-lived JWT) | See [OAuth skill](https://prizmad.com/.well-known/agent-skills/oauth/SKILL.md) |

API video generation requires a **Pro plan**. UI generation works on any plan; the Pro gate exists only on programmatic access.

## Available Tools

| Tool | Auth | Purpose |
|------|:----:|---------|
| `list_templates` | No | Full template catalog with features and token costs |
| `list_avatars` | No | Built-in avatar presets with recommended voices |
| `recommend_template` | No | Pick top-3 templates from intent + voice/avatar/duration/budget constraints. Use this **before** `create_video` instead of guessing from the catalog. |
| `list_my_videos` | Yes | Recent projects with projectUrl / shareUrl / downloadUrl |
| `upload_image` | Yes | Upload an image (URL or base64) → returns prizmad.com-hosted URL for use as productImages or avatar reference |
| `create_video` | Yes | Start a render. Returns `videoId`. Accepts caption/music/CTA/image style presets and free-text prompt hints. |
| `get_video_status` | Yes | Snapshot status by default; with `wait: true` it blocks server-side and streams `notifications/progress` until terminal (up to 10 min) — preferred over polling. |
| `get_download_url` | Yes | Authenticated download URL on prizmad.com for a completed video |
| `create_video_batch` | Yes | Launch up to 20 renders in parallel; pre-checks total token cost |

## Output URLs (what to give the user)

Every status response carries three URL kinds, in priority order:

| Field | Goes to |
|---|---|
| `projectUrl` | `https://prizmad.com/projects/<id>` — owner-only dashboard with player, remix, edit, asset library. **Primary link** when handing the result back to the signed-in user. |
| `shareUrl` | `https://prizmad.com/share/<token>` — public share page. Use **only** when forwarding the video to someone *outside* the account. |
| `downloadUrl` | `https://prizmad.com/api/v1/videos/<id>/download` — authenticated mp4 stream proxied via prizmad.com. |

The raw Vercel Blob URL is **never** surfaced to the agent.

## Customization on `create_video`

All optional. Omit any field for a randomised pick at render time.

### `captionStyle` — on-video subtitles

`classic`, `bold-impact`, `karaoke`, `pop`, `bounce`, `neon`, `typewriter`, `glow`. See the [MCP skill](https://prizmad.com/.well-known/agent-skills/mcp-server/SKILL.md) for visual previews.

### `musicStyle`

`energetic`, `friendly`, `professional`, `luxury`, `funny`, `cinematic`, `lo-fi`, `hip-hop`, `acoustic`.

### `ctaStyle` — end card

`classic`, `blurred-photo`, `dark-solid`.

### `imageStyle` — lighting/palette

`warm-golden`, `bright-neutral`, `cool-diffused`, `window-light`, `earthy-ambient`, `studio-clean`, `moody-dramatic`, `pastel-soft`, `nordic-minimal`, `sunset-warm`.

### Free-text prompt hints (≤ 400 chars each)

`imagePromptHint`, `videoPromptHint`, `musicPromptHint` — layered on top of the corresponding style preset.

## Typical agent flow

```text
recommend_template ─► create_video ─► get_video_status (wait: true) ─► projectUrl + downloadUrl
```

Once connected you can ask your agent things like:

> "Make a 30-second energetic showcase ad for this Amazon product:
> https://amazon.com/dp/B0EXAMPLE — moody-dramatic look, cinematic music."

The agent will:
1. Call `recommend_template` to pick a fitting template.
2. Call `create_video` with the URL + style hints. Returns `videoId`.
3. Call `get_video_status({ videoId, wait: true })` — blocks server-side, streams progress notifications, returns the final payload (3–8 minutes typical).
4. Hand `projectUrl` back so you land on your dashboard with the player, remix and download.

For bulk campaigns use `create_video_batch` (1–20 per request).

## Plan + token rules

- API generation requires a **Pro plan** (`/api/v1/videos` returns 403 with an upgrade message otherwise).
- Tokens come from the user's monthly plan first, then any top-up balance.
- Insufficient balance returns 402 with `required`, `balance`, and `topUpUrl`.
- The MCP layer renders both errors as plain English so the assistant can repeat them verbatim.

## Environment variables (stdio bridge only)

| Variable | Required | Description |
|----------|:--------:|-------------|
| `PRIZMAD_API_KEY` | Yes | Your Prizmad API key |
| `PRIZMAD_BASE_URL` | No | API base URL (default: `https://prizmad.com`) |

## Resources

- [Prizmad](https://prizmad.com) — Main site
- [API documentation](https://prizmad.com/api/docs) — Interactive API docs
- [OpenAPI spec](https://prizmad.com/openapi.json) — Machine-readable spec
- [MCP server card](https://prizmad.com/.well-known/mcp/server-card.json) — Discovery metadata
- [OAuth metadata](https://prizmad.com/.well-known/oauth-authorization-server) — OAuth 2.0 / 2.1 discovery
- [Protected resource metadata](https://prizmad.com/.well-known/oauth-protected-resource) — RFC 9728
- [JWKS](https://prizmad.com/.well-known/jwks.json) — Public keys for verifying RS256 access tokens
- [Agent skills index](https://prizmad.com/.well-known/agent-skills/index.json) — All published skills

## License

MIT
