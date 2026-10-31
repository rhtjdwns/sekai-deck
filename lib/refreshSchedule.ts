// 오후 3시·8시(한국 시간) 화면 갱신 예약.
// 화면(첫 화면, 보유 카드, 덱 편성 도우미, 내실)은 한 번 만들어 두고 계속 재사용하다가,
// 이 시각에만 /api/revalidate를 불러 게임 데이터를 새로 받고 화면을 다시 만든다.
/** 갱신 시각 (한국 시간, 시) */
export const REFRESH_HOURS_KST = [15, 20];

declare global {
  // eslint-disable-next-line no-var
  var __sekaiRefreshSecret: string | undefined;
  // eslint-disable-next-line no-var
  var __sekaiRefreshTimer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * 같은 서버 안에서만 갱신을 부를 수 있게 하는 비밀 값.
 * 환경 변수 REFRESH_SECRET을 정해 두면 그 값으로 직접 갱신을 부를 수도 있음 (수동 갱신용)
 */
export function refreshSecret() {
  globalThis.__sekaiRefreshSecret ??= process.env.REFRESH_SECRET || globalThis.crypto.randomUUID();
  return globalThis.__sekaiRefreshSecret;
}

/** 다음 갱신 시각 (밀리초) */
export function nextRefreshAt(now = Date.now()) {
  const KST = 9 * 60 * 60 * 1000;
  const k = new Date(now + KST); // 한국 시간 기준 날짜·시각을 UTC 필드로 다룸
  const candidates: number[] = [];
  for (let day = 0; day <= 1; day++) {
    for (const h of REFRESH_HOURS_KST) {
      candidates.push(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + day, h) - KST);
    }
  }
  return Math.min(...candidates.filter((t) => t > now));
}

export function startRefreshSchedule() {
  if (globalThis.__sekaiRefreshTimer) return;
  const port = process.env.PORT ?? "3000";
  const schedule = () => {
    const at = nextRefreshAt();
    // 이벤트 시작 직후 데이터가 확실히 반영되도록 1분 뒤에 갱신
    const delay = at - Date.now() + 60 * 1000;
    globalThis.__sekaiRefreshTimer = setTimeout(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/revalidate`, {
          method: "POST",
          headers: { "x-refresh-secret": refreshSecret() },
        });
        console.log(`[갱신] ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 화면 갱신 ${res.ok ? "완료" : `실패 (${res.status})`}`);
      } catch (e) {
        console.error("[갱신] 화면 갱신 요청 실패", e);
      }
      schedule();
    }, delay);
    console.log(`[갱신] 다음 화면 갱신: ${new Date(at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`);
  };
  schedule();
}
