import { NextResponse } from "next/server";
import { getCardFeatures, matchTiles } from "@/lib/cardMatch";
import { regionOfRequest } from "@/lib/region";
import { FEATURE } from "@/lib/screenshot";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FEATURE_LEN = FEATURE.gx * FEATURE.gy * 3;

/** 미리 준비: 썸네일 특징값을 만들어 두고 개수를 알려 줌 */
export async function GET(req: Request) {
  try {
    const entries = await getCardFeatures(regionOfRequest(req));
    return NextResponse.json({ ready: entries.length });
  } catch {
    return NextResponse.json({ error: "카드 이미지 정보를 준비하지 못했습니다." }, { status: 500 });
  }
}

/** 스크린샷 칸 특징값 → 후보 카드 */
export async function POST(req: Request) {
  let body: { tiles?: unknown; region?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 잘못되었습니다." }, { status: 400 });
  }
  const tiles = Array.isArray(body.tiles) ? body.tiles : [];
  if (tiles.length === 0 || tiles.length > 300) {
    return NextResponse.json({ error: "카드 칸을 찾지 못했습니다." }, { status: 400 });
  }
  const clean = tiles.map((t) =>
    Array.isArray(t) && t.length === FEATURE_LEN ? t.map((v) => Math.max(0, Math.min(255, Number(v) || 0))) : null,
  );
  if (clean.some((t) => t === null)) {
    return NextResponse.json({ error: "요청 형식이 잘못되었습니다." }, { status: 400 });
  }
  try {
    return NextResponse.json({ matches: await matchTiles(clean as number[][], regionOfRequest(req, body.region)) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "카드 대조 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
