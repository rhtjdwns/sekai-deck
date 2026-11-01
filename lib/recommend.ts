// 이벤트 덱 추천 (서버 전용). sekai-calculator 라이브러리에 한국판 마스터 데이터를 연결한다.
import "server-only";
import {
  AreaItemService,
  CardCalculator,
  CardPowerCalculator,
  DeckCalculator,
  EventCalculator,
  EventService,
  LiveCalculator,
  LiveType,
  type DataProvider,
  type MusicMeta,
  type UserCard,
} from "sekai-calculator";
import { DeckSearchError, searchDecks, type ScoredDeck, type SearchSpec } from "./deckSearch";
import { clampCharacterRank, clampSkill, emptyGrowth, type Growth, type OwnedCard } from "./presets";
import { fetchWithRetry } from "./fetchRetry";
import { REGIONS, type Region } from "./region";

// ---------- 종합력 계산 보정 ----------
// 라이브러리는 에어리어 아이템·캐릭터 랭크 보너스를 카드의 세 가지 파워 수치마다 따로 내림해서 더하는데,
// 실제 게임은 카드 기본 종합력 합계에 비율을 곱한 뒤 한 번만 내림한다.
// (예: 기본 35,782 × 5% → 게임 1,789 / 라이브러리 1,787) 그래서 두 계산을 게임 방식으로 바꿔 둔다.
type AreaItemLevelRow = {
  targetUnit: string;
  targetCardAttr: string;
  targetGameCharacterId?: number;
  power1BonusRate: number;
  power2BonusRate: number;
  power3BonusRate: number;
  power1AllMatchBonusRate: number;
  power2AllMatchBonusRate: number;
  power3AllMatchBonusRate: number;
};
type CharacterRankRow = {
  characterId: number;
  characterRank: number;
  power1BonusRate: number;
  power2BonusRate: number;
  power3BonusRate: number;
};
// 마스터의 비율은 float32라 0.30000001처럼 들어 있어서, 소수 넷째 자리로 정리해 곱함
const cleanRate = (r: number) => Math.round(r * 10000) / 10000;
const floorPower = (v: number) => Math.floor(v + 1e-6);
(function patchPowerCalculator() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = CardPowerCalculator.prototype as any;
  if (proto.__krPatched) return;
  proto.__krPatched = true;
  proto.getAreaItemBonusPower = async function (
    userAreaItemLevels: AreaItemLevelRow[],
    basePower: number[],
    characterId: number,
    unit: string,
    sameUnit: boolean,
    attr: string,
    sameAttr: boolean,
  ) {
    let bonus = 0;
    for (const it of userAreaItemLevels) {
      if (it.targetUnit !== "any" && it.targetUnit !== unit) continue;
      if (it.targetCardAttr !== "any" && it.targetCardAttr !== attr) continue;
      if (it.targetGameCharacterId !== undefined && it.targetGameCharacterId !== characterId) continue;
      const allMatch = (it.targetUnit !== "any" && sameUnit) || (it.targetCardAttr !== "any" && sameAttr);
      const rates = allMatch
        ? [it.power1AllMatchBonusRate, it.power2AllMatchBonusRate, it.power3AllMatchBonusRate]
        : [it.power1BonusRate, it.power2BonusRate, it.power3BonusRate];
      rates.forEach((r, i) => (bonus += (cleanRate(r) * basePower[i]) / 100));
    }
    return floorPower(bonus);
  };
  proto.getCharacterBonusPower = async function (basePower: number[], characterId: number) {
    const ranks = (await this.dataProvider.getMasterData("characterRanks")) as CharacterRankRow[];
    const users = (await this.dataProvider.getUserData("userCharacters")) as { characterId: number; characterRank: number }[];
    const user = users.find((u) => u.characterId === characterId);
    const row = user && ranks.find((r) => r.characterId === characterId && r.characterRank === user.characterRank);
    if (!row) throw new Error(`캐릭터 ${characterId}의 랭크 정보를 찾지 못했습니다.`);
    const rates = [row.power1BonusRate, row.power2BonusRate, row.power3BonusRate];
    return floorPower(rates.reduce((sum, r, i) => sum + (cleanRate(r) * basePower[i]) / 100, 0));
  };
})();

