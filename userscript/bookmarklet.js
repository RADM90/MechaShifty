/* MechaShifty 내보내기 북마클릿: mechashifty.user.js 를 받아 SHA-256 이 EXPECT 와 같을 때만 실행한다. EXPECT 는 `shasum -a 256 userscript/mechashifty.user.js` 값이다.
 * EN: this bookmarklet only fetches mechashifty.user.js and runs it if the SHA-256 matches EXPECT below - pinning you to the exact code you reviewed.
 * JA: このブックマークレットは mechashifty.user.js を取得し、SHA-256 が下の EXPECT と一致した場合にのみ実行します（確認済みのコードに固定されます）。 */
javascript: (async () => {
  const URL_ = 'https://radm90.github.io/MechaShifty/userscript/mechashifty.user.js';
  const EXPECT = 'a63f89ae15d54339fdb1139ad18f046c96d4f84ba37c9fb077b8bb5c7487828c';
  const l = (navigator.language || 'en').toLowerCase();
  const M = l.startsWith('ko')
    ? { bad: 'MechaShifty: 스크립트가 저장해 둔 것과 다릅니다.\n실행하지 않았습니다.\nUSER_GUIDE 에서 최신 북마클릿을 다시 복사해 주세요.',
        err: 'MechaShifty: 불러오지 못했습니다 - ' }
    : l.startsWith('ja')
      ? { bad: 'MechaShifty: スクリプトが保存時のものと異なります。\n実行しませんでした。\nUSER_GUIDE から最新のブックマークレットをコピーし直してください。',
          err: 'MechaShifty: 読み込めませんでした - ' }
      : { bad: 'MechaShifty: the script differs from the one you saved.\nNothing was run.\nCopy the current bookmarklet again from the USER_GUIDE.',
          err: 'MechaShifty: could not load - ' };
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
