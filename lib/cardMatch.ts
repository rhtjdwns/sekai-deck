// 카드 썸네일 특징값을 만들어 두고, 스크린샷의 카드 칸과 대조한다 (서버 전용)
import "server-only";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { featureDistance, thumbFeature } from "./screenshot";
import { getMasterFile } from "./recommend";
import { getThumb } from "./thumbs";
import type { Region } from "./region";
const CACHE_FILE = path.join(process.cwd(), ".cache", "card-features-v1.json");
const CONCURRENCY = 16;

interface Entry {
  cardId: number;
  trained: boolean;
  f: number[];
}

type CacheFile = Record<string, number[] | null>; // "카드ID:n|t" → 특징값 (null = 썸네일 없음)

let cache: CacheFile | null = null;
// 서버마다 카드 목록이 달라서 따로 만듦 (특징값 파일은 카드 번호 기준이라 두 서버가 함께 씀)
const building: Partial<Record<Region, Promise<Entry[]> | null>> = {};

async function readCache(): Promise<CacheFile> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8")) as CacheFile;
  } catch {
    cache = {};
  }
  return cache;
}

async function writeCache(data: CacheFile) {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(data));
  } catch {
    // 저장 실패는 무시 (다음에 다시 만듦)
  }
}

/** 썸네일 특징값. 썸네일은 사이트에 보여 주는 것과 같은 저장소에서 가져와서 원본 서버에는 한 번만 요청함 */
async function featureOf(name: string): Promise<number[] | null> {
  const buf = await getThumb(name);
  if (!buf) return null;
  const raw = await sharp(buf).resize(128, 128, { fit: "fill" }).removeAlpha().raw().toBuffer();
  return thumbFeature(raw, 3);
}

/** 출시된 모든 카드의 특징값 (특훈 전, ★3·★4는 특훈 후도). 처음 한 번만 썸네일을 받아 만든다 */
export function getCardFeatures(region: Region = "kr"): Promise<Entry[]> {
  const running = building[region];
  if (running) return running;
  const job = (async () => {
    const cards = await getMasterFile<{ id: number; cardRarityType: string; assetbundleName: string; releaseAt: number }>(
      "cards",
      region,
    );
    const now = Date.now();
    const data = await readCache();
    const jobs: { key: string; name: string; cardId: number; trained: boolean }[] = [];
    for (const c of cards) {
      if (c.releaseAt > now) continue;
      jobs.push({ key: `${c.id}:n`, name: `${c.assetbundleName}_normal.webp`, cardId: c.id, trained: false });
      if (c.cardRarityType === "rarity_3" || c.cardRarityType === "rarity_4") {
        jobs.push({ key: `${c.id}:t`, name: `${c.assetbundleName}_after_training.webp`, cardId: c.id, trained: true });
      }
    }
    const missing = jobs.filter((j) => !(j.key in data));
    let i = 0;
    let changed = false;
    async function worker() {
      while (i < missing.length) {
        const j = missing[i++];
        try {
          data[j.key] = await featureOf(j.name);
          changed = true;
        } catch {
          // 네트워크 오류는 저장하지 않고 다음에 다시 시도
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (changed) await writeCache(data);

    return jobs
      .filter((j) => Array.isArray(data[j.key]))
      .map((j) => ({ cardId: j.cardId, trained: j.trained, f: data[j.key] as number[] }));
  })().catch((e) => {
    building[region] = null;
    throw e;
  });
  building[region] = job;
  // 실패 없이 끝나면 1시간 뒤 새 카드 반영을 위해 다시 만들 수 있게
  job.then(() => setTimeout(() => (building[region] = null), 60 * 60 * 1000));
  return job;
}

export interface MatchCandidate {
  cardId: number;
  trained: boolean;
  distance: number;
}

/** 각 칸 특징값에 대해 가장 가까운 카드 3장 (같은 카드는 한 번만) */
export async function matchTiles(tiles: number[][], region: Region = "kr"): Promise<MatchCandidate[][]> {
  const entries = await getCardFeatures(region);
  return tiles.map((tf) => {
    const scored = entries
      .map((e) => ({ cardId: e.cardId, trained: e.trained, distance: featureDistance(tf, e.f) }))
      .sort((a, b) => a.distance - b.distance);
    const out: MatchCandidate[] = [];
    for (const s of scored) {
      if (out.some((o) => o.cardId === s.cardId)) continue;
      out.push({ ...s, distance: Math.round(s.distance * 10) / 10 });
      if (out.length === 3) break;
    }
    return out;
  });
}
