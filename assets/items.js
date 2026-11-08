/* 재화 아이콘 - assets/icons/item/<게임 아이템 id>.webp (48px).
   이름 대신 쓰는 아이콘이라 alt·title 에 이름을 넣는다. 그림이 안 뜨면 이름 글자로 바꾼다. */

export const ITEM = {
  exp: 1,           // 지휘관 경험치
  battle: 1000,      // 배틀 데이터 셋
  credit: 2000,      // 크레딧
  dust: 3000,        // 코어 더스트
  module: 7080001,   // 커스텀 모듈
  lockKey: 7080002,  // 커스텀 락 키
};

export function itemIcon(id, label, cls) {
  const img = document.createElement('img');
  img.className = 'ic ic-item' + (cls ? ' ' + cls : '');
  img.src = `assets/icons/item/${id}.webp`;
  img.alt = label;
  img.title = label;
  img.decoding = 'async';
  img.onerror = () => img.replaceWith(document.createTextNode(label));
  return img;
}
