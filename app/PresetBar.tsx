"use client";

import { useRef, useState } from "react";
import { parseImport, toExportJson, type Preset } from "@/lib/presets";
import type { usePresets } from "./usePresets";

type PresetApi = ReturnType<typeof usePresets>;

export default function PresetBar({
  api,
  validCardIds,
}: {
  api: PresetApi;
  validCardIds: Set<number>;
}) {
  const { presets, active, saveFailed } = api;
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!active) return null;
  const ownedCount = Object.keys(active.cards).length;

  const exportActive = (preset: Preset) => {
    const blob = new Blob([toExportJson(preset)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${preset.name || "preset"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage(`"${preset.name}" 파일을 내보냈습니다.`);
  };

  const importFile = async (file: File) => {
    try {
      const { name, cards, characterRanks, growth } = parseImport(await file.text(), validCardIds);
      const count = Object.keys(cards).length;
      if (count === 0) {
        setMessage("파일에서 이 서버의 카드를 찾지 못했습니다. 다른 서버의 프리셋 파일인지 확인해 주세요.");
        return;
      }
      api.createPreset(name, cards, characterRanks, growth);
      setMessage(`"${name}" 프리셋으로 ${count}장을 가져왔습니다.`);
    } catch (e) {
      setMessage(e instanceof SyntaxError ? "JSON 파일을 읽지 못했습니다." : (e as Error).message);
    }
  };

  return (
    <section className="presets" aria-label="보유 카드 프리셋">
      <div className="preset-row">
        <label className="field">
          <span>프리셋</span>
          <select value={active.id} onChange={(e) => api.selectPreset(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || "이름 없음"} ({Object.keys(p.cards).length}장)
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>이름</span>
          <input
            type="text"
            value={active.name}
            maxLength={30}
            onChange={(e) => api.renameActive(e.target.value)}
          />
        </label>

        <div className="preset-actions">
          <button type="button" onClick={() => api.createPreset()}>
            새 프리셋
          </button>
          <button type="button" onClick={() => exportActive(active)} disabled={ownedCount === 0}>
            내보내기
          </button>
          <button type="button" onClick={() => fileRef.current?.click()}>
            가져오기
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (confirm(`"${active.name}" 프리셋을 삭제할까요? 체크한 ${ownedCount}장이 사라집니다.`)) {
                api.deleteActive();
                setMessage("프리셋을 삭제했습니다.");
              }
            }}
          >
            삭제
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <p className="preset-status" aria-live="polite">
        <strong>보유 {ownedCount}장</strong>
        <span className={saveFailed ? "warn" : undefined}>
          {saveFailed
            ? "브라우저 저장이 막혀 있어 새로고침하면 사라집니다. 내보내기로 파일을 받아 두세요."
            : "이 브라우저에 자동 저장됩니다."}
        </span>
        {message && <span className="preset-msg">{message}</span>}
      </p>
    </section>
  );
}
