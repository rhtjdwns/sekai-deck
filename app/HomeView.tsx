import Link from "next/link";
import { getMasterSnapshot } from "@/lib/master";
import { REGIONS, regionHref, type Region } from "@/lib/region";
import OwnedSummary from "./OwnedSummary";
import { TutorialStartButton } from "./Tutorial";
import "./home.css";

const ATTR_LABEL: Record<string, string> = {
  cute: "큐트",
  cool: "쿨",
  pure: "퓨어",
  happy: "해피",
  mysterious: "미스테리어스",
};

/** 첫 화면 (한국 서버 /, 일본 서버 /jp) */
export default async function HomeView({ region }: { region: Region }) {
  const { event, cards, characters } = await getMasterSnapshot(region);
  const href = (p: string) => regionHref(region, p);
  const charName = new Map(characters.map((c) => [c.id, c.name]));
  const bonusNames = event
    ? Array.from(new Set(event.bonusCharacters.map((b) => charName.get(b.characterId) ?? "")))
    : [];

  return (
    <main className="page home">
      <header className="home-head">
        <h1>세카이 덱 짜기</h1>
        <p className="sub">
          프로젝트 세카이 {REGIONS[region].label} 카드 {cards.length.toLocaleString()}장 중 내가 가진 카드로 이벤트 덱을
          짭니다.
        </p>
        <TutorialStartButton />
      </header>

      <ol className="choices">
        <li>
          <Link href={href("/cards")} className="choice">
            <span className="choice-step" aria-hidden="true">1</span>
            <span className="choice-body">
              <span className="choice-title">보유 카드 체크하기</span>
              <span className="choice-desc">
                가진 카드를 목록에서 눌러 체크하고, 특훈 여부와 마스터 랭크를 프리셋으로 저장합니다.
              </span>
              <OwnedSummary />
            </span>
          </Link>
        </li>
        <li>
          <Link href={href("/deck")} className="choice">
            <span className="choice-step" aria-hidden="true">2</span>
            <span className="choice-body">
              <span className="choice-title">덱 편성 도우미</span>
              <span className="choice-desc">저장한 프리셋으로 지금 진행 중인 이벤트에 맞는 덱을 찾습니다.</span>
              {event && (
                <span className="choice-meta">
                  <span className="choice-event">{event.name}</span>
                  <span>
                    보너스 {bonusNames.slice(0, 4).join(", ")}
                    {bonusNames.length > 4 && ` 외 ${bonusNames.length - 4}명`}
                    {event.bonusAttr && `, ${ATTR_LABEL[event.bonusAttr]} 속성`}
                  </span>
                </span>
              )}
            </span>
          </Link>
        </li>
        <li>
          <Link href={href("/growth")} className="choice">
            <span className="choice-step" aria-hidden="true">3</span>
            <span className="choice-body">
              <span className="choice-title">내실</span>
              <span className="choice-desc">
                캐릭터 랭크, 에어리어 아이템, 마이세카이 게이트처럼 종합력을 올려 주는 요소를 입력합니다.
              </span>
            </span>
          </Link>
        </li>
      </ol>
    </main>
  );
}
