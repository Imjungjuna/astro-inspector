/**
 * dev 서버 프로세스 하나가 들고 있는 종료 플래그. 세션 핸들러와 Vite 플러그인이
 * 같은 값을 봐야 하므로 핸들러 밖으로 뺐다. 디스크에 쓰지 않는다 — 영속화하면
 * 재시작이라는 유일한 복구 경로가 막힌다.
 */
export interface LocatorSessionStateStore {
  isDisabled(): boolean;
  disable(): void;
  onDisable(listener: () => void): void;
}

export function createSessionState(): LocatorSessionStateStore {
  let disabled = false;
  const listeners: Array<() => void> = [];

  return {
    isDisabled: () => disabled,
    disable() {
      if (disabled) {
        return;
      }
      disabled = true;
      for (const listener of listeners) {
        listener();
      }
    },
    // 이미 닫힌 뒤 붙는 리스너도 정리 작업을 놓치면 안 되므로 즉시 실행한다.
    onDisable(listener) {
      if (disabled) {
        listener();
        return;
      }
      listeners.push(listener);
    }
  };
}
