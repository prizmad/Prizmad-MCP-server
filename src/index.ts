#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE_URL = process.env.PRIZMAD_BASE_URL ?? "https://prizmad.com";
const API_KEY = process.env.PRIZMAD_API_KEY ?? "";

if (!API_KEY) {
  console.error(
    "Error: PRIZMAD_API_KEY environment variable is required.\n" +
      "Get your API key at https://prizmad.com/api-keys"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function api(
  path: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) ?? {}),
    },
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // empty / non-JSON body — fall through
  }
  return { ok: res.ok, status: res.status, data };
}

function textResult(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

function errorText(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function formatVideoCreateError(
  status: number,
  data: unknown
): string {
  const d = (data ?? {}) as Record<string, unknown>;
  if (status === 403 && /pro plan/i.test(String(d?.error ?? ""))) {
    return [
      "Your Prizmad account isn't on the Pro plan, so the API can't create",
      "videos for you yet. Upgrade to Pro to unlock API generation:",
      "https://prizmad.com/pricing",
    ].join(" ");
  }
  if (status === 402 || /insufficient balance/i.test(String(d?.error ?? ""))) {
    const required = typeof d?.required === "number" ? d.required : null;
    const balance = typeof d?.balance === "number" ? d.balance : null;
    if (required !== null && balance !== null) {
      return [
        `You don't have enough Prizmad tokens for this video — it needs ${required}`,
        `tokens but your balance is ${balance}. Top up without changing your plan:`,
        "https://prizmad.com/top-up",
      ].join(" ");
    }
    return [
      "You don't have enough Prizmad tokens for this video. Top up without",
      "changing your plan: https://prizmad.com/top-up",
    ].join(" ");
  }
  const msg = d?.error ?? d?.message;
  if (typeof msg === "string" && msg.length > 0) {
    return `Error ${status}: ${msg}`;
  }
  return `Error ${status}: ${JSON.stringify(data)}`;
}

function sanitizeStatusForAgent(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const src = data as Record<string, unknown>;
  // Strip raw Blob URLs from anything we hand back to the assistant —
  // shareUrl / projectUrl / downloadUrl are the canonical prizmad.com
  // links for sharing, viewing and downloading.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { videoUrl: _videoUrl, thumbnailUrl: _thumbnailUrl, ...rest } = src;
  const status = typeof src.status === "string" ? src.status : null;
  if (status === "generating" || status === "parsed") {
    return {
      ...rest,
      pollIntervalSeconds: 60,
      hint:
        "Video is still rendering. Wait 60 seconds before calling get_video_status again — total generation time is typically 3-8 minutes.",
    };
  }
  if (status === "completed") {
    return {
      ...rest,
      hint:
        "Video is ready. Hand `projectUrl` to the user — it opens the project page in their Prizmad dashboard with full remix/edit/download controls (works because they're already signed in). Use `shareUrl` only if they want to forward the video to someone *outside* their account, and `downloadUrl` for the authenticated mp4 stream.",
    };
  }
  return rest;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
const server = new McpServer(
  {
    name: "prizmad",
    version: "2.0.0",
  },
  {
    instructions: [
      "Prizmad is an AI UGC video ad generator. With this server you can:",
      "1. Suggest a template — use `recommend_template` with the user's intent and any voice/avatar/budget constraints. Avoid guessing from `list_templates` unless the user wants to browse the full catalog.",
      "2. Prepare assets — `upload_image` accepts a URL or base64 blob and returns a prizmad.com-hosted URL you can pass into productImages or avatarImageUrl on create_video.",
      "3. Generate the video — `create_video` returns immediately with a videoId. Then call `get_video_status` with `wait: true` so the server blocks until the render is done and streams progress notifications instead of you polling.",
      "4. Hand the result to the user — `projectUrl` is the dashboard page (full remix/edit/download for the signed-in owner — this is the link to share with the user themselves). Use `shareUrl` only when forwarding the video to someone *outside* the account, and `downloadUrl` (prizmad.com authenticated mp4 stream) for direct download. Never share the raw storage URL.",
      "Use `list_my_videos` to recall the user's recent generations (e.g. for 'remix my last video').",
      "Plan + token rules: API video generation requires a Pro subscription; tokens come from the user's plan first, then top-up balance. If the call fails with a plan/balance error, the message itself is already user-friendly — just relay it.",
    ].join("\n"),
  }
);

// ── list_templates ──────────────────────────────────────────────────────────
server.tool(
  "list_templates",
  "List all available video ad templates with features, durations, and token costs. No API key required for this call.",
  {},
  { title: "List Templates", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async () => {
    const { ok, status, data } = await api("/api/v1/templates");
    return ok
      ? textResult(data)
      : errorText(`Error ${status}: ${JSON.stringify(data)}`);
  }
);

// ── list_avatars ────────────────────────────────────────────────────────────
server.tool(
  "list_avatars",
  "List all AI avatar presets with name, gender, age, image URL, and recommended voice ID. No API key required for this call.",
  {},
  { title: "List Avatars", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async () => {
    const { ok, status, data } = await api("/api/v1/avatars");
    return ok
      ? textResult(data)
      : errorText(`Error ${status}: ${JSON.stringify(data)}`);
  }
);

// ── recommend_template ──────────────────────────────────────────────────────
server.tool(
  "recommend_template",
  "Suggest the top 3 video templates for the caller's intent. Filters by feature requirements (voiceover/avatar) and budget; returns templates ranked by suitability with token cost, supported features, and a one-line rationale. Use this before create_video when the agent needs to pick a template — far better than guessing from list_templates.",
  {
    intent: z
      .string()
      .max(300)
      .optional()
      .describe(
        "What the user wants — e.g. 'product launch ad for skincare', 'fast Reels short with text overlays', 'CEO talking-head pitch'."
      ),
    hasVoiceover: z
      .boolean()
      .optional()
      .describe(
        "Require a voiceover. Set false to filter to silent visual templates."
      ),
    hasAvatar: z
      .boolean()
      .optional()
      .describe(
        "Require an AI avatar. Set false for voiceover-only or pure visual templates."
      ),
    targetDurationSec: z
      .number()
      .int()
      .min(5)
      .max(120)
      .optional()
      .describe(
        "Target final video length in seconds. Templates whose duration window does not include this value are excluded."
      ),
    maxTokens: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Cap on token cost. Templates more expensive than this are filtered out."
      ),
  },
  { title: "Recommend Template", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async (params) => {
    const { ok, status, data } = await api("/api/v1/templates");
    if (!ok)
      return errorText(`Error ${status}: ${JSON.stringify(data)}`);
    type Tpl = {
      id: string;
      name: string;
      description: string;
      category: string;
      cost: number;
      features: string[];
      requires?: { avatar?: boolean; voice?: boolean };
      fixedDuration?: number | null;
      flexibleDurationRange?: { minSec: number; maxSec: number } | null;
    };
    const templates: Tpl[] =
      ((data as { templates?: Tpl[] })?.templates ?? []) as Tpl[];
    const fits = (t: Tpl): boolean => {
      if (params.hasVoiceover === true && !t.requires?.voice) return false;
      if (params.hasVoiceover === false && t.requires?.voice) return false;
      if (params.hasAvatar === true && !t.requires?.avatar) return false;
      if (params.hasAvatar === false && t.requires?.avatar) return false;
      if (params.maxTokens !== undefined && t.cost > params.maxTokens)
        return false;
      if (params.targetDurationSec !== undefined) {
        const target = params.targetDurationSec;
        if (typeof t.fixedDuration === "number") {
          if (Math.abs(t.fixedDuration - target) > 5) return false;
        } else if (
          t.flexibleDurationRange &&
          typeof t.flexibleDurationRange.minSec === "number" &&
          typeof t.flexibleDurationRange.maxSec === "number"
        ) {
          if (
            target < t.flexibleDurationRange.minSec ||
            target > t.flexibleDurationRange.maxSec
          )
            return false;
        }
      }
      return true;
    };
    const intentTokens = (params.intent ?? "")
      .toLowerCase()
      .split(/\W+/)
      .filter((s) => s.length > 2);
    const score = (t: Tpl): number => {
      let s = 0;
      const haystack = `${t.name} ${t.description} ${t.category}`.toLowerCase();
      for (const tok of intentTokens) if (haystack.includes(tok)) s += 5;
      s += t.features.length;
      s -= t.cost * 0.1;
      return s;
    };
    const candidates = templates.filter(fits);
    candidates.sort((a, b) => score(b) - score(a));
    const top = candidates.slice(0, 3).map((t) => ({
      templateId: t.id,
      name: t.name,
      description: t.description,
      tokenCost: t.cost,
      features: t.features,
      requires: t.requires ?? {},
      duration:
        typeof t.fixedDuration === "number"
          ? { fixedSec: t.fixedDuration }
          : t.flexibleDurationRange
            ? { rangeSec: t.flexibleDurationRange }
            : null,
    }));
    if (top.length === 0) {
      return errorText(
        "No templates matched those constraints. Try relaxing hasAvatar / hasVoiceover / targetDurationSec, or call list_templates for the full catalog."
      );
    }
    return textResult({
      recommendations: top,
      hint: "Pass the chosen `templateId` to create_video.",
    });
  }
);

// ── list_my_videos ──────────────────────────────────────────────────────────
server.tool(
  "list_my_videos",
  "Return the caller's recent video projects (most recent first). Useful for 'show me what I've made', 'remix my last video', or to find a videoId from a previous session. Each item carries projectUrl / shareUrl / downloadUrl when the video is completed — never the raw storage URL.",
  {
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(20)
      .describe("Maximum number of videos to return (1-50, default 20)"),
    status: z
      .enum(["parsed", "generating", "completed", "failed"])
      .optional()
      .describe("Optional status filter."),
  },
  { title: "List My Videos", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async ({ limit, status }) => {
    const qs = new URLSearchParams();
    if (limit) qs.set("limit", String(limit));
    if (status) qs.set("status", status);
    const { ok, status: httpStatus, data } = await api(
      `/api/v1/videos?${qs.toString()}`
    );
    return ok
      ? textResult(data)
      : errorText(`Error ${httpStatus}: ${JSON.stringify(data)}`);
  }
);

// ── upload_image ────────────────────────────────────────────────────────────
server.tool(
  "upload_image",
  "Upload an image to Prizmad and get back a prizmad.com-hosted URL the caller can plug into productImages or avatarImageUrl. Accepts either a public image URL we can fetch, or a base64-encoded blob (with optional `mimeType`). The image is auto-rotated, resized to fit a 2048×2048 box, and re-encoded as WebP — the original format does not need to be WebP. Max 20 MB.",
  {
    imageUrl: z
      .string()
      .url()
      .optional()
      .describe(
        "Publicly fetchable https/http URL of the image. Either imageUrl or base64Data is required."
      ),
    base64Data: z
      .string()
      .optional()
      .describe(
        "Base64-encoded image bytes (with or without a `data:image/...;base64,` prefix). Either imageUrl or base64Data is required."
      ),
    mimeType: z
      .enum([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/avif",
        "image/gif",
      ])
      .optional()
      .describe(
        "MIME type for base64Data. Ignored when imageUrl is provided. Defaults to inference from the data URL prefix."
      ),
  },
  { title: "Upload Image", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async (params) => {
    if (!params.imageUrl && !params.base64Data) {
      return errorText("Provide either imageUrl or base64Data.");
    }
    const { ok, status, data } = await api("/api/v1/upload-from-url", {
      method: "POST",
      body: JSON.stringify({
        imageUrl: params.imageUrl,
        base64Data: params.base64Data,
        mimeType: params.mimeType,
      }),
    });
    if (!ok) {
      const d = (data ?? {}) as Record<string, unknown>;
      return errorText(
        `Error ${status}: ${typeof d.error === "string" ? d.error : JSON.stringify(data)}`
      );
    }
    const d = data as { url?: string };
    return textResult({
      url: d?.url,
      hint: "Pass this URL into productImages or avatarImageUrl on create_video.",
    });
  }
);

// ── create_video ────────────────────────────────────────────────────────────
server.tool(
  "create_video",
  "Start generating an AI video ad. Provide a template ID and product data (URL to scrape OR direct product info). Returns a video ID for polling. Costs tokens. Generation typically takes 3-8 minutes — call get_video_status with wait:true to receive live progress, or poll no more than once per 60 seconds.",
  {
    templateId: z.string().describe("Template ID from list_templates"),
    productUrl: z
      .string()
      .url()
      .optional()
      .describe(
        "Product page URL to scrape (provide this OR product fields)"
      ),
    productTitle: z
      .string()
      .optional()
      .describe("Product title (if not using productUrl)"),
    productDescription: z
      .string()
      .optional()
      .describe("Product description (if not using productUrl)"),
    productPrice: z.string().optional().describe("Product price"),
    productImages: z
      .array(z.string().url())
      .optional()
      .describe(
        "Product image URLs (use upload_image first if you have raw bytes)"
      ),
    language: z
      .string()
      .optional()
      .default("en")
      .describe("Language code: en, es, fr, de, ru, etc."),
    tone: z
      .enum(["energetic", "professional", "friendly", "luxury", "funny"])
      .optional()
      .default("professional"),
    script: z
      .string()
      .optional()
      .describe("Custom voiceover script. If omitted, AI generates one."),
    avatarPresetId: z
      .string()
      .optional()
      .describe("Avatar ID from list_avatars (e.g. 'F01', 'M04')"),
    voiceId: z
      .string()
      .optional()
      .describe("ElevenLabs voice ID. If omitted, uses avatar default."),
    duration: z
      .number()
      .int()
      .min(10)
      .max(60)
      .optional()
      .default(30)
      .describe("Video duration in seconds (10-60)"),
    captionStyle: z
      .enum([
        "classic",
        "bold-impact",
        "karaoke",
        "pop",
        "bounce",
        "neon",
        "typewriter",
        "glow",
      ])
      .optional()
      .describe(
        "Visual style for on-video subtitles. Omit for a random pick at render time."
      ),
    musicStyle: z
      .enum([
        "energetic",
        "friendly",
        "professional",
        "luxury",
        "funny",
        "cinematic",
        "lo-fi",
        "hip-hop",
        "acoustic",
      ])
      .optional()
      .describe(
        "Background music style. Omit for a random pick at render time."
      ),
    ctaStyle: z
      .enum(["classic", "blurred-photo", "dark-solid"])
      .optional()
      .describe(
        "End-card visual style. classic = green LINK BELOW pill, blurred-photo = first creative blurred behind minimal text, dark-solid = solid dark backdrop with minimal text. Omit for a random pick at render time."
      ),
    imageStyle: z
      .enum([
        "warm-golden",
        "bright-neutral",
        "cool-diffused",
        "window-light",
        "earthy-ambient",
        "studio-clean",
        "moody-dramatic",
        "pastel-soft",
        "nordic-minimal",
        "sunset-warm",
      ])
      .optional()
      .describe(
        "Lighting/colour preset for AI-generated product creatives. Omit for random."
      ),
    imagePromptHint: z
      .string()
      .max(400)
      .optional()
      .describe(
        "Free-text hint to steer the look of AI-generated product creatives — e.g. 'product on rocky beach at sunset', 'minimalist tabletop with marble surface'. Layered on top of imageStyle."
      ),
    videoPromptHint: z
      .string()
      .max(400)
      .optional()
      .describe(
        "Free-text hint to steer the look of AI-generated product video clips. Only used by templates with a product video step."
      ),
    musicPromptHint: z
      .string()
      .max(400)
      .optional()
      .describe(
        "Free-text hint for the music generator — e.g. 'epic cinematic trailer at 110 bpm', 'lo-fi beats with vinyl crackle'. Layered on top of musicStyle."
      ),
  },
  { title: "Create Video", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async (params) => {
    const body: Record<string, unknown> = {
      templateId: params.templateId,
      language: params.language,
      tone: params.tone,
      duration: params.duration,
    };

    if (params.productUrl) {
      body.productUrl = params.productUrl;
    } else if (params.productTitle) {
      body.product = {
        title: params.productTitle,
        description: params.productDescription ?? "",
        price: params.productPrice,
        images: params.productImages,
      };
    }

    if (params.script) body.script = params.script;
    if (params.avatarPresetId) body.avatarPresetId = params.avatarPresetId;
    if (params.voiceId) body.voiceId = params.voiceId;
    if (params.captionStyle) body.captionStyle = params.captionStyle;
    if (params.musicStyle) body.musicTone = params.musicStyle;
    if (params.ctaStyle) body.ctaStyle = params.ctaStyle;
    if (params.imageStyle) body.imageStyle = params.imageStyle;
    if (params.imagePromptHint) body.imagePromptHint = params.imagePromptHint;
    if (params.videoPromptHint) body.videoPromptHint = params.videoPromptHint;
    if (params.musicPromptHint) body.musicPromptHint = params.musicPromptHint;

    const { ok, status, data } = await api("/api/v1/videos", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!ok) return errorText(formatVideoCreateError(status, data));

    return textResult({
      ...(data as object),
      hint:
        "Generation typically takes 3-8 minutes. Call get_video_status with wait:true to receive live progress notifications, or poll no sooner than 60 seconds and at least 60 seconds between polls until status is 'completed' or 'failed'.",
    });
  }
);

// ── get_video_status ────────────────────────────────────────────────────────
server.tool(
  "get_video_status",
  "Check video generation progress. By default returns the current snapshot. Pass `wait: true` to block server-side and receive progress notifications until status is completed/failed (up to 10 min) — preferred for agent flows since it removes the need to poll.",
  {
    videoId: z.string().uuid().describe("Video ID from create_video"),
    wait: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When true, block until status is `completed` or `failed`. The server emits notifications/progress while waiting."
      ),
  },
  { title: "Get Video Status", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async ({ videoId, wait }, extra) => {
    if (!wait) {
      const { ok, status, data } = await api(`/api/v1/videos/${videoId}`);
      if (!ok)
        return errorText(`Error ${status}: ${JSON.stringify(data)}`);
      return textResult(sanitizeStatusForAgent(data));
    }

    type ExtraWithProgress = {
      _meta?: { progressToken?: string | number };
      sendNotification?: (notification: {
        method: string;
        params: unknown;
      }) => Promise<void>;
      signal?: AbortSignal;
    };
    const ext = (extra ?? {}) as ExtraWithProgress;
    const progressToken = ext._meta?.progressToken;
    const sendProgress = async (
      progress: number,
      message: string
    ): Promise<void> => {
      if (progressToken === undefined || !ext.sendNotification) return;
      try {
        await ext.sendNotification({
          method: "notifications/progress",
          params: { progressToken, progress, total: 100, message },
        });
      } catch {
        // best-effort
      }
    };

    const POLL_INTERVAL_MS = 5000;
    const MAX_WAIT_MS = 10 * 60 * 1000;
    const deadline = Date.now() + MAX_WAIT_MS;
    let lastProgress = -1;
    let lastSnapshot: unknown = null;

    while (Date.now() < deadline) {
      if (ext.signal?.aborted) break;
      const { ok, status, data } = await api(`/api/v1/videos/${videoId}`);
      if (!ok)
        return errorText(`Error ${status}: ${JSON.stringify(data)}`);
      lastSnapshot = data;
      const d = data as Record<string, unknown>;
      const projectStatus =
        typeof d.status === "string" ? (d.status as string) : undefined;
      const progress = typeof d.progress === "number" ? d.progress : 0;
      if (progress !== lastProgress) {
        const stepsArr = (d.steps ?? []) as Array<{
          step: string;
          status: string;
        }>;
        const inFlight = stepsArr.find((s) => s.status === "running");
        const message = inFlight
          ? `Rendering — ${inFlight.step.replace(/_/g, " ")} (${progress}%)`
          : `Rendering — ${progress}%`;
        await sendProgress(progress, message);
        lastProgress = progress;
      }
      if (projectStatus === "completed" || projectStatus === "failed") break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    return textResult(sanitizeStatusForAgent(lastSnapshot));
  }
);

// ── get_download_url ────────────────────────────────────────────────────────
server.tool(
  "get_download_url",
  "Get the prizmad.com-hosted download URL for a completed video. Only works when status is 'completed'.",
  {
    videoId: z.string().uuid().describe("Video ID"),
  },
  { title: "Get Download URL", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async ({ videoId }) => {
    const { ok, status, data } = await api(`/api/v1/videos/${videoId}`);
    if (!ok) return errorText(`Error ${status}: ${JSON.stringify(data)}`);
    const d = data as Record<string, unknown>;
    if (d.status !== "completed") {
      return errorText(
        `Video not ready yet. Current status: ${d.status}, progress: ${d.progress}%`
      );
    }
    return textResult({
      videoId: d.videoId,
      // projectUrl is the dashboard page (owner-only, has edit/remix).
      // shareUrl is the public share page — useful only if the owner
      // forwards the link. downloadUrl is the prizmad.com mp4 proxy.
      // The raw Blob URL is never surfaced.
      projectUrl: d.projectUrl,
      shareUrl: d.shareUrl,
      downloadUrl:
        (d.downloadUrl as string | undefined) ??
        `${BASE_URL}/api/v1/videos/${videoId}/download`,
    });
  }
);

// ── create_video_batch ──────────────────────────────────────────────────────
server.tool(
  "create_video_batch",
  "Launch up to 20 video generations in parallel. Pre-checks total token cost. Returns individual video IDs for polling.",
  {
    videos: z
      .array(
        z.object({
          templateId: z.string(),
          productUrl: z.string().url().optional(),
          productTitle: z.string().optional(),
          productDescription: z.string().optional(),
          productImages: z.array(z.string().url()).optional(),
          language: z.string().optional().default("en"),
          tone: z
            .enum(["energetic", "professional", "friendly", "luxury", "funny"])
            .optional()
            .default("professional"),
          avatarPresetId: z.string().optional(),
          voiceId: z.string().optional(),
          duration: z.number().int().min(10).max(60).optional(),
          captionStyle: z
            .enum([
              "classic",
              "bold-impact",
              "karaoke",
              "pop",
              "bounce",
              "neon",
              "typewriter",
              "glow",
            ])
            .optional(),
          musicStyle: z
            .enum([
              "energetic",
              "friendly",
              "professional",
              "luxury",
              "funny",
              "cinematic",
              "lo-fi",
              "hip-hop",
              "acoustic",
            ])
            .optional(),
          ctaStyle: z
            .enum(["classic", "blurred-photo", "dark-solid"])
            .optional(),
          imageStyle: z
            .enum([
              "warm-golden",
              "bright-neutral",
              "cool-diffused",
              "window-light",
              "earthy-ambient",
              "studio-clean",
              "moody-dramatic",
              "pastel-soft",
              "nordic-minimal",
              "sunset-warm",
            ])
            .optional(),
          imagePromptHint: z.string().max(400).optional(),
          videoPromptHint: z.string().max(400).optional(),
          musicPromptHint: z.string().max(400).optional(),
        })
      )
      .min(1)
      .max(20)
      .describe("Array of video creation requests (1-20)"),
    callbackUrl: z
      .string()
      .url()
      .optional()
      .describe("Webhook URL for completion notifications"),
  },
  { title: "Create Video Batch", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async ({ videos, callbackUrl }) => {
    const body = {
      videos: videos.map((v) => {
        const item: Record<string, unknown> = {
          templateId: v.templateId,
          language: v.language,
          tone: v.tone,
          duration: v.duration,
        };
        if (v.productUrl) {
          item.productUrl = v.productUrl;
        } else if (v.productTitle) {
          item.product = {
            title: v.productTitle,
            description: v.productDescription ?? "",
            images: v.productImages,
          };
        }
        if (v.avatarPresetId) item.avatarPresetId = v.avatarPresetId;
        if (v.voiceId) item.voiceId = v.voiceId;
        if (v.captionStyle) item.captionStyle = v.captionStyle;
        if (v.musicStyle) item.musicTone = v.musicStyle;
        if (v.ctaStyle) item.ctaStyle = v.ctaStyle;
        if (v.imageStyle) item.imageStyle = v.imageStyle;
        if (v.imagePromptHint) item.imagePromptHint = v.imagePromptHint;
        if (v.videoPromptHint) item.videoPromptHint = v.videoPromptHint;
        if (v.musicPromptHint) item.musicPromptHint = v.musicPromptHint;
        return item;
      }),
      callbackUrl,
    };

    const { ok, status, data } = await api("/api/v1/videos/batch", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return ok
      ? textResult(data)
      : errorText(formatVideoCreateError(status, data));
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Prizmad MCP server v2.0.0 running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
