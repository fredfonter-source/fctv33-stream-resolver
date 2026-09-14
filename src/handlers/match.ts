import { ApiClient } from "../api/client.js";
import { buildSignedStreamUrl } from "../crypto/stream-token.js";
import { buildProxyUrl } from "../proxy/hls.js";

export async function resolveMatch(
  matchIdRaw: string | null,
  sportTypeRaw: string | null,
  origin: string,
): Promise<Response> {
  if (!matchIdRaw || !sportTypeRaw) {
    return Response.json({ error: "matchId and sportType required" }, { status: 400 });
  }
  const matchId = matchIdRaw.trim();
  const sportType = Number(sportTypeRaw);
  if (!/^\d+$/.test(matchId) || !Number.isFinite(sportType)) {
    return Response.json({ error: "invalid matchId or sportType" }, { status: 400 });
  }
  try {
    const client = new ApiClient();
    const [geo, match, playerReferer] = await Promise.all([
      client.fetchUserGeo(),
      client.fetchMatchDetail(matchId, sportType),
      client.resolvePlayerReferer(),
    ]);
    const stream = match.stream.find((item) => item.streamId);
    if (!stream?.streamId) throw new Error("no stream on match");
    if (stream.siteType == null) throw new Error("stream missing site type");
    const detail = await client.fetchStreamDetail({
      streamId: stream.streamId,
      matchId,
      sportType,
      siteType: stream.siteType,
      ...(geo.country ? { country: geo.country } : {}),
      ...(geo.continent ? { continent: geo.continent } : {}),
    });
    if (!detail.stream.url) throw new Error("stream detail missing url");
    const streamUrl = buildSignedStreamUrl(detail.stream.url, detail.sessionToken);
    return Response.json({
      name: stream.name ?? "",
      matchId,
      sportType,
      streamUrl,
      referer: playerReferer,
      playableUrl: buildProxyUrl(streamUrl, playerReferer, origin),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "resolve failed" },
      { status: 502 },
    );
  }
}
