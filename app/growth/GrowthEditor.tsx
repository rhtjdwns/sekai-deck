"use client";

import type { CSSProperties, ReactNode } from "react";
import type { Attr, Character, Unit } from "@/lib/master";
import type { AreaItemInfo, GrowthMaster, HonorInfo } from "@/lib/growth";
import { emptyGrowth, type Growth } from "@/lib/presets";
import { usePresets } from "../usePresets";
import AreaItemShotImport from "./AreaItemShotImport";

const ATTRS: { attr: Attr; label: string }[] = [
  { attr: "cute", label: "큐트" },
  { attr: "cool", label: "쿨" },
  { attr: "pure", label: "퓨어" },
  { attr: "happy", label: "해피" },
  { attr: "mysterious", label: "미스테리어스" },
];

type Units = { unit: Unit; name: string }[];

export default function GrowthEditor({
  characters,
  units,
  master,
}: {
  characters: Character[];
  units: Units;
  master: GrowthMaster;
}) {
  const { ready, presets, active, selectPreset, updateGrowth, setCharacterRank } = usePresets();
  if (!ready || !active) return <main className="page" />;

  const growth: Growth = { ...emptyGrowth(), ...active.growth };
  const ranks = active.characterRanks ?? {};
  // 캐릭터 랭크 보너스 표: 한 단계 증가량, 최대 보너스와 그 보너스에 처음 닿는 랭크
  const rankRates = master.characterRankRates;
  const rankMaxRate = Math.max(0, ...rankRates.filter((v) => v !== undefined));
  const rankCap = Math.max(1, rankRates.findIndex((v) => v === rankMaxRate));
  const rankStep = rankRates[1] ?? 0;
  const unitName = (u?: Unit) => units.find((x) => x.unit === u)?.name ?? "";

  const setItem = (id: number, level: number) =>
    updateGrowth((g) => {
      const areaItems = { ...g.areaItems };
      if (level > 0) areaItems[id] = level;
      else delete areaItems[id];
      return { ...g, areaItems };
    });
  const setItems = (items: AreaItemInfo[], toMax: boolean) =>
    updateGrowth((g) => {
      const areaItems = { ...g.areaItems };
      for (const it of items) {
        if (toMax) areaItems[it.id] = it.maxLevel;
        else delete areaItems[it.id];
      }
      return { ...g, areaItems };
    });
  const setGate = (id: number, level: number) =>
    updateGrowth((g) => {
      const gates = { ...g.gates };
      if (level > 0) gates[id] = level;
      else delete gates[id];
      return { ...g, gates };
    });
  const setFixture = (characterId: number, rate: number | null) =>
    updateGrowth((g) => {
      const fixtures = { ...g.fixtures };
      if (rate && rate > 0) fixtures[characterId] = rate;
      else delete fixtures[characterId];
      return { ...g, fixtures };
    });

  const setHonor = (id: number, level: number) =>
    updateGrowth((g) => {
      const honors = { ...g.honors };
      if (level > 0) honors[id] = level;
      else delete honors[id];
      return { ...g, honors };
    });
  const honorBonus = (h: HonorInfo) => h.levels.find((l) => l.level === growth.honors[h.id])?.bonus ?? 0;
  const honorTotal = master.honors.reduce((sum, h) => sum + honorBonus(h), 0);
  const charName = (id: number) => characters.find((c) => c.id === id)?.name ?? "";

  /** 캐릭터 랭크·에어리어 아이템·게이트·칭호를 모두 최대로 (마이세카이 인형 보너스는 값이 정해져 있지 않아 그대로) */
  const maxAll = () => {
    if (
      !confirm(
        `"${active.name}" 프리셋의 캐릭터 랭크, 에어리어 아이템, 마이세카이 게이트, 칭호를 모두 최대로 채울까요? 마이세카이 인형 보너스는 그대로 둬요.`,
      )
    )
      return;
    for (const c of characters) setCharacterRank(c.id, master.maxCharacterRank);
    updateGrowth((g) => ({
      ...g,
      areaItems: Object.fromEntries(master.areaItems.map((it) => [it.id, it.maxLevel])),
      gates: Object.fromEntries(master.gates.map((x) => [x.id, x.maxLevel])),
      honors: {
        ...g.honors,
        ...Object.fromEntries(master.honors.map((h) => [h.id, h.levels[h.levels.length - 1].level])),
        ...Object.fromEntries(master.eventHonors.map((h) => [h.honorId, 1])),
      },
    }));
  };

  const charItems = master.areaItems.filter((i) => i.group === "character");
  const unitItems = master.areaItems.filter((i) => i.group === "unit");
  const attrItems = master.areaItems.filter((i) => i.group === "attr");
  const filled = (items: AreaItemInfo[]) => items.filter((i) => (growth.areaItems[i.id] ?? 0) > 0).length;

  return (
    <main className="page growth">
      <header className="masthead">
        <h1>내실</h1>
        <p className="sub">
          캐릭터 랭크, 에어리어 아이템, 마이세카이처럼 덱 종합력을 올려 주는 요소를 입력하세요. 에어리어 아이템은 게임
          스크린샷으로도 한 번에 입력할 수 있어요. 프리셋마다 따로 저장되고, 덱 편성
          도우미가 이 값으로 계산합니다.
        </p>
      </header>

      <section className="growth-preset">
        <label className="field">
          <span>프리셋</span>
          <select value={active.id} onChange={(e) => selectPreset(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || "이름 없음"}
              </option>
            ))}
          </select>
        </label>
        <div className="g-actions">
          <button type="button" onClick={maxAll}>
            전부 최대치로
          </button>
        </div>
        <p className="hint">
          0이나 빈칸은 아직 없는 아이템입니다. &quot;전부 최대치로&quot;는 캐릭터 랭크·에어리어 아이템·게이트·칭호를 한 번에
          최대로 채워요.
        </p>
      </section>

      <Section
        title="캐릭터 랭크"
        desc={`게임의 캐릭터 화면에 나오는 랭크를 입력하세요. 랭크가 오를수록 그 캐릭터 카드의 종합력이 올라가요(랭크 1마다 +${rankStep}%, 랭크 ${rankCap}에서 최대 +${rankMaxRate}%이고 그 위로는 같아요). 비워 둔 캐릭터는 1로 계산합니다.`}
        count={`${characters.filter((c) => ranks[c.id] !== undefined).length}/${characters.length}`}
        onMax={() => characters.forEach((c) => setCharacterRank(c.id, master.maxCharacterRank))}
        onClear={() => characters.forEach((c) => setCharacterRank(c.id, null))}
      >
        <div className="g-grid">
          {units.map((u) => (
            <fieldset key={u.unit} className="g-group">
              <legend>{u.name}</legend>
              {characters
                .filter((c) => c.unit === u.unit)
                .map((c) => (
                  <div key={c.id} className="g-row" style={{ "--char": c.color } as CSSProperties}>
                    <span className="g-label g-char">{c.name}</span>
                    <span className="g-level">
                      <span aria-hidden="true">Rank</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={master.maxCharacterRank}
                        placeholder="1"
                        className="g-input"
                        aria-label={`${c.name} 캐릭터 랭크`}
                        value={ranks[c.id] ?? ""}
                        onChange={(e) => {
                          if (e.target.value === "") return setCharacterRank(c.id, null);
                          const n = Math.round(Number(e.target.value));
                          if (Number.isFinite(n)) setCharacterRank(c.id, Math.min(master.maxCharacterRank, Math.max(1, n)));
                        }}
                      />
                      <span className="g-max">/{master.maxCharacterRank}</span>
                    </span>
                    <span className="g-bonus">
                      {ranks[c.id] !== undefined ? `+${master.characterRankRates[ranks[c.id]] ?? 0}%` : ""}
                    </span>
                  </div>
                ))}
            </fieldset>
          ))}
        </div>
      </Section>

      <AreaItemShotImport
        items={master.areaItems}
        current={growth.areaItems}
        onApply={(levels) =>
          updateGrowth((g) => {
            const areaItems = { ...g.areaItems };
            for (const [id, lv] of Object.entries(levels)) {
              if (lv > 0) areaItems[Number(id)] = lv;
              else delete areaItems[Number(id)];
            }
            return { ...g, areaItems };
          })
        }
      />

      <Section
        title="캐릭터 에어리어 아이템"
        desc="해당 캐릭터 카드의 종합력이 올라갑니다."
        count={`${filled(charItems)}/${charItems.length}`}
        onMax={() => setItems(charItems, true)}
        onClear={() => setItems(charItems, false)}
      >
        <div className="g-grid">
          {units.map((u) => {
            const members = characters.filter((c) => c.unit === u.unit);
            return (
              <fieldset key={u.unit} className="g-group">
                <legend>{u.name}</legend>
                {members.map((c) => {
                  const items = charItems.filter((i) => i.characterId === c.id);
                  return items.map((it) => (
                    <ItemRow
                      key={it.id}
                      color={c.color}
                      label={items.length > 1 ? `${c.name}, ${it.name}` : c.name}
                      sub={items.length > 1 ? undefined : it.name}
                      item={it}
                      level={growth.areaItems[it.id] ?? 0}
                      onChange={(lv) => setItem(it.id, lv)}
                    />
                  ));
                })}
              </fieldset>
            );
          })}
        </div>
      </Section>

      <Section
        title="유닛 에어리어 아이템"
        desc="해당 유닛 카드의 종합력이 올라갑니다. 덱이 한 유닛으로만 이뤄지면 효과가 커집니다."
        count={`${filled(unitItems)}/${unitItems.length}`}
        onMax={() => setItems(unitItems, true)}
        onClear={() => setItems(unitItems, false)}
      >
        <div className="g-grid">
          {units.map((u) => {
            const items = unitItems.filter((i) => i.unit === u.unit);
            if (items.length === 0) return null;
            return (
              <fieldset key={u.unit} className="g-group">
                <legend>{u.name}</legend>
                {items.map((it) => (
                  <ItemRow
                    key={it.id}
                    label={it.name}
                    item={it}
                    level={growth.areaItems[it.id] ?? 0}
                    onChange={(lv) => setItem(it.id, lv)}
                    showAllMatch
                  />
                ))}
              </fieldset>
            );
          })}
        </div>
      </Section>

      <Section
        title="타입 에어리어 아이템"
        desc="해당 속성 카드의 종합력이 올라갑니다. 덱이 한 속성으로만 이뤄지면 효과가 커집니다."
        count={`${filled(attrItems)}/${attrItems.length}`}
        onMax={() => setItems(attrItems, true)}
        onClear={() => setItems(attrItems, false)}
      >
        <div className="g-grid">
          {ATTRS.map(({ attr, label }) => (
            <fieldset key={attr} className={`g-group attr-border-${attr}`}>
              <legend>
                <span className={`attr-dot attr-${attr}`} aria-hidden="true" /> {label}
              </legend>
              {attrItems
                .filter((i) => i.attr === attr)
                .map((it) => (
                  <ItemRow
                    key={it.id}
                    label={it.name}
                    item={it}
                    level={growth.areaItems[it.id] ?? 0}
                    onChange={(lv) => setItem(it.id, lv)}
                    showAllMatch
                  />
                ))}
            </fieldset>
          ))}
        </div>
      </Section>

      <Section
        title="마이세카이 게이트"
        desc="게이트와 같은 유닛 카드의 종합력이 올라갑니다. 버추얼 싱어 카드는 가장 높은 게이트 효과를 받습니다."
        count={`${master.gates.filter((g) => (growth.gates[g.id] ?? 0) > 0).length}/${master.gates.length}`}
        onMax={() =>
          updateGrowth((g) => ({ ...g, gates: Object.fromEntries(master.gates.map((x) => [x.id, x.maxLevel])) }))
        }
        onClear={() => updateGrowth((g) => ({ ...g, gates: {} }))}
      >
        <div className="g-grid">
          {master.gates.map((gate) => {
            const level = growth.gates[gate.id] ?? 0;
            return (
              <div key={gate.id} className="g-row">
                <span className="g-label">
                  {unitName(gate.unit)}
                  <small>{gate.name}</small>
                </span>
                <LevelInput max={gate.maxLevel} value={level} onChange={(lv) => setGate(gate.id, lv)} />
                <span className="g-bonus">{level > 0 ? `+${gate.rates[level] ?? 0}%` : ""}</span>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="마이세카이 인형 보너스"
        desc="마이세카이 인형으로 얻은 캐릭터별 퍼포먼스 보너스(%)를 직접 입력하세요. 모르면 비워 두면 됩니다."
        count={`${Object.keys(growth.fixtures).length}/${characters.length}`}
        onClear={() => updateGrowth((g) => ({ ...g, fixtures: {} }))}
      >
        <div className="g-grid">
          {units.map((u) => (
            <fieldset key={u.unit} className="g-group">
              <legend>{u.name}</legend>
              {characters
                .filter((c) => c.unit === u.unit)
                .map((c) => (
                  <div key={c.id} className="g-row" style={{ "--char": c.color } as CSSProperties}>
                    <span className="g-label g-char">{c.name}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.1}
                      placeholder="0"
                      className="g-input"
                      aria-label={`${c.name} 인형 보너스(%)`}
                      value={growth.fixtures[c.id] ?? ""}
                      onChange={(e) => setFixture(c.id, e.target.value === "" ? null : Math.max(0, Number(e.target.value)))}
                    />
                    <span className="g-bonus">%</span>
                  </div>
                ))}
            </fieldset>
          ))}
        </div>
      </Section>

      <Section
        title="칭호 보너스"
        desc={`종합력 보너스가 붙는 칭호만 모았습니다. 가진 칭호를 체크하세요. 지금 합계 종합력 +${honorTotal.toLocaleString()}`}
        count={`${master.honors.filter((h) => (growth.honors[h.id] ?? 0) > 0).length}/${master.honors.length}`}
        onMax={() =>
          updateGrowth((g) => ({
            ...g,
            honors: {
              ...g.honors,
              ...Object.fromEntries(master.honors.map((h) => [h.id, h.levels[h.levels.length - 1].level])),
            },
          }))
        }
        onClear={() =>
          updateGrowth((g) => {
            const honors = { ...g.honors };
            for (const h of master.honors) delete honors[h.id];
            return { ...g, honors };
          })
        }
      >
        <div className="g-grid">
          {master.honors.map((h) => {
            const level = growth.honors[h.id] ?? 0;
            const single = h.levels.length === 1;
            const shown = h.levels.find((l) => l.level === level) ?? h.levels[0];
            return (
              <div key={h.id} className="g-row g-honor">
                <span className="g-label">
                  {h.name}
                  <small title={shown.description}>{shown.description}</small>
                </span>
                {single ? (
                  <label className="g-check">
                    <input
                      type="checkbox"
                      checked={level > 0}
                      onChange={(e) => setHonor(h.id, e.target.checked ? h.levels[0].level : 0)}
                    />
                    보유
                  </label>
                ) : (
                  <select
                    className="g-select"
                    value={level}
                    onChange={(e) => setHonor(h.id, Number(e.target.value))}
                    aria-label={`${h.name} 레벨`}
                  >
                    <option value={0}>없음</option>
                    {h.levels.map((l) => (
                      <option key={l.level} value={l.level}>
                        Lv {l.level}
                      </option>
                    ))}
                  </select>
                )}
                <span className="g-bonus">{level > 0 ? `+${honorBonus(h)}` : ""}</span>
              </div>
            );
          })}
        </div>
      </Section>

      {master.eventHonors.length > 0 && (
        <Section
          title="이번 이벤트 칭호 보너스"
          desc="이 칭호를 가지고 있으면, 해당 캐릭터를 리더로 했을 때 이벤트 보너스가 더 붙습니다."
          count={`${master.eventHonors.filter((h) => (growth.honors[h.honorId] ?? 0) > 0).length}/${master.eventHonors.length}`}
          onClear={() =>
            updateGrowth((g) => {
              const honors = { ...g.honors };
              for (const h of master.eventHonors) delete honors[h.honorId];
              return { ...g, honors };
            })
          }
        >
          <div className="g-grid">
            {master.eventHonors.map((h) => (
              <div key={`${h.honorId}-${h.leaderCharacterId}`} className="g-row g-honor">
                <span className="g-label">
                  {h.name}
                  <small>
                    리더 {charName(h.leaderCharacterId)}일 때 이벤트 보너스 +{h.bonusRate}%
                  </small>
                </span>
                <label className="g-check">
                  <input
                    type="checkbox"
                    checked={(growth.honors[h.honorId] ?? 0) > 0}
                    onChange={(e) => setHonor(h.honorId, e.target.checked ? 1 : 0)}
                  />
                  보유
                </label>
                <span className="g-bonus" />
              </div>
            ))}
          </div>
        </Section>
      )}

      <p className="assume">
        입력한 값은 이 브라우저에 자동 저장되고, 보유 카드 체크 화면의 내보내기 파일에도 함께 들어갑니다. 마이세카이 캔버스는
        카드마다 다르므로 보유 카드 체크 화면에서 카드별로 체크해요.
      </p>
    </main>
  );
}

function Section({
  title,
  desc,
  count,
  onMax,
  onClear,
  children,
}: {
  title: string;
  desc: string;
  count: string;
  onMax?: () => void;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <section className="g-section">
      <div className="g-head">
        <div>
          <h2>
            {title} <span className="g-count">{count}</span>
          </h2>
          <p className="sub">{desc}</p>
        </div>
        <div className="g-actions">
          {onMax && (
            <button type="button" onClick={onMax}>
              모두 최대 레벨
            </button>
          )}
          <button type="button" onClick={onClear}>
            모두 비우기
          </button>
        </div>
      </div>
      {children}
    </section>
  );
}

function ItemRow({
  label,
  sub,
  color,
  item,
  level,
  onChange,
  showAllMatch,
}: {
  label: string;
  sub?: string;
  color?: string;
  item: AreaItemInfo;
  level: number;
  onChange: (level: number) => void;
  showAllMatch?: boolean;
}) {
  const rate = item.rates[level] ?? 0;
  const all = item.allMatchRates[level] ?? 0;
  return (
    <div className={`g-row${color ? " g-char-row" : ""}`} style={color ? ({ "--char": color } as CSSProperties) : undefined}>
      <span className="g-label">
        {label}
        {sub && <small>{sub}</small>}
      </span>
      <LevelInput max={item.maxLevel} value={level} onChange={onChange} />
      <span className="g-bonus">
        {level > 0 ? (showAllMatch && all !== rate ? `+${rate}% (모두 일치 +${all}%)` : `+${rate}%`) : ""}
      </span>
    </div>
  );
}

function LevelInput({ max, value, onChange }: { max: number; value: number; onChange: (v: number) => void }) {
  return (
    <span className="g-level">
      <span aria-hidden="true">Lv</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        placeholder="0"
        className="g-input"
        aria-label={`레벨 (최대 ${max})`}
        value={value > 0 ? value : ""}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value));
          onChange(Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0);
        }}
      />
      <span className="g-max">/{max}</span>
    </span>
  );
}
