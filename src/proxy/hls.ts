import { USER_AGENT } from "../config/site.js";

const CORS = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
} as const;

export function buildProxyUrl(streamUrl: string, playerReferer: string, origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/hls?${new URLSearchParams({ url: streamUrl, referer: playerReferer })}`;
}

function rewriteManifest(body: string, targetUrl: string, playerReferer: string, origin: string): string {
  const base = new URL(targetUrl);
  return body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      return buildProxyUrl(new URL(trimmed, base).href, playerReferer, origin);
    })
    .join("\n");
}

export async function proxyHls(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");
  const playerReferer = url.searchParams.get("referer");
  if (!targetUrl || !playerReferer) {
    return Response.json({ error: "url and referer required" }, { status: 400 });
  }
  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: playerReferer,
        Origin: playerReferer.replace(/\/$/, ""),
      },
      redirect: "follow",
    });
    const body = Buffer.from(await response.arrayBuffer());
    if (response.status < 200 || response.status >= 300 || !body.length) {
      throw new Error(`upstream ${response.status}`);
    }
    const head = body.subarray(0, Math.min(body.length, 256)).toString("utf8");
    if (head.includes("#EXTM3U") || targetUrl.includes(".m3u8")) {
      const origin = url.origin.replace(/^http:/, "https:");
      return new Response(rewriteManifest(body.toString("utf8"), targetUrl, playerReferer, origin), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/vnd.apple.mpegurl" },
      });
    }
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: { ...CORS, "Content-Type": "video/mp2t" },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "upstream failed", {
      status: 502,
      headers: CORS,
    });
  }
}
