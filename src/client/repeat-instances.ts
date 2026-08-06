/**
 * 목록처럼 한 호출부가 여러 DOM 인스턴스를 찍는 자리에서 "몇 번째"를 계산한다.
 * DOM 을 직접 만지지 않는 순수 함수다 — 유닛 테스트가 node 환경에서 돌기 때문이고,
 * 수집·조상 연결 같은 DOM 작업은 호출부(client/index.ts)가 맡는다.
 */
export const INSTANCE_LABEL_MAX = 40;

export interface RepeatCandidate {
  /** file + loc + sourceTag 를 합친 값. 같으면 같은 호출부다. */
  identity: string;
  /** 요소 자신의 텍스트. 비어 있을 수 있다. */
  text: string;
  /** 같은 후보 배열에서 가장 가까운 조상의 인덱스. 없으면 null. */
  parentIndex: number | null;
}

export interface RepeatInstance {
  instance: number;
  instanceLabel: string;
}

export function normalizeInstanceLabel(text: string): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  return collapsed.slice(0, INSTANCE_LABEL_MAX);
}

export function resolveRepeatInstances(
  candidates: RepeatCandidate[]
): (RepeatInstance | null)[] {
  const totals = new Map<string, number>();
  for (const candidate of candidates) {
    totals.set(candidate.identity, (totals.get(candidate.identity) ?? 0) + 1);
  }
  const isRepeat = (index: number): boolean => {
    const candidate = candidates[index];
    return candidate !== undefined && (totals.get(candidate.identity) ?? 0) > 1;
  };

  /**
   * 자기 텍스트를 먼저 쓰고, 비어 있으면 그 자신도 반복 인스턴스인 첫 조상의
   * 텍스트를 쓴다. 카드 안 아이콘 버튼을 집어도 카드 이름이 잡히게 하는 장치다.
   * 반복이 아닌 조상(목록 컨테이너 등)은 항목을 특정하지 못하므로 건너뛴다.
   */
  const labelFor = (index: number): string => {
    const visited = new Set<number>();
    let current: number | null = index;
    while (current !== null && !visited.has(current)) {
      visited.add(current);
      const candidate = candidates[current];
      if (!candidate) {
        break;
      }
      const own = normalizeInstanceLabel(candidate.text);
      if (own && (current === index || isRepeat(current))) {
        return own;
      }
      current = candidate.parentIndex;
    }
    return "";
  };

  const counters = new Map<string, number>();
  return candidates.map((candidate, index) => {
    if (!isRepeat(index)) {
      return null;
    }
    const instance = (counters.get(candidate.identity) ?? 0) + 1;
    counters.set(candidate.identity, instance);
    return { instance, instanceLabel: labelFor(index) };
  });
}