const MUSIC_META_URL = process.env.MUSIC_META_URL ?? "https://storage.sekai.best/sekai-best-assets/music_metas.json";
const CACHE_MS = 60 * 60 * 1000;

// 곡 메타를 못 받아올 때 쓰는 기본값: 独りんぼエンヴィー EXPERT
export const FALLBACK_META: MusicMeta = {
  music_id: 74,
  difficulty: "expert",
  music_time: 74.8,
  event_rate: 100,
  base_score: 1.1098806440522608,
  base_score_auto: 0.7595,
  skill_score_solo: [0.06913362365344945, 0.07112308044923217, 0.07635535182214072, 0.07771564290625711, 0.06290662388264952, 0.10417790511116198],
  skill_score_auto: [0.048393536557414615, 0.04978615631446252, 0.052919550767820296, 0.05361586064634425, 0.04317121246848498, 0.07015322026128809],
  skill_score_multi: [0.06913362365344945, 0.07112308044923217, 0.07635535182214072, 0.07771564290625711, 0.06290662388264952, 0.1483786614714646],
  fever_score: 0.11913862021544797,
  fever_end_time: 56.81818181818182,
  tap_count: 329,
};

/** 곡 데이터가 없는 곡 중 길이를 알고 있는 곡 (초) */
export const KNOWN_MUSIC_TIMES: Record<number, number> = {
  10004: 146, // 벚꽃비 2분 26초
};

/** 덱 탐색 시간 상한. 넘으면 그때까지 찾은 가장 좋은 덱을 돌려줌 (보통 1초 안에 끝남) */
const SEARCH_BUDGET_MS = 20_000;

// ---------- 메모리 캐시 (큰 JSON이라 Next 데이터 캐시 대신 사용) ----------
const memo = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as Promise<T>;
  const value = load().catch((e) => {
    memo.delete(key); // 실패는 캐시하지 않음
    throw e;
  });
  memo.set(key, { at: Date.now(), value });
  return value;
}

/** 메모리에 보관한 게임 데이터를 비움 (오후 3시·8시 화면 갱신 때 새로 받도록) */
export function clearMasterCache() {
  memo.clear();
}

/** 게임 데이터 파일. region을 빼면 한국 서버 */
export function getMasterFile<T>(key: string, region: Region = "kr"): Promise<T[]> {
  return cached(`master:${region}:${key}`, async () => {
    // 화면을 정적으로 만들 수 있게 no-store 대신 태그 캐시 사용 (오후 3시·8시 갱신 때 함께 비워짐).
    // 2MB가 넘는 파일은 Next가 저장하지 않지만 위의 메모리 캐시로 충분함
    const res = await fetchWithRetry(`${REGIONS[region].masterBase}/${key}.json`, {
      next: { revalidate: false, tags: ["master"] },
    });
    // 한국판에 아직 없는 파일(신규 시스템 등)은 빈 배열로 처리
    if (res.status === 404) return [] as T[];
    if (!res.ok) throw new Error(`${key}.json 불러오기 실패 (${res.status})`);
    return (await res.json()) as T[];
  });
}

/** 곡 메타 전체. 받아오지 못하면 null */
export async function getMusicMetas(): Promise<MusicMeta[] | null> {
  try {
    return await cached("musicMetas", async () => {
      const res = await fetchWithRetry(MUSIC_META_URL, { next: { revalidate: false, tags: ["master"] } });
      if (!res.ok) throw new Error(`music_metas ${res.status}`);
      return (await res.json()) as MusicMeta[];
    });
  } catch {
    return null;
  }
}

// ---------- 추천 ----------
export type LiveKind = "multi" | "solo" | "auto";

