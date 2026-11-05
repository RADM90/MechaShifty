/* 니파고 계산 워커 — 표 계산이 수 초 걸릴 수 있어 화면을 막지 않게 여기서 돌린다.
   요청마다 id(상태 번호)를 돌려주고, 화면은 최신 id 가 아닌 답을 버린다 (명세 24.6). */

import { createService } from './service.js';

let svc = null;

self.onmessage = e => {
  const { id, type, payload } = e.data;
  try {
    if (type === 'init') {
      svc = createService(payload.option, payload.glossary);
      self.postMessage({ id, ok: true });
      return;
    }
    const out = type === 'compare'
      ? svc.compare(payload.st, payload.keep, payload.acc)
      : svc.recommend(payload.st);
    self.postMessage({ id, ok: true, out });
  } catch (err) {
    self.postMessage({ id, ok: false, err: String(err && err.stack || err) });
  }
};
