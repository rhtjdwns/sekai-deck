"use client";

import { useEffect, useState } from "react";
import { loadStore } from "@/lib/presets";

/** 메인 화면에 현재 프리셋 상태를 한 줄로 표시 */
export default function OwnedSummary() {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const { presets, activeId } = loadStore();
    const active = presets.find((p) => p.id === activeId) ?? presets[0];
    const count = Object.keys(active.cards).length;
    setText(
      count === 0
        ? "아직 체크한 카드가 없어요. 여기서 시작하세요."
        : `"${active.name}" 프리셋에 ${count}장 저장됨${presets.length > 1 ? ` (프리셋 ${presets.length}개)` : ""}`,
    );
  }, []);

  if (!text) return null;
  return <span className="choice-meta">{text}</span>;
}
