// 덱 탐색 (서버 전용). 라이브러리의 전체 탐색은 보유 카드가 많고 보너스 캐릭터가 여러 유닛에 흩어진 이벤트에서
// 몇 분씩 걸려 서버가 멈추는 일이 있어서, 직접 만든 빠른 탐색을 쓴다.
// 방법: 여러 기준(이벤트 보너스, 종합력, 스킬)으로 시작 덱을 만들고, 한 자리씩 다른 카드로 바꿔 보며
// 이벤트 포인트가 오르는 동안 계속 바꾼다(언덕 오르기). 바꿔 보는 중에 본 덱도 모두 후보로 모아 상위 덱을 고른다.
// 과거 이벤트로 비교했을 때 라이브러리 결과보다 낮은 경우가 없었고, 보너스 캐릭터가 흩어진 이벤트에서는 더 좋은 덱을 찾기도 했다.
import { CardCalculator, DeckCalculator, type CardDetail, type DeckDetail, type EventConfig } from "sekai-calculator";

export type ScoredDeck = DeckDetail & { score: number };

export interface SearchSpec {
  /** 꼭 넣을 카드 */
  cards: number[];
  /** 리더 자리에 고정할 카드 (cards 중 하나) */
  leader: number | null;
  /** 꼭 넣을 캐릭터 (그 캐릭터 카드 중 가장 좋은 것을 고름) */
  characters: number[];
  /** 리더로 고정할 캐릭터 (characters 중 하나) */
  leaderCharacter: number | null;
}

export interface SearchContext {
  /** 후보 카드 (월드 링크 유닛 등으로 걸러진 것) */
  pool: CardDetail[];
  /** 보유 카드 전체 (서포트 덱 보너스 계산용) */
  allCards: CardDetail[];
  honorBonus: number;
  eventConfig: EventConfig;
  /** 덱 상세 → 이벤트 포인트 */
  score: (deck: DeckDetail) => number;
  /** 이 시간이 지나면 그때까지 찾은 덱으로 끝냄 */
  timeLimitMs?: number;
}

export class DeckSearchError extends Error {}