export interface RecommendInput {
  eventId: number;
  liveType: LiveKind;
  musicId: number;
  difficulty: string;
  cards: Record<number, OwnedCard>;
  /** 캐릭터 ID → 랭크. 없는 캐릭터는 1 */
  characterRanks: Record<number, number>;
  /** 내실 (에어리어 아이템, 마이세카이) */
  growth: Growth;
  /** 곡 데이터가 없는 곡의 길이(초). 비우면 노트 수로 추정 */
  musicTime?: number;
  /** 꼭 넣을 카드 (최대 5장, 캐릭터가 겹치면 안 됨) */
  fixedCardIds?: number[];
  /** 리더 자리에 고정할 카드 (fixedCardIds 중 하나) */
  fixedLeaderId?: number | null;
  /** 꼭 넣을 캐릭터 (카드는 그 캐릭터 카드 중 가장 좋은 것으로 고름) */
  fixedCharacterIds?: number[];
  /** 리더로 고정할 캐릭터 */
  fixedLeaderCharacterId?: number | null;
  /** 월드 링크: 계산할 챕터의 캐릭터 */
  worldBloomCharacterId?: number | null;
  /** 서버 (없으면 한국 서버) */
  region?: Region;
}

/** 공방(멀티 라이브)에서 곡이 랜덤으로 정해질 때를 뜻하는 곡 번호 */
export const RANDOM_MUSIC_ID = -1;

/** data: 실제 곡 데이터, estimated: 비슷한 길이의 곡으로 추정, average: 랜덤 곡(전체 곡 평균), fallback: 혼자 놀이 엔비로 대체 */
export type MetaSource = "data" | "estimated" | "average" | "fallback";

export interface RecommendResult {
  eventId: number;
  /** 실제로 계산한 라이브 종류 (치어풀 카니발의 멀티는 치어풀 라이브) */
  liveType: LiveKind | "cheerful";
  metaSource: MetaSource;
  /** 추정에 쓴 곡 길이(초) */
  musicTime: number;
  /** 곡 길이 출처: 사용자 입력, 등록된 길이, 노트 수로 추정 */
  musicTimeSource: "input" | "known" | "estimated" | null;
  /** 랜덤 곡일 때 평균에 쓴 곡 수 */
  averagedSongs?: number;
  /** 월드 링크: 계산한 챕터 캐릭터 */
  worldBloomCharacterId?: number;
  musicId: number;
  difficulty: string;
  decks: {
    eventPoint: number;
    liveScore: number;
    power: number;
    /** 덱 종합력 내역 */
    powerDetail: DeckPowerBreakdown;
    eventBonus: number;
    cards: {
      cardId: number;
      masterRank: number;
      skillScoreUp: number;
      eventBonus: number;
      power: number;
      /** 카드 종합력 내역 */
      powerDetail: CardPowerBreakdown;
    }[];
  }[];
}

/** 카드 한 장의 종합력 내역. base는 카드 레벨·특훈·마스터 랭크·사이드 스토리·캔버스를 반영한 카드 자체 값 */
export interface CardPowerBreakdown {
  base: number;
  areaItemBonus: number;
  characterBonus: number;
  fixtureBonus: number;
  gateBonus: number;
  total: number;
}

/** 덱 전체 종합력 내역 (카드 5장 합 + 칭호 보너스) */
export interface DeckPowerBreakdown extends CardPowerBreakdown {
  honorBonus: number;
}

const LIVE_TYPE: Record<LiveKind, LiveType> = {
  multi: LiveType.MULTI,
  solo: LiveType.SOLO,
  auto: LiveType.AUTO,
};

