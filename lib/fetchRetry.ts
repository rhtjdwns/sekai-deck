// 게임 데이터 받기: 느리거나 잠깐 끊기는 네트워크(클라우드 서버 등)에서도 버티도록 시간 제한과 재시도를 둠
const TIMEOUT_MS = 90_000;
const TRIES = 3;

export async function fetchWithRetry(url: string, init?: RequestInit & { next?: unknown }): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < TRIES; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) } as RequestInit);
      // 서버 쪽 일시 오류(5xx)는 다시 시도, 404 등은 그대로 돌려줌
      if (res.status < 500 || i === TRIES - 1) return res;
      lastError = new Error(`${url} ${res.status}`);
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw lastError;
}
