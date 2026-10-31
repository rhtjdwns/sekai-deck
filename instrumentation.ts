// 서버가 켜질 때 한 번 실행된다. 이벤트가 바뀌는 오후 3시와 오후 8시(한국 시간)에만 화면을 새로 만들도록 예약한다.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startRefreshSchedule } = await import("./lib/refreshSchedule");
  startRefreshSchedule();
}
