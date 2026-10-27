/* MechaShifty 내보내기 — 북마클릿 판 (Tampermonkey 를 못 쓰는 환경용)
 *
 * mechashifty.user.js 를 받아 SHA-256 이 아래 EXPECT 와 맞을 때만 실행한다.
 * 저장한 시점의 코드에 고정되므로 배포본이 바뀌면 다시 저장하기 전까지 실행되지 않는다.
 * 스크립트를 고치면 EXPECT 를 갱신하고 사용자는 북마크를 다시 저장해야 한다 — 자동 업데이트는 일부러 막았다.
 *
 * Tampermonkey 를 쓸 수 있으면 그쪽이 낫다 (실행할 때마다 네트워크로 받지 않는다).
 *
 * 화면 문구는 mechashifty.user.js 가 한/영/일로 낸다.
 * 아래 alert 둘은 그 스크립트가 뜨기 전에 실패했을 때만 보이므로 여기서 세 언어를 따로 든다.
 *
 * EN: this bookmarklet only fetches mechashifty.user.js and runs it if the SHA-256 matches EXPECT below — pinning you to the exact code you reviewed.
 * JA: このブックマークレットは mechashifty.user.js を取得し、SHA-256 が下の EXPECT と一致した場合にのみ実行します（確認済みのコードに固定されます）。
 *
 * 해시 갱신:
 *   shasum -a 256 userscript/mechashifty.user.js
 * 한 줄짜리 북마클릿은 USER_GUIDE.md 에 있다.
 */
javascript: (async () => {
  const URL_ = 'https://radm90.github.io/MechaShifty/userscript/mechashifty.user.js';
  const EXPECT = '64df14a4b4f0963e2527d6fbd5ea1f857ad6d9c8529eefd2c69c35150ce83168';
  const l = (navigator.language || 'en').toLowerCase();
  const M = l.startsWith('ko')
    ? { bad: 'MechaShifty: 스크립트가 저장해 둔 것과 다릅니다.\n실행하지 않았습니다.\nUSER_GUIDE 에서 최신 북마클릿을 다시 복사해 주세요.',
        err: 'MechaShifty: 불러오지 못했습니다 — ' }
    : l.startsWith('ja')
      ? { bad: 'MechaShifty: スクリプトが保存時のものと異なります。\n実行しませんでした。\nUSER_GUIDE から最新のブックマークレットをコピーし直してください。',
          err: 'MechaShifty: 読み込めませんでした — ' }
      : { bad: 'MechaShifty: the script differs from the one you saved.\nNothing was run.\nCopy the current bookmarklet again from the USER_GUIDE.',
          err: 'MechaShifty: could not load — ' };
  try {
    const src = await (await fetch(URL_, { cache: 'no-store' })).text();
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src));
    const got = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (got !== EXPECT) { alert(M.bad); return; }
    (0, eval)(src);
  } catch (e) {
    alert(M.err + e.message);
  }
})();
