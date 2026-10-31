// 보유 카드 프리셋: 브라우저(localStorage)에 저장
import { currentRegion } from "./region";

export interface OwnedCard {
  /** 특훈 완료 여부 (★3, ★4만 의미 있음) */
  trained: boolean;
  /** 마스터 랭크 0~5 */
  masterRank: number;
  /** 스킬 레벨 1~4 (예전 프리셋에는 없을 수 있음 → 1로 취급) */
  skillLevel?: number;
  /** 마이세카이 캔버스 제작 여부 */
  canvas?: boolean;
  /** 사이드 스토리 전편·후편 읽음 여부 (예전 프리셋에는 없을 수 있음 → 읽음으로 취급) */
  storyFirst?: boolean;
  storySecond?: boolean;
}

/** 내실: 종합력에 영향을 주는 계정 전체 요소 */
export interface Growth {
  /** 에어리어 아이템 ID → 레벨 (없거나 0이면 미보유) */
  areaItems: Record<number, number>;
  /** 마이세카이 게이트 ID → 레벨 */
  gates: Record<number, number>;
  /** 캐릭터 ID → 마이세카이 가구 퍼포먼스 보너스(%) */
  fixtures: Record<number, number>;
  /** 칭호 ID → 보유 레벨 (보너스가 붙는 칭호만) */
  honors: Record<number, number>;
}

export function emptyGrowth(): Growth {
  return { areaItems: {}, gates: {}, fixtures: {}, honors: {} };
}

export interface Preset {
  id: string;
  name: string;
  updatedAt: number;
  cards: Record<number, OwnedCard>;
  /** 캐릭터 ID → 캐릭터 랭크 (입력하지 않은 캐릭터는 1로 취급) */
  characterRanks?: Record<number, number>;
  /** 내실 (예전 프리셋에는 없을 수 있음) */
  growth?: Growth;
}

interface StoreShape {
  version: 1;
  activeId: string;
  presets: Preset[];
}

/** 서버마다 프리셋을 따로 저장 (한국 서버는 예전 이름 그대로) */
function storageKey() {
  return currentRegion() === "jp" ? "sekai-deck-kr:presets:jp" : "sekai-deck-kr:presets";
}

export function newPreset(name: string): Preset {
  return {
    id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    name,
    updatedAt: Date.now(),
    cards: {},
    characterRanks: {},
    growth: emptyGrowth(),
  };
}

export function loadStore(): { activeId: string; presets: Preset[] } {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const parsed = JSON.parse(raw) as StoreShape;
      if (parsed.version === 1 && Array.isArray(parsed.presets) && parsed.presets.length > 0) {
        const activeId = parsed.presets.some((p) => p.id === parsed.activeId)
          ? parsed.activeId
          : parsed.presets[0].id;
        return { activeId, presets: parsed.presets };
      }
    }
  } catch {
    // 저장소가 막혀 있거나 데이터가 깨진 경우: 새로 시작
  }
  const first = newPreset("내 카드");
  return { activeId: first.id, presets: [first] };
}

