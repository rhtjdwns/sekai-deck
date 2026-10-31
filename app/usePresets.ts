"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { emptyGrowth, loadStore, newPreset, saveStore, type Growth, type OwnedCard, type Preset } from "@/lib/presets";

export function usePresets() {
  const [ready, setReady] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activeId, setActiveId] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);

  // 서버 렌더링과 어긋나지 않도록 브라우저에서만 불러옴
  useEffect(() => {
    const store = loadStore();
    setPresets(store.presets);
    setActiveId(store.activeId);
    setReady(true);
  }, []);

  // 바뀔 때마다 자동 저장
  useEffect(() => {
    if (!ready) return;
    setSaveFailed(!saveStore(activeId, presets));
  }, [ready, activeId, presets]);

  const active = useMemo(
    () => presets.find((p) => p.id === activeId) ?? presets[0],
    [presets, activeId],
  );

  const updateActive = useCallback(
    (fn: (cards: Record<number, OwnedCard>) => Record<number, OwnedCard>) => {
      setPresets((list) =>
        list.map((p) => (p.id === activeId ? { ...p, cards: fn(p.cards), updatedAt: Date.now() } : p)),
      );
    },
    [activeId],
  );

  const toggleOwned = useCallback(
    (cardId: number, canTrain: boolean) =>
      updateActive((cards) => {
        const next = { ...cards };
        if (next[cardId]) delete next[cardId];
        else next[cardId] = { trained: canTrain, masterRank: 0, skillLevel: 1, storyFirst: true, storySecond: true };
        return next;
      }),
    [updateActive],
  );

  const setOwnedDetail = useCallback(
    (cardId: number, detail: Partial<OwnedCard>) =>
      updateActive((cards) =>
        cards[cardId] ? { ...cards, [cardId]: { ...cards[cardId], ...detail } } : cards,
      ),
    [updateActive],
  );

  /** 여러 장 한꺼번에 체크/해제 */
  const setManyOwned = useCallback(
    (items: { id: number; canTrain: boolean }[], owned: boolean) =>
      updateActive((cards) => {
        const next = { ...cards };
        for (const { id, canTrain } of items) {
          if (owned && !next[id]) next[id] = { trained: canTrain, masterRank: 0, skillLevel: 1, storyFirst: true, storySecond: true };
          if (!owned) delete next[id];
        }
        return next;
      }),
    [updateActive],
  );

  /** 보유 중인 여러 장의 특훈·마스터 랭크·스킬 레벨을 한꺼번에 변경 */
  const setManyDetail = useCallback(
    (ids: number[], detail: Partial<OwnedCard>) =>
      updateActive((cards) => {
        const next = { ...cards };
        for (const id of ids) if (next[id]) next[id] = { ...next[id], ...detail };
        return next;
      }),
    [updateActive],
  );

  /** 여러 장을 보유로 넣고 상세 값을 통째로 지정 (스크린샷 가져오기용) */
  const upsertMany = useCallback(
    (entries: { id: number; detail: OwnedCard }[]) =>
      updateActive((cards) => {
        const next = { ...cards };
        for (const { id, detail } of entries) next[id] = detail;
        return next;
      }),
    [updateActive],
  );

  /** 캐릭터 랭크 저장. null이면 입력 지움 (계산 시 1로 취급) */
  const setCharacterRank = useCallback(
    (characterId: number, rank: number | null) =>
      setPresets((list) =>
        list.map((p) => {
          if (p.id !== activeId) return p;
          const next = { ...(p.characterRanks ?? {}) };
          if (rank === null) delete next[characterId];
          else next[characterId] = rank;
          return { ...p, characterRanks: next, updatedAt: Date.now() };
        }),
      ),
    [activeId],
  );

  /** 내실 값 변경 */
  const updateGrowth = useCallback(
    (fn: (growth: Growth) => Growth) =>
      setPresets((list) =>
        list.map((p) =>
          p.id === activeId ? { ...p, growth: fn({ ...emptyGrowth(), ...p.growth }), updatedAt: Date.now() } : p,
        ),
      ),
    [activeId],
  );

  const createPreset = useCallback(
    (
      name?: string,
      cards: Record<number, OwnedCard> = {},
      characterRanks: Record<number, number> = {},
      growth: Growth = emptyGrowth(),
    ) => {
      const p = { ...newPreset(name ?? `프리셋 ${presets.length + 1}`), cards, characterRanks, growth };
      setPresets((list) => [...list, p]);
      setActiveId(p.id);
    },
    [presets.length],
  );

  const renameActive = useCallback(
    (name: string) =>
      setPresets((list) => list.map((p) => (p.id === activeId ? { ...p, name } : p))),
    [activeId],
  );

  const deleteActive = useCallback(() => {
    const rest = presets.filter((p) => p.id !== activeId);
    const next = rest.length > 0 ? rest : [newPreset("내 카드")];
    setPresets(next);
    setActiveId(next[0].id);
  }, [presets, activeId]);

  return {
    ready,
    presets,
    active,
    saveFailed,
    selectPreset: setActiveId,
    toggleOwned,
    setOwnedDetail,
    setManyOwned,
    setManyDetail,
    upsertMany,
    setCharacterRank,
    updateGrowth,
    createPreset,
    renameActive,
    deleteActive,
  };
}
