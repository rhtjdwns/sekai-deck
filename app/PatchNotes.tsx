import { PATCH_NOTES } from "@/lib/patchNotes";

/** 메인 화면 패치 노트: 최근 3개는 펼쳐 두고, 나머지는 접어 둠 */
export default function PatchNotes() {
  const recent = PATCH_NOTES.slice(0, 3);
  const older = PATCH_NOTES.slice(3);
  return (
    <section className="patch" aria-labelledby="patch-title">
      <h2 id="patch-title">패치 노트</h2>
      <ol className="patch-list">
        {recent.map((n) => (
          <Note key={n.version} note={n} />
        ))}
      </ol>
      {older.length > 0 && (
        <details className="patch-older">
          <summary>이전 업데이트 {older.length}개 보기</summary>
          <ol className="patch-list">
            {older.map((n) => (
              <Note key={n.version} note={n} />
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

function Note({ note }: { note: (typeof PATCH_NOTES)[number] }) {
  return (
    <li className="patch-item">
      <p className="patch-head">
        <span className="patch-version">v{note.version}</span>
        <strong>{note.title}</strong>
      </p>
      <ul>
        {note.items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </li>
  );
}
