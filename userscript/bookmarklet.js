/* MechaShifty 내보내기 — 북마클릿 판 (Tampermonkey 를 못 쓰는 환경용)
 *
 * 하는 일은 mechashifty.user.js 를 받아서 실행하는 것뿐이다. 다만 받은 내용의
 * SHA-256 을 아래 EXPECT 와 대조해서, 한 글자라도 다르면 실행하지 않는다.
 * 즉 이 북마클릿을 한 번 저장해 두면 그 시점의 코드에 고정된다 — 나중에 배포본이
 * 바뀌어도 (개발자가 몰래 바꾸더라도) 사용자가 다시 복사하기 전에는 실행되지 않는다.
 *
 * 그래서 스크립트를 고칠 때마다 EXPECT 도 같이 갱신해야 하고, 사용자는 북마크를
 * 다시 저장해야 한다. 자동 업데이트가 안 되는 게 아니라 일부러 안 되게 한 것이다.
 *
 * Tampermonkey 를 쓸 수 있으면 그쪽이 낫다. 코드가 브라우저에 저장돼 있어서
 * 실행할 때마다 네트워크로 받아 오지 않는다.
 *
 * 해시 갱신:
 *   shasum -a 256 userscript/mechashifty.user.js
 * 한 줄짜리 북마클릿은 USER_GUIDE.md 에 있다.
 */
javascript: (async () => {
  const URL_ = 'https://radm90.github.io/MechaShifty/userscript/mechashifty.user.js';
  const EXPECT = 'b407534f863c8805205c8aedc4b36503d9c8af22fe33f0b26e34ec9ba7577ac1';
  try {
    const src = await (await fetch(URL_, { cache: 'no-store' })).text();
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src));
    const got = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (got !== EXPECT) {
      alert('MechaShifty: 스크립트가 저장해 둔 것과 다릅니다.\n실행하지 않았습니다.\n'
        + 'USER_GUIDE.md 에서 최신 북마클릿을 다시 복사해 주세요.');
      return;
    }
    (0, eval)(src);
  } catch (e) {
    alert('MechaShifty: 불러오지 못했습니다 — ' + e.message);
  }
})();
