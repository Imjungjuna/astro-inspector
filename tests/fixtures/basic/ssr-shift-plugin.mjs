/**
 * SSR 파이프라인에서만 `.tsx` 앞에 주석 줄을 끼워 넣는다. 실제 앱에서 lingui 매크로나
 * React Compiler 처럼 환경별로 다르게 도는 pre 플러그인이 만드는 상황을 최소로 재현한다.
 * 이 플러그인이 붙으면 SSR 이 보는 줄 번호가 client 보다 정확히 SHIFT_LINES 만큼 밀린다.
 */
const SHIFT_LINES = 3;

export function ssrShiftPlugin() {
  return {
    name: "fixture:ssr-shift",
    enforce: "pre",
    apply: "serve",
    transform(code, id, options) {
      const file = id.split("?", 1)[0] ?? "";
      if (!options?.ssr || !file.endsWith(".tsx")) {
        return null;
      }
      return {
        code: `${"// ssr-only shim\n".repeat(SHIFT_LINES)}${code}`,
        map: null
      };
    }
  };
}
