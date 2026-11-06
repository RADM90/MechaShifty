/* 니파고 계산 워커 — 표 계산이 걸릴 수 있어 화면을 막지 않게 여기서 돌린다.
   요청마다 id 를 돌려주고, 화면은 최신 상태 번호가 아닌 답을 버린다 (명세 24.6). */

import { createService } from './service.js';

let svc = null;
let queue = Promise.resolve();       // 한 번에 하나씩 — 표 캐시를 같이 쓴다

self.onmessage = e => {
  const { id, type, payload } = e.data;
  queue = queue.then(async () => {
    try {
      if (type === 'init') {
        svc = createService(payload.option, payload.glossary, { base: payload.base });
        self.postMessage({ id, ok: true });
        return;
      }
      const out = type === 'compare'
        ? await svc.compare(payload.st, payload.keep, payload.acc)
        : await svc.recommend(payload.st);
      self.postMessage({ id, ok: true, out });
    } catch (err) {
      self.postMessage({ id, ok: false, err: String(err && err.stack || err) });
    }
  });
};