export async function recommendDecks(input: RecommendInput): Promise<RecommendResult> {
  const region = input.region ?? "kr";
  const [masterCards, cardEpisodes, events] = await Promise.all([
    getMasterFile<{ id: number; cardRarityType: string; characterId: number }>("cards", region),
    getMasterFile<{ id: number; cardId: number; cardEpisodePartType: string }>("cardEpisodes", region),
    getMasterFile<{ id: number; eventType: string }>("events", region),
  ]);
  const event = events.find((e) => e.id === input.eventId);
  if (!event) throw new RecommendError("선택한 이벤트를 찾지 못했습니다.");
  // 치어풀 카니발에서는 멀티 라이브가 치어풀 라이브로 진행됨
  const isCheerful = event.eventType === "cheerful_carnival";
  const liveType = isCheerful && input.liveType === "multi" ? LiveType.CHEERFUL : LIVE_TYPE[input.liveType];
  const rarityById = new Map(masterCards.map((c) => [c.id, c.cardRarityType]));
  // 사이드 스토리 (읽으면 카드 파워가 오름). 보유 카드 체크에서 입력한 전편·후편 읽음 여부를 사용
  const episodesByCard = new Map<number, { id: number; part: string }[]>();
  for (const e of cardEpisodes)
    episodesByCard.set(e.cardId, [...(episodesByCard.get(e.cardId) ?? []), { id: e.id, part: e.cardEpisodePartType }]);

  // 체크한 카드를 라이브러리의 유저 카드 형식으로 변환 (레벨은 최대로 가정)
  const userCards: UserCard[] = Object.entries(input.cards)
    .map(([id, o]) => ({ cardId: Number(id), owned: o }))
    .filter(({ cardId }) => rarityById.has(cardId))
    .map(({ cardId, owned }) => {
      const rarity = rarityById.get(cardId)!;
      const canTrain = rarity === "rarity_3" || rarity === "rarity_4";
      return {
        userId: 0,
        cardId,
        level: MAX_LEVEL[rarity] ?? 1,
        totalExp: 0,
        skillLevel: clampSkill(owned.skillLevel ?? 1),
        skillExp: 0,
        totalSkillExp: 0,
        masterRank: owned.masterRank,
        specialTrainingStatus: canTrain && owned.trained ? "done" : "not_doing",
        defaultImage: "original",
        duplicateCount: 0,
        createdAt: 0,
        episodes: (episodesByCard.get(cardId) ?? []).map((ep) => {
          const read = ep.part === "second_part" ? owned.storySecond !== false : owned.storyFirst !== false;
          return {
            cardEpisodeId: ep.id,
            scenarioStatus: read ? "already_read" : "unreleased",
            scenarioStatusReasons: [],
            isNotSkipped: false,
          };
        }),
      };
    });

  if (userCards.length < 5) {
    throw new RecommendError("덱을 짜려면 보유 카드가 5장 이상 필요합니다.");
  }
  // 한 덱에는 같은 캐릭터를 한 장만 넣을 수 있음
  const characterOf = new Map(masterCards.map((c) => [c.id, c.characterId]));
  const distinctCharacters = new Set(userCards.map((c) => characterOf.get(c.cardId))).size;
  if (distinctCharacters < 5) {
    throw new RecommendError(
      `같은 캐릭터는 한 덱에 한 장만 넣을 수 있어서, 서로 다른 캐릭터의 카드가 5명 이상 필요해요. 지금은 ${distinctCharacters}명이에요.`,
    );
  }

  const metas = await getMusicMetas();
  const found = metas?.find((m) => m.music_id === input.musicId && m.difficulty === input.difficulty);
  let musicMeta: MusicMeta = found ?? FALLBACK_META;
  let metaSource: MetaSource = found ? "data" : "fallback";
  let musicTimeSource: RecommendResult["musicTimeSource"] = null;
  let averagedSongs: number | undefined;
  if (input.musicId === RANDOM_MUSIC_ID && metas) {
    const avg = await averageMusicMeta(metas, input.difficulty, region);
    if (avg) {
      musicMeta = avg.meta;
      metaSource = "average";
      averagedSongs = avg.count;
    }
  } else if (!found && metas) {
    const est = await estimateMusicMeta(metas, input.musicId, input.difficulty, input.musicTime, region);
    if (est) {
      musicMeta = est.meta;
      metaSource = "estimated";
      musicTimeSource = est.timeSource;
    }
  }

  const growthData = await buildGrowthUserData({ ...emptyGrowth(), ...input.growth }, input.eventId, region);
  // 캐릭터 랭크는 그 서버의 최대 랭크를 넘지 않게 (마스터에 없는 랭크면 계산이 실패함)
  const rankRows = await getMasterFile<{ characterRank: number }>("characterRanks", region);
  const maxRank = rankRows.reduce((m, r) => Math.max(m, r.characterRank), 1);

  const userData: Record<string, unknown> = {
    userCards,
    // 보유 카드 체크 화면에서 입력한 캐릭터 랭크 (입력 안 한 캐릭터는 1)
    userCharacters: Array.from({ length: 26 }, (_, i) => ({
      userId: 0,
      characterId: i + 1,
      characterRank: Math.min(maxRank, clampCharacterRank(input.characterRanks[i + 1] ?? 1)),
    })),
    // 내실 화면에서 입력한 값
    ...growthData,
    // 캔버스를 제작한 카드
    userMysekaiCanvases: userCards
      .filter((c) => input.cards[c.cardId]?.canvas)
      .map((c) => ({ cardId: c.cardId })),
    userDecks: [],
    userChallengeLiveSoloDecks: [],
  };

  const provider: DataProvider = {
    getMasterData: <T,>(key: string) => getMasterFile<T>(key, region),
    getUserDataAll: async () => userData,
    getUserData: async <T,>(key: string) => (userData[key] ?? []) as T,
    getMusicMeta: async () => metas ?? [FALLBACK_META],
  };

  // 월드 링크: 고른 챕터의 캐릭터로 계산 (챕터마다 보너스 캐릭터·유닛과 서포트 덱이 달라짐)
  let chapterChar: number | undefined;
  if (event.eventType === "world_bloom" && input.worldBloomCharacterId) {
    const blooms = await getMasterFile<{ eventId: number; gameCharacterId?: number }>("worldBlooms", region);
    const wanted = Number(input.worldBloomCharacterId);
    if (blooms.some((w) => w.eventId === input.eventId && w.gameCharacterId === wanted)) chapterChar = wanted;
  }

  // 고정 카드 확인
  const fixedIds = Array.from(new Set((input.fixedCardIds ?? []).map(Number))).filter((id) => input.cards[id]);
  if (fixedIds.length > 5) throw new RecommendError("고정할 수 있는 카드는 5장까지예요.");
  const fixedChars = fixedIds.map((id) => characterOf.get(id));
  if (new Set(fixedChars).size !== fixedChars.length) {
    throw new RecommendError("같은 캐릭터의 카드는 한 덱에 한 장만 넣을 수 있어서, 같은 캐릭터 카드를 두 장 고정할 수 없어요.");
  }
  const fixedLeader = input.fixedLeaderId && fixedIds.includes(Number(input.fixedLeaderId)) ? Number(input.fixedLeaderId) : null;

  // 고정 캐릭터 확인 (카드를 고정한 캐릭터는 빼고, 리더 캐릭터는 고정 캐릭터에 포함)
  const ownedChars = new Set(userCards.map((c) => characterOf.get(c.cardId)));
  const fixedCharIds = Array.from(new Set((input.fixedCharacterIds ?? []).map(Number))).filter(
    (ch) => ownedChars.has(ch) && !fixedChars.includes(ch),
  );
  const leaderChar =
    fixedLeader === null && input.fixedLeaderCharacterId && ownedChars.has(Number(input.fixedLeaderCharacterId))
      ? Number(input.fixedLeaderCharacterId)
      : null;
  if (leaderChar !== null && fixedChars.includes(leaderChar)) {
    throw new RecommendError("리더로 고정한 캐릭터의 카드를 이미 고정했어요. 그 카드를 리더로 고정해 주세요.");
  }
  if (leaderChar !== null && !fixedCharIds.includes(leaderChar)) fixedCharIds.push(leaderChar);
  if (fixedIds.length + fixedCharIds.length > 5) throw new RecommendError("카드와 캐릭터를 합쳐 5개까지 고정할 수 있어요.");

  const decks = await findDecks(
    provider,
    input.eventId,
    liveType,
    musicMeta,
    userCards,
    { cards: fixedIds, leader: fixedLeader, characters: fixedCharIds, leaderCharacter: leaderChar },
    chapterChar,
  );

  return {
    eventId: input.eventId,
    liveType: liveType === LiveType.CHEERFUL ? "cheerful" : input.liveType,
    metaSource,
    musicTime: Math.round(musicMeta.music_time * 10) / 10,
    musicTimeSource,
    averagedSongs,
    worldBloomCharacterId: chapterChar,
    musicId: metaSource === "average" ? RANDOM_MUSIC_ID : musicMeta.music_id,
    difficulty: musicMeta.difficulty,
    decks: decks.map((d) => ({
      eventPoint: d.score,
      liveScore: LiveCalculator.getLiveScoreByDeck(d, musicMeta, liveType),
      power: d.power.total,
      powerDetail: {
        base: d.power.base,
        areaItemBonus: d.power.areaItemBonus,
        characterBonus: d.power.characterBonus,
        fixtureBonus: d.power.fixtureBonus,
        gateBonus: d.power.gateBonus,
        honorBonus: d.power.honorBonus,
        total: d.power.total,
      },
      eventBonus: d.eventBonus ?? 0,
      cards: d.cards.map((c) => ({
        cardId: c.cardId,
        masterRank: c.masterRank,
        skillScoreUp: c.skill.scoreUp,
        eventBonus: Number(c.eventBonus ?? 0),
        power: c.power.total,
        powerDetail: {
          base: c.power.base,
          areaItemBonus: c.power.areaItemBonus,
          characterBonus: c.power.characterBonus,
          fixtureBonus: c.power.fixtureBonus,
          gateBonus: c.power.gateBonus,
          total: c.power.total,
        },
      })),
    })),
  };
}

