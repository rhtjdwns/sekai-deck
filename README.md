<<<<<<< HEAD
# 세카이 덱 짜기 (한국판)

프로젝트 세카이 한국판 마스터 데이터로 보유 카드를 체크해 프리셋으로 저장하고, 현재 이벤트에 맞는 덱을 찾는 Next.js 앱입니다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 http://localhost:3000 을 엽니다.

## 화면

- `/` 메인 화면. 보유 카드 체크하기, 덱 편성 도우미로 들어가는 선택지
- `/cards` 보유 카드 체크하기. 카드 목록, 필터, 체크 모드, 프리셋 관리
- `/deck` 덱 편성 도우미. 프리셋 선택, 이벤트 보너스가 높은 보유 카드 미리보기 (자동 덱 추천은 다음 단계)

## 구조

- `lib/master.ts` — 한국판 마스터 데이터(Sekai-World/sekai-master-db-kr-diff)를 불러와 화면용 데이터로 가공. 현재 이벤트 선택, 카드별 이벤트 보너스 계산
- `lib/presets.ts` — 보유 카드 프리셋 형식, 브라우저 저장, 내보내기·가져오기(이 사이트 형식, userCards JSON)
- `app/layout.tsx`, `app/SiteNav.tsx` — 공통 레이아웃과 상단 메뉴
- `app/page.tsx`, `app/OwnedSummary.tsx` — 메인 화면
- `app/cards/page.tsx`, `app/CardBrowser.tsx`, `app/PresetBar.tsx`, `app/usePresets.ts` — 보유 카드 체크 화면과 프리셋 상태 관리
- `app/deck/page.tsx`, `app/deck/DeckHelper.tsx` — 덱 편성 도우미
- `app/globals.css` — 스타일 (라이트/다크 모드)

## 참고

- 카드 이미지는 Sekai Viewer(storage.sekai.best)의 일본판 에셋을 사용합니다. 에셋 이름이 서버 공통이라 한국판 카드도 표시됩니다.
- 이벤트 보너스는 캐릭터·속성 기본 보너스만 계산합니다. 마스터 랭크 보너스는 덱 추천 단계에서 반영합니다.
- 보유 카드 프리셋은 브라우저 localStorage에 저장됩니다. 다른 기기로 옮길 때는 내보내기 파일을 사용하세요.
- `cards.json`이 약 4.5MB라서 Next.js 데이터 캐시(2MB 제한)에는 저장되지 않는다는 경고가 개발 서버에 뜰 수 있습니다. 페이지 자체는 ISR로 캐시되므로 동작에는 문제 없습니다.
=======
# sekai-deck
>>>>>>> 3185107d924703a5be788704ff154925a584b3ed
