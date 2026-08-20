/* 내 계정 붙이기 — MechaShifty 가 이미 불러 둔 자료를 그대로 읽는다.

   같은 오리진의 별도 페이지라 `localStorage['cp.roster']` 가 그대로 보인다.
   그래서 여기서는 **아무것도 받아오지 않는다** — 불러오기·검증·저장은 전부
   전투력 계산기 쪽(`assets/roster.js`)이 하고, 우리는 읽기만 한다. 계정 자료가
   브라우저 밖으로 나가지 않는다는 원칙도 그대로 지켜진다.

   파싱도 `roster.js` 의 `parseRoster` 를 그대로 쓴다. 스키마 검증·상한 절단이
   거기 다 들어 있어서, 따로 읽으면 두 화면이 서로 다른 값을 믿게 된다. */

import { parseRoster, toInput } from '../../assets/roster.js';
import { defaultInput, bondCap } from './defaults.js';

const STORE = 'cp.roster';

/* 불러온 계정. 없으면 null 이고, 그때는 기준 세팅으로 계산한다. */
export function readAccount() {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const data = parseRoster(raw);
    return {
      generatedAt: data.generated_at,
      synchro: data.account.synchro_level,
      research: data.research,
      /* 게임 API 는 니케를 name_code 로 가리킨다. 우리 색인의 rid 와 잇는 유일한
         고리라 그 키로 모아 둔다. */
      byCode: new Map(data.nikkes.map(n => [n.name_code, n])),
      count: data.nikkes.length,
    };
  } catch {
    return null;                       // 깨졌거나 스키마가 다르면 없는 셈 친다
  }
}

/* 니케 하나의 cp.js 입력. 계정에 그 니케가 있으면 실제 값을, 없으면 기준 세팅을.

   돌려주는 것: { input, source } — source 는 'account' | 'default' | 'missing'.
   'missing' 은 계정은 있는데 그 니케를 안 키운 경우다. 화면에서 구별해 보여줘야
   "왜 얘만 약하지?" 를 바로 알 수 있다. */
export function inputFor(account, meta, opts = {}) {
  const base = { weapon: opts.weapon };
  if (!account) return { input: defaultInput(meta, base), source: 'default' };

  const entry = account.byCode.get(meta.nameCode);
  if (!entry) return { input: defaultInput(meta, base), source: 'missing' };

  /* toInput 은 니케의 class·corporation 으로 콘솔(연구소) 레벨을 고른다.
     bondMax 는 돌파와 소속이 같이 정하므로 여기서 계산해 넘긴다 — roster.js 의
     bondMax 는 표 전체의 최대값(40)이라 0돌 니케에 40 을 그대로 넣어 버린다. */
  const cap = bondCap(entry.grade, meta.corporation, meta.corporation_sub_type);
  const input = toInput(entry, { rid: meta.rid, class: meta.class,
                                 corporation: meta.corporation },
                        account.research, cap);
  input.rarity = meta.rarity;
  input.class = meta.class;
  input.weapon = opts.weapon || meta.weapon;
  return { input, source: 'account' };
}

/* 사람이 읽는 한 줄. 어떤 값으로 계산했는지 화면에 그대로 적기 위한 것이다. */
export function describe(input, source, t) {
  if (source === 'default') return t('mk.srcDefault');
  const bits = [`Lv.${input.level}`, input.grade, `♥${input.bond}`,
                `${input.skills.s1}/${input.skills.s2}/${input.skills.burst}`];
  if (input.cube && input.cube !== '미착용') bits.push(`큐브 ${input.cube}`);
  if (input.collection && input.collection.kind !== 'none') {
    bits.push(`${input.collection.kind}${input.collection.level}`);
  }
  const ol = (input.gear || []).filter(g => g.tier === '오버로드').length;
  if (ol) bits.push(`오버로드 ${ol}부위`);
  return (source === 'missing' ? `${t('mk.srcMissing')} · ` : '') + bits.join(' · ');
}
