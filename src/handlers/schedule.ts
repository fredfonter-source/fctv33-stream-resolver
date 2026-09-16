import { ApiClient } from "../api/client.js";

export async function listScheduleMatches(sportTypeRaw: string | null): Promise<Response> {
  const sportType = Number(sportTypeRaw ?? 1);
  if (!Number.isFinite(sportType)) {
    return Response.json({ error: "invalid sportType" }, { status: 400 });
  }
  try {
    const matches = await new ApiClient().fetchScheduleMatches(sportType);
    return Response.json({ sportType, matches });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "schedule list failed" },
      { status: 502 },
    );
  }
}