export class RecommendError extends Error {}

/**
 * 덱 찾기: 이벤트 설정과 보유 카드 상세를 만들고, 빠른 탐색(lib/deckSearch.ts)으로 좋은 덱 3개를 고른다.
 * 고정 카드·캐릭터·리더 조건과 월드 링크 챕터도 이 탐색에서 함께 처리한다.
 */
async function findDecks(
  provider: DataProvider,
  eventId: number,
  liveType: LiveType,
  musicMeta: MusicMeta,
  userCards: UserCard[],
  spec: SearchSpec,
  chapterChar: number | undefined,
): Promise<ScoredDeck[]> {
  const eventConfig = await new EventService(provider).getEventConfig(eventId, chapterChar);
  if (eventConfig.eventType === undefined) throw new RecommendError("이벤트 종류를 알 수 없어요.");
  const pointOf = EventCalculator.getEventPointFunction(liveType, eventConfig.eventType);
  const honorBonus = await new DeckCalculator(provider).getHonorBonusPower();
  const areaItemLevels = await new AreaItemService(provider).getAreaItemLevels();
  const allCards = await new CardCalculator(provider).batchGetCardDetail(userCards, {}, eventConfig, areaItemLevels);

  // 월드 링크: 라이브러리와 같이 그 유닛 카드(버추얼 싱어 포함)만 후보로
  const unit = eventConfig.worldBloomSupportUnit ?? eventConfig.eventUnit;
  const pool = unit
    ? allCards.filter((c) => (c.units.length === 1 && c.units[0] === "piapro") || c.units.includes(unit))
    : allCards;

  // 월드 링크 파이널: 리더를 따로 정하지 않았으면 그 회차 캐릭터가 리더
  let s = spec;
  const special = eventConfig.worldBloomType === "finale" ? eventConfig.specialCharacterId : undefined;
  if (special && s.leader === null && s.leaderCharacter === null && allCards.some((c) => c.characterId === special)) {
    const fixedOfSpecial = s.cards.find((id) => allCards.find((c) => c.cardId === id)?.characterId === special);
    s =
      fixedOfSpecial !== undefined
        ? { ...s, leader: fixedOfSpecial }
        : {
            ...s,
            leaderCharacter: special,
            characters: s.characters.includes(special) ? s.characters : [...s.characters, special],
          };
  }

  try {
    return searchDecks(
      { pool, allCards, honorBonus, eventConfig, score: (d) => pointOf(musicMeta, d), timeLimitMs: SEARCH_BUDGET_MS },
      s,
    );
  } catch (e) {
    if (e instanceof DeckSearchError) throw new RecommendError(e.message);
    throw e;
  }
}