export function saveStore(activeId: string, presets: Preset[]): boolean {
  try {
    const data: StoreShape = { version: 1, activeId, presets };
    localStorage.setItem(storageKey(), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

// ---------- 내보내기 / 가져오기 ----------

interface ExportFile {
  format: "sekai-deck-kr-preset";
  version: 1;
  name: string;
  cards: Record<number, OwnedCard>;
  characterRanks: Record<number, number>;
  growth: Growth;
}

export function toExportJson(preset: Preset): string {
  const file: ExportFile = {
    format: "sekai-deck-kr-preset",
    version: 1,
    name: preset.name,
    cards: preset.cards,
    characterRanks: preset.characterRanks ?? {},
    growth: preset.growth ?? emptyGrowth(),
  };
  return JSON.stringify(file, null, 2);
}

export interface ImportedPreset {
  name: string;
  cards: Record<number, OwnedCard>;
  characterRanks: Record<number, number>;
  growth: Growth;
}

/**
 * 가져오기. 이 사이트에서 내보낸 파일과
 * suite 형식(userCards, userCharacters 배열이 들어 있는 JSON)을 받는다.
 */
export function parseImport(text: string, validCardIds: Set<number>): ImportedPreset {
  const data = JSON.parse(text);
  const cards: Record<number, OwnedCard> = {};
  const characterRanks: Record<number, number> = {};

  if (data?.format === "sekai-deck-kr-preset" && data.cards && typeof data.cards === "object") {
    for (const [key, value] of Object.entries(data.cards as Record<string, Partial<OwnedCard>>)) {
      const id = Number(key);
      if (!validCardIds.has(id)) continue;
      cards[id] = {
        trained: Boolean(value?.trained),
        masterRank: clampRank(value?.masterRank),
        skillLevel: clampSkill(value?.skillLevel),
        canvas: Boolean(value?.canvas),
        storyFirst: value?.storyFirst !== false,
        storySecond: value?.storySecond !== false,
      };
    }
    for (const [key, value] of Object.entries((data.characterRanks ?? {}) as Record<string, unknown>)) {
      const id = Number(key);
      if (id >= 1 && id <= 26) characterRanks[id] = clampCharacterRank(value);
    }
    return { name: String(data.name ?? "가져온 프리셋"), cards, characterRanks, growth: readGrowth(data.growth) };
  }

  const userCards = Array.isArray(data?.userCards) ? data.userCards : null;
  if (userCards) {
    for (const c of userCards) {
      const id = Number(c?.cardId);
      if (!validCardIds.has(id)) continue;
      // 사이드 스토리: 에피소드 ID가 작은 쪽이 전편
      const episodes = (Array.isArray(c?.episodes) ? [...c.episodes] : []).sort(
        (a: { cardEpisodeId?: number }, b: { cardEpisodeId?: number }) => Number(a?.cardEpisodeId) - Number(b?.cardEpisodeId),
      );
      const read = (i: number) => (episodes[i] ? episodes[i]?.scenarioStatus === "already_read" : true);
      cards[id] = {
        trained: c?.specialTrainingStatus === "done",
        masterRank: clampRank(c?.masterRank),
        skillLevel: clampSkill(c?.skillLevel),
        storyFirst: read(0),
        storySecond: read(1),
      };
    }
    if (Array.isArray(data?.userCharacters)) {
      for (const ch of data.userCharacters) {
        const id = Number(ch?.characterId);
        if (id >= 1 && id <= 26) characterRanks[id] = clampCharacterRank(ch?.characterRank);
      }
    }
    // suite 형식의 내실 데이터
    const growth = emptyGrowth();
    if (Array.isArray(data?.userMysekaiCanvases)) {
      for (const cv of data.userMysekaiCanvases) {
        const id = Number(cv?.cardId);
        if (cards[id]) cards[id].canvas = true;
      }
    }
    if (Array.isArray(data?.userHonors)) {
      for (const h of data.userHonors) {
        const id = Number(h?.honorId);
        const lv = toLevel(h?.level ?? 1);
        if (id > 0 && lv > 0) growth.honors[id] = lv;
      }
    }
    if (Array.isArray(data?.userAreas)) {
      for (const area of data.userAreas) {
        for (const item of Array.isArray(area?.areaItems) ? area.areaItems : []) {
          const id = Number(item?.areaItemId);
          const lv = toLevel(item?.level);
          if (id > 0 && lv > 0) growth.areaItems[id] = lv;
        }
      }
    }
    if (Array.isArray(data?.userMysekaiGates)) {
      for (const g of data.userMysekaiGates) {
        const id = Number(g?.mysekaiGateId);
        const lv = toLevel(g?.mysekaiGateLevel);
        if (id > 0 && lv > 0) growth.gates[id] = lv;
      }
    }
    if (Array.isArray(data?.userMysekaiFixtureGameCharacterPerformanceBonuses)) {
      for (const f of data.userMysekaiFixtureGameCharacterPerformanceBonuses) {
        const id = Number(f?.gameCharacterId);
        const rate = Number(f?.totalBonusRate);
        if (id >= 1 && id <= 26 && Number.isFinite(rate) && rate > 0) growth.fixtures[id] = rate / 10;
      }
    }
    return { name: "가져온 카드", cards, characterRanks, growth };
  }

  throw new Error("지원하지 않는 파일 형식입니다. 이 사이트에서 내보낸 프리셋 파일이나 userCards가 들어 있는 JSON을 올려 주세요.");
}

function readGrowth(v: unknown): Growth {
  const g = emptyGrowth();
  if (!v || typeof v !== "object") return g;
  const src = v as Partial<Record<keyof Growth, Record<string, unknown>>>;
  for (const key of ["areaItems", "gates", "honors"] as const) {
    for (const [id, lv] of Object.entries(src[key] ?? {})) {
      const level = toLevel(lv);
      if (Number(id) > 0 && level > 0) g[key][Number(id)] = level;
    }
  }
  for (const [id, rate] of Object.entries(src.fixtures ?? {})) {
    const n = Number(rate);
    if (Number(id) >= 1 && Number(id) <= 26 && Number.isFinite(n) && n > 0) g.fixtures[Number(id)] = n;
  }
  return g;
}

function toLevel(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

export const MAX_CHARACTER_RANK = 300;

export function clampSkill(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(4, Math.max(1, Math.round(n)));
}

export function clampCharacterRank(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_CHARACTER_RANK, Math.max(1, Math.round(n)));
}

function clampRank(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(5, Math.max(0, Math.round(n)));
}