/** 같은 캐릭터 카드 중 모든 면(종합력·스킬·이벤트 보너스)에서 다른 카드보다 약한 카드는 뺌 (같은 카드는 하나만 남김) */
function dropDominated(cards: CardDetail[]): CardDetail[] {
  const byChar = new Map<number, CardDetail[]>();
  for (const c of cards) byChar.set(c.characterId, [...(byChar.get(c.characterId) ?? []), c]);
  const out: CardDetail[] = [];
  for (const list of byChar.values()) {
    out.push(
      ...list.filter(
        (a, i) =>
          !list.some(
            (b, j) => j !== i && CardCalculator.isCertainlyLessThan(a, b) && !(CardCalculator.isCertainlyLessThan(b, a) && j > i),
          ),
      ),
    );
  }
  return out;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
// 카드 상세 값(조건별 값 묶음)의 최댓값
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const maxOf = (m: any) => num(m?.max);

export function searchDecks(ctx: SearchContext, spec: SearchSpec, limit = 3): ScoredDeck[] {
  const deadline = Date.now() + (ctx.timeLimitMs ?? 20_000);
  const byId = new Map(ctx.allCards.map((c) => [c.cardId, c]));
  const fixedCards = spec.cards.map((id) => byId.get(id)).filter((c): c is CardDetail => Boolean(c));
  const fixedCardChars = new Set(fixedCards.map((c) => c.characterId));
  const charSlots = spec.characters.filter((ch) => !fixedCardChars.has(ch));
  const blocked = new Set([...fixedCardChars, ...charSlots]);
  const freeCount = 5 - fixedCards.length - charSlots.length;
  if (freeCount < 0) throw new DeckSearchError("카드와 캐릭터를 합쳐 5개까지 고정할 수 있어요.");

  const pool = dropDominated(ctx.pool);
  const freePool = pool.filter((c) => !blocked.has(c.characterId));
  const charPool = new Map(
    charSlots.map((ch) => {
      const own = pool.filter((c) => c.characterId === ch);
      return [ch, own.length ? own : dropDominated(ctx.allCards.filter((c) => c.characterId === ch))] as const;
    }),
  );
  for (const [ch, list] of charPool) {
    if (list.length === 0) throw new DeckSearchError(`고정한 캐릭터(${ch})의 보유 카드가 없어요.`);
  }
  const freeChars = new Set(freePool.map((c) => c.characterId)).size;
  if (freeChars < freeCount) {
    throw new DeckSearchError(
      blocked.size > 0
        ? `고정한 카드·캐릭터 말고 다른 캐릭터의 카드가 ${freeCount}명 더 필요해요. 지금은 ${freeChars}명이에요.`
        : `같은 캐릭터는 한 덱에 한 장만 넣을 수 있어서, 서로 다른 캐릭터의 카드가 5명 이상 필요해요. 지금은 ${freeChars}명이에요.`,
    );
  }

  // ---- 덱 평가 (리더 자리 정리 포함) ----
  const detailOf = (order: CardDetail[]) =>
    DeckCalculator.getDeckDetailByCards(
      order,
      ctx.allCards,
      ctx.honorBonus,
      ctx.eventConfig.cardBonusCountLimit,
      ctx.eventConfig.worldBloomDifferentAttributeBonuses,
    );
  const evaluate = (deck: CardDetail[]): { detail: DeckDetail; score: number } | null => {
    let order = [...deck];
    const leaderIdx =
      spec.leader !== null
        ? order.findIndex((c) => c.cardId === spec.leader)
        : spec.leaderCharacter !== null
          ? order.findIndex((c) => c.characterId === spec.leaderCharacter)
          : -1;
    if (leaderIdx > 0) [order[0], order[leaderIdx]] = [order[leaderIdx], order[0]];
    let detail = detailOf(order);
    if (leaderIdx < 0) {
      // 리더를 정하지 않았으면 스킬 효과가 가장 큰 카드를 리더로
      let best = 0;
      detail.cards.forEach((c, i) => {
        if (c.skill.scoreUp > detail.cards[best].skill.scoreUp) best = i;
      });
      if (best !== 0) {
        order = [...order];
        [order[0], order[best]] = [order[best], order[0]];
        detail = detailOf(order);
      }
    }
    const score = ctx.score(detail);
    return Number.isFinite(score) ? { detail, score } : null;
  };

  // deck 배열: [고정 카드..., 캐릭터 고정 칸..., 자유 칸...]
  const nFixed = fixedCards.length;
  const nChar = charSlots.length;
  const keyOf = (deck: CardDetail[]) =>
    deck
      .map((c) => c.cardId)
      .sort((a, b) => a - b)
      .join(",");
  const found = new Map<string, { deck: CardDetail[]; score: number }>();
  const record = (deck: CardDetail[]): number => {
    const key = keyOf(deck);
    const hit = found.get(key);
    if (hit) return hit.score;
    const r = evaluate(deck);
    const s = r ? r.score : -Infinity;
    found.set(key, { deck, score: s });
    return s;
  };

  const climb = (start: CardDetail[]) => {
    let deck = start;
    let best = record(deck);
    let improved = true;
    while (improved && Date.now() < deadline) {
      improved = false;
      for (let i = nFixed; i < 5; i++) {
        const isCharSlot = i < nFixed + nChar;
        const candidates = isCharSlot ? charPool.get(charSlots[i - nFixed])! : freePool;
        const used = new Set(deck.filter((_, j) => j !== i).map((c) => c.characterId));
        for (const c of candidates) {
          if (c === deck[i] || (!isCharSlot && used.has(c.characterId))) continue;
          const next = [...deck];
          next[i] = c;
          const s = record(next);
          if (s > best + 1e-9) {
            best = s;
            deck = next;
            improved = true;
          }
        }
      }
    }
  };

  // ---- 시작 덱: 여러 기준으로 정렬해 상위 카드부터 채움 ----
  const P = (c: CardDetail) => maxOf(c.power);
  const B = (c: CardDetail) => maxOf(c.eventBonus);
  const S = (c: CardDetail) => maxOf(c.skill);
  const orders: ((a: CardDetail, b: CardDetail) => number)[] = [
    (a, b) => B(b) - B(a) || P(b) - P(a),
    (a, b) => P(b) - P(a),
    (a, b) => S(b) - S(a) || P(b) - P(a),
    (a, b) => B(b) * 2e5 + P(b) - (B(a) * 2e5 + P(a)),
  ];
  for (const order of orders) {
    const sortedFree = [...freePool].sort(order);
    const charPicks = charSlots.map((ch) => [...charPool.get(ch)!].sort(order)[0]);
    for (let offset = 0; offset < 6 && Date.now() < deadline; offset++) {
      const deck = [...fixedCards, ...charPicks];
      const used = new Set(deck.map((c) => c.characterId));
      for (const c of sortedFree.slice(offset)) {
        if (deck.length === 5) break;
        if (!used.has(c.characterId)) {
          deck.push(c);
          used.add(c.characterId);
        }
      }
      if (deck.length === 5) climb(deck);
    }
  }

  const ranked = [...found.values()].filter((f) => f.score > -Infinity).sort((a, b) => b.score - a.score);
  if (ranked.length === 0) throw new DeckSearchError("조건에 맞는 덱을 찾지 못했어요.");
  return ranked.slice(0, limit).map(({ deck, score }) => Object.assign(evaluate(deck)!.detail, { score }));
}