/**
 * 공방 랜덤 곡용: 그 서버에 나온 곡들의 같은 난이도 곡 데이터를 평균낸 가상의 곡.
 * 이벤트 포인트는 곡 데이터 값에 거의 비례해서, 평균 곡으로 계산한 값이 랜덤 곡일 때의 기대값과 거의 같다.
 */
async function averageMusicMeta(
  metas: MusicMeta[],
  difficulty: string,
  region: Region,
): Promise<{ meta: MusicMeta; count: number } | null> {
  const musics = await getMasterFile<{ id: number; publishedAt: number }>("musics", region);
  const now = Date.now();
  const released = new Set(musics.filter((m) => m.publishedAt <= now).map((m) => m.id));
  const pool = metas.filter((m) => m.difficulty === difficulty && released.has(m.music_id) && m.music_time > 0);
  if (pool.length === 0) return null;
  const mean = (f: (m: MusicMeta) => number) => pool.reduce((s, m) => s + f(m), 0) / pool.length;
  const meanArr = (f: (m: MusicMeta) => number[]) => [0, 1, 2, 3, 4, 5].map((i) => mean((m) => f(m)[i] ?? 0));
  return {
    count: pool.length,
    meta: {
      music_id: FALLBACK_META.music_id,
      difficulty,
      music_time: mean((m) => m.music_time),
      event_rate: mean((m) => m.event_rate),
      base_score: mean((m) => m.base_score),
      base_score_auto: mean((m) => m.base_score_auto),
      skill_score_solo: meanArr((m) => m.skill_score_solo),
      skill_score_auto: meanArr((m) => m.skill_score_auto),
      skill_score_multi: meanArr((m) => m.skill_score_multi),
      fever_score: mean((m) => m.fever_score),
      fever_end_time: mean((m) => m.fever_end_time),
      tap_count: Math.round(mean((m) => m.tap_count)),
    },
  };
}

