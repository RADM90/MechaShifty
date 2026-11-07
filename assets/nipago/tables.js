/* 니파고 - 미리 푼 부위 정책 파일.
   tools/nipago_tables.mjs 가 쓰고, service.js 가 읽는다. DOM 없음.

   부위 표 하나는 (목표 가중치·최소 단계 묶음, λ) 로 정해지고, 저장하는 것은 상태마다 최선 행동 번호 1바이트뿐이다.
   가치·기대 모듈·락키는 받은 정책을 한 번 평가해서 다시 얻는다 (가치 반복보다 수십 배 빠르다).

   전부 한 파일 - data/nipago/policies.bin (gzip). 처음 계산할 때 한 번 받는다.
   data/nipago/manifest.json 에 해시가 있어, 규칙이 바뀌었으면 큰 파일을 받지 않는다.

   형식 (gzip 압축 전)
     'NPT1'  u32 해시  u16 표 개수
     표마다  u8 이름 길이 · 이름(ASCII) · u32 정책 길이 · 정책 바이트
   해시는 규칙·확률표·엔진 버전에서 만든다. 다르면 파일을 버리고 직접 계산한다. */

import { SLOT_P, LOCK_MOD, LOCK_KEY, FIRST_LV, MAX_PROTECT } from './rules.js';
import { ENGINE_VERSION, LAMBDAS } from './engine.js';

export const TABLE_FILE = 'nipago/policies.bin';
export const MANIFEST_FILE = 'nipago/manifest.json';

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export function policyHash(D) {
  return fnv(JSON.stringify([ENGINE_VERSION, SLOT_P, LOCK_MOD, LOCK_KEY, FIRST_LV, MAX_PROTECT,
    String(Object.values(LAMBDAS)), D.lp, D.opts.map(o => o.w)]));
}

/* '0.1:15|0.12:12@0.1' → '12-15' - 생성할 때 일을 나누는 단위 */
export function shardOf(key) {
  return key.split('@')[0].split('|').map(x => +x.split(':')[1]).sort((a, b) => a - b).join('-');
}

export function encodeShard(hash, entries) {
  let size = 10;
  for (const [k, p] of entries) size += 1 + k.length + 4 + p.length;
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  let o = 0;
  for (const c of 'NPT1') buf[o++] = c.charCodeAt(0);
  dv.setUint32(o, hash); o += 4;
  dv.setUint16(o, entries.length); o += 2;
  for (const [k, p] of entries) {
    buf[o++] = k.length;
    for (let i = 0; i < k.length; i++) buf[o++] = k.charCodeAt(i);
    dv.setUint32(o, p.length); o += 4;
    buf.set(p, o); o += p.length;
  }
  return buf;
}

/* → Map(이름 → 정책) | null (해시가 다르거나 깨진 파일) */
export function decodeShard(buf, hash) {
  try {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (String.fromCharCode(...buf.subarray(0, 4)) !== 'NPT1' || dv.getUint32(4) !== hash) return null;
    const n = dv.getUint16(8);
    const out = new Map();
    let o = 10;
    for (let e = 0; e < n; e++) {
      const kl = buf[o++];
      const k = String.fromCharCode(...buf.subarray(o, o + kl)); o += kl;
      const len = dv.getUint32(o); o += 4;
      out.set(k, buf.slice(o, o + len)); o += len;
    }
    return out;
  } catch { return null; }
}

/* 받은 바이트 - gzip 이면 푼다 (서버가 이미 풀어서 줬을 수도 있다) */
export async function unpack(bytes) {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') return null;
    const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return bytes;
}
