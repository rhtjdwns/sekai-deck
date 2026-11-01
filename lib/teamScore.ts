// 멀티·치어풀 라이브에서 팀원 4명의 종합력과 실효 스킬을 넣어 점수·이벤트 포인트를 계산 (서버 전용)
// 팀원을 입력하지 않은 자리는 내 덱과 같은 종합력·실효 스킬로 본다(라이브러리 기본 가정과 같음).
// 멀티 라이브 스킬: 1~5번째는 5명이 한 번씩(순서는 무작위라 평균으로 계산), 6번째는 5명 중 실효 스킬이 가장 높은 사람.
// 액티브 보너스(멀티만): 5명 종합력 합 × 0.015 × 5
import { EventCalculator, LiveCalculator, LiveType, type DeckDetail, type EventType, type MusicMeta } from "sekai-calculator";

export interface Teammate {
  /** 종합력 */
  power: number;
  /** 실효 스킬(%) */
  skill: number;
}

/** 내 덱의 실효 스킬: 리더 스킬 + 나머지 4명 스킬 합 × 0.2 */
export function deckEffectiveSkill(deck: DeckDetail) {
  return deck.cards.reduce((sum, c, i) => sum + (i === 0 ? c.skill.scoreUp : c.skill.scoreUp * 0.2), 0);
}

export function makeTeamScorer(liveType: LiveType, eventType: EventType, teammates: Teammate[]) {
  const live = (meta: MusicMeta, deck: DeckDetail) => {
    const ownPower = deck.power.total;
    const ownSkill = deckEffectiveSkill(deck);
    const mates = [0, 1, 2, 3].map((i) => teammates[i] ?? { power: ownPower, skill: ownSkill });
    const skills = [ownSkill, ...mates.map((m) => m.skill)];
    const avg = skills.reduce((a, b) => a + b, 0) / 5;
    const details = [
      ...Array.from({ length: 5 }, () => ({ scoreUp: avg, lifeRecovery: 0 })),
      { scoreUp: Math.max(...skills), lifeRecovery: 0 },
    ];
    const powerSum = ownPower + mates.reduce((a, m) => a + m.power, 0);
    const scoreFor = (power: number) =>
      LiveCalculator.getLiveDetailByDeck({ ...deck, power: { ...deck.power, total: power } }, meta, liveType, details, powerSum)
        .score;
    const self = scoreFor(ownPower);
    const others = mates.reduce((a, m) => a + scoreFor(m.power), 0);
    return { self, others };
  };
  return {
    liveScore: (meta: MusicMeta, deck: DeckDetail) => live(meta, deck).self,
    point: (meta: MusicMeta, deck: DeckDetail) => {
      const { self, others } = live(meta, deck);
      const bonus = (deck.eventBonus ?? 0) + (deck.supportDeckBonus ?? 0);
      return EventCalculator.getEventPoint(liveType, eventType, self, meta.event_rate, bonus, 1, others);
    },
  };
}
