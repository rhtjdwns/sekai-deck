// 덱 편성 도우미의 곡 목록 (서버 전용). 곡 제목은 한국어 번역을 우선 표시
import "server-only";
import { KNOWN_MUSIC_TIMES, getMasterFile, getMusicMetas } from "./recommend";
import type { Region } from "./region";

// Sekai Viewer 커뮤니티 번역 (한국어 곡 제목)
const KO_TITLES_URL = "https://raw.githubusercontent.com/Sekai-World/sekai-i18n/main/ko/music_titles.json";

/** 이벤트 효율곡: 혼자 놀이 엔비, 로스트 앤 파운드, 벚꽃비, Sage, 하츠네 천지개벽 신화 (그 서버에 없는 곡은 빠짐) */
export const EFFICIENT_SONG_IDS = [74, 226, 10004, 448, 186];

export interface SongOption {
  id: number;
  /** 화면에 보여줄 제목 (한국어 번역, 없으면 원제) */
  title: string;
  /** 점수 계산용 곡 데이터가 있는지 */
  hasMeta: boolean;
  /** 곡 데이터가 없는 곡의 알려진 길이(초) */
  knownTime?: number;
}

async function getKoreanTitles(): Promise<Record<string, string>> {
  try {
    const res = await fetch(KO_TITLES_URL, { next: { revalidate: false, tags: ["master"] } });
    if (!res.ok) return {};
    return (await res.json()) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function getSongOptions(region: Region = "kr"): Promise<{ efficient: SongOption[]; all: SongOption[] }> {
  const [musics, ko, metas] = await Promise.all([
    getMasterFile<{ id: number; title: string; publishedAt: number }>("musics", region),
    getKoreanTitles(),
    getMusicMetas(),
  ]);
  const now = Date.now();
  const metaIds = metas ? new Set(metas.map((m) => m.music_id)) : null;

  const all: SongOption[] = musics
    .filter((m) => m.publishedAt <= now)
    .map((m) => ({
      id: m.id,
      title: ko[String(m.id)]?.trim() || m.title,
      // 곡 데이터를 못 받아왔으면 판단할 수 없으니 있다고 봄
      hasMeta: metaIds ? metaIds.has(m.id) : true,
      knownTime: KNOWN_MUSIC_TIMES[m.id],
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "ko"));

  const byId = new Map(all.map((s) => [s.id, s]));
  const efficient = EFFICIENT_SONG_IDS.map((id) => byId.get(id)).filter((s): s is SongOption => Boolean(s));
  return { efficient, all };
}