/**
 * 곡 데이터가 없는 곡(한국판 오리지널 등)의 메타 추정.
 * 같은 난이도에서 곡 길이가 가장 비슷한 곡 15개의 값을 평균낸다.
 * 곡 길이를 모르면 노트 수 ÷ 같은 난이도의 일반적인 노트 밀도로 추정한다.
 * (일본판 곡으로 검증 시 스킬 구간 점수 오차: 길이를 알 때 약 6%, 추정할 때 약 10%)
 */
async function estimateMusicMeta(
  metas: MusicMeta[],
  musicId: number,
  difficulty: string,
  musicTime: number | undefined,
  region: Region,
): Promise<{ meta: MusicMeta; timeSource: "input" | "known" | "estimated" } | null> {
  const difficulties = await getMasterFile<{ musicId: number; musicDifficulty: string; totalNoteCount: number }>(
    "musicDifficulties",
    region,
  );
  const notes = new Map(difficulties.map((d) => [`${d.musicId}:${d.musicDifficulty}`, d.totalNoteCount]));
  const noteCount = notes.get(`${musicId}:${difficulty}`);
  if (!noteCount) return null;

  const pool = (diff: string) =>
    metas.filter((m) => m.difficulty === diff && m.music_time > 0 && notes.has(`${m.music_id}:${diff}`));
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  // 곡 길이: 입력값 → 등록된 길이 → 이 곡의 여러 난이도에서 "노트 수 ÷ 일반적인 밀도"를 구한 중앙값
  let time = musicTime && musicTime > 10 ? musicTime : KNOWN_MUSIC_TIMES[musicId];
  const timeSource = musicTime && musicTime > 10 ? "input" : time !== undefined ? "known" : "estimated";
  if (time === undefined) {
    const guesses: number[] = [];
    for (const diff of ["hard", "expert", "master"]) {
      const n = notes.get(`${musicId}:${diff}`);
      const p = pool(diff);
      if (!n || p.length === 0) continue;
      const density = median(p.map((m) => notes.get(`${m.music_id}:${diff}`)! / m.music_time));
      guesses.push(n / density);
    }
    if (guesses.length === 0) return null;
    time = median(guesses);
  }

  const candidates = pool(difficulty);
  if (candidates.length < 5) return null;
  const near = candidates
    .map((m) => ({ m, d: Math.abs(Math.log(m.music_time / time!)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 15)
    .map((x) => x.m);
  const mean = (f: (m: MusicMeta) => number) => avg(near.map(f));
  const meanArr = (f: (m: MusicMeta) => number[]) => [0, 1, 2, 3, 4, 5].map((i) => mean((m) => f(m)[i] ?? 0));

  return {
    timeSource,
    meta: {
      music_id: musicId,
      difficulty,
      music_time: time,
      event_rate: 100,
      base_score: mean((m) => m.base_score),
      base_score_auto: mean((m) => m.base_score_auto),
      skill_score_solo: meanArr((m) => m.skill_score_solo),
      skill_score_auto: meanArr((m) => m.skill_score_auto),
      skill_score_multi: meanArr((m) => m.skill_score_multi),
      fever_score: mean((m) => m.fever_score),
      fever_end_time: mean((m) => m.fever_end_time / m.music_time) * time,
      tap_count: Math.round(mean((m) => m.tap_count / notes.get(`${m.music_id}:${difficulty}`)!) * noteCount),
    },
  };
}

/** 내실 입력값을 라이브러리 유저 데이터 형식으로 변환. 마스터에 없는 레벨은 가장 가까운 유효 값으로 맞춤 */
async function buildGrowthUserData(growth: Growth, eventId: number, region: Region) {
  const [areaItemLevels, gateLevels, honors, eventHonorBonuses] = await Promise.all([
    getMasterFile<{ areaItemId: number; level: number }>("areaItemLevels", region),
    getMasterFile<{ mysekaiGateId: number; level: number }>("mysekaiGateLevels", region),
    getMasterFile<{ id: number; levels?: { level: number; bonus: number }[] }>("honors", region),
    getMasterFile<{ eventId: number; honorId: number }>("eventHonorBonuses", region),
  ]);
  const itemMax = new Map<number, number>();
  for (const l of areaItemLevels) itemMax.set(l.areaItemId, Math.max(itemMax.get(l.areaItemId) ?? 0, l.level));
  const gateMax = new Map<number, number>();
  for (const l of gateLevels) gateMax.set(l.mysekaiGateId, Math.max(gateMax.get(l.mysekaiGateId) ?? 0, l.level));

  const areaItems = Object.entries(growth.areaItems ?? {})
    .map(([id, lv]) => ({ areaItemId: Number(id), level: Math.min(Math.round(Number(lv)), itemMax.get(Number(id)) ?? 0) }))
    .filter((it) => it.level >= 1);

  const gates = Object.entries(growth.gates ?? {})
    .map(([id, lv]) => ({ mysekaiGateId: Number(id), mysekaiGateLevel: Math.min(Math.round(Number(lv)), gateMax.get(Number(id)) ?? 0) }))
    .filter((g) => g.mysekaiGateLevel >= 1);

  // 가구 보너스: 라이브러리는 0.1% 단위 정수를 사용
  const fixtures = Object.entries(growth.fixtures ?? {})
    .map(([id, rate]) => ({ gameCharacterId: Number(id), totalBonusRate: Math.round(Number(rate) * 10) }))
    .filter((f) => f.gameCharacterId >= 1 && f.gameCharacterId <= 26 && f.totalBonusRate > 0);

  // 칭호: 종합력 보너스 칭호와 이번 이벤트 리더 보너스 칭호만 사용. 마스터에 있는 레벨로만 맞춤
  const honorLevels = new Map(honors.map((h) => [h.id, (h.levels ?? []).map((l) => l.level)]));
  const powerHonorIds = new Set(honors.filter((h) => h.levels?.some((l) => l.bonus > 0)).map((h) => h.id));
  const eventHonorIds = new Set(eventHonorBonuses.filter((b) => b.eventId === eventId).map((b) => b.honorId));
  const userHonors = Object.entries(growth.honors ?? {})
    .map(([id, lv]) => ({ honorId: Number(id), level: Math.round(Number(lv)) }))
    .filter((h) => powerHonorIds.has(h.honorId) || eventHonorIds.has(h.honorId))
    .map((h) => {
      const levels = honorLevels.get(h.honorId) ?? [];
      if (levels.length === 0) return null;
      const level = levels.includes(h.level) ? h.level : Math.max(...levels.filter((l) => l <= h.level), levels[0]);
      return { honorId: h.honorId, level };
    })
    .filter((h): h is { honorId: number; level: number } => h !== null);

  return {
    userHonors,
    userAreas: areaItems.length > 0 ? [{ areaId: 0, areaItems }] : [],
    userMysekaiGates: gates,
    userMysekaiFixtureGameCharacterPerformanceBonuses: fixtures,
  };
}

const MAX_LEVEL: Record<string, number> = {
  rarity_1: 20,
  rarity_2: 30,
  rarity_3: 50,
  rarity_4: 60,
  rarity_birthday: 60,
};
