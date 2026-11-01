import { NextResponse } from "next/server";
import { emptyGrowth } from "@/lib/presets";
import { RecommendError, recommendDecks, type LiveKind, type RecommendInput } from "@/lib/recommend";
import { regionOfRequest } from "@/lib/region";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const LIVE_KINDS: LiveKind[] = ["multi", "solo", "auto"];

export async function POST(req: Request) {
  let body: Partial<RecommendInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 잘못되었습니다." }, { status: 400 });
  }

  const input: RecommendInput = {
    eventId: Number(body.eventId),
    liveType: LIVE_KINDS.includes(body.liveType as LiveKind) ? (body.liveType as LiveKind) : "multi",
    musicId: Number.isFinite(Number(body.musicId)) && Number(body.musicId) !== 0 ? Number(body.musicId) : 74,
    difficulty: String(body.difficulty ?? "expert"),
    cards: body.cards ?? {},
    characterRanks: body.characterRanks && typeof body.characterRanks === "object" ? body.characterRanks : {},
    growth: { ...emptyGrowth(), ...(body.growth && typeof body.growth === "object" ? body.growth : {}) },
    musicTime: Number(body.musicTime) > 0 ? Math.min(600, Number(body.musicTime)) : undefined,
    fixedCardIds: Array.isArray(body.fixedCardIds)
      ? body.fixedCardIds.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 5)
      : [],
    fixedLeaderId: Number.isInteger(Number(body.fixedLeaderId)) && Number(body.fixedLeaderId) > 0 ? Number(body.fixedLeaderId) : null,
    fixedCharacterIds: Array.isArray(body.fixedCharacterIds)
      ? body.fixedCharacterIds.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 26).slice(0, 5)
      : [],
    fixedLeaderCharacterId:
      Number(body.fixedLeaderCharacterId) >= 1 && Number(body.fixedLeaderCharacterId) <= 26 ? Number(body.fixedLeaderCharacterId) : null,
    worldBloomCharacterId:
      Number(body.worldBloomCharacterId) >= 1 && Number(body.worldBloomCharacterId) <= 26 ? Number(body.worldBloomCharacterId) : null,
    region: regionOfRequest(req, body.region),
  };
  if (!Number.isFinite(input.eventId) || input.eventId <= 0) {
    return NextResponse.json({ error: "이벤트 정보가 없습니다." }, { status: 400 });
  }

  try {
    return NextResponse.json(await recommendDecks(input));
  } catch (e) {
    if (e instanceof RecommendError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json(
      { error: "덱 계산 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}
