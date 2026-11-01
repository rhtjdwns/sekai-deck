// 게임 데이터 받기: 느리거나 잠깐 끊기는 네트워크(클라우드 서버 등)에서도 버티도록 시간 제한과 재시도를 둠.
// 본문(일본판 cards.json은 40MB 이상)까지 모두 받은 뒤 돌려줘서, 본문을 받다가 끊겨도 처음부터 다시 시도한다.
// (예전에는 응답 헤더만 재시도 안에서 받고 본문은 밖에서 읽어서, 본문을 받는 도중 시간 초과가 나면 빌드가 실패했다)
const TIMEOUT_MS = 180_000;
const TRIES = 3;

export async function fetchWithRetry(url: string, init?: RequestInit & { next?: unknown }): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < TRIES; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) } as RequestInit);
      // 서버 쪽 일시 오류(5xx)는 다시 시도, 404 등은 그대로 돌려줌
      if (res.status >= 500 && i < TRIES - 1) {
        lastError = new Error(`${url} ${res.status}`);
      } else {
        // 본문까지 모두 받아 둠 (여기서 끊기면 아래 catch로 가서 다시 시도)
        const body = await res.arrayBuffer();
        return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
      }
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
  }
  throw lastError;
}
