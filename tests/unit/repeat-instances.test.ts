import { describe, expect, it } from "vitest";
import {
  normalizeInstanceLabel,
  resolveRepeatInstances,
  type RepeatCandidate
} from "../../src/client/repeat-instances.js";

function candidate(
  identity: string,
  text = "",
  parentIndex: number | null = null
): RepeatCandidate {
  return { identity, text, parentIndex };
}

describe("normalizeInstanceLabel", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeInstanceLabel("  강남   A병원\n  예약 ")).toBe(
      "강남 A병원 예약"
    );
  });

  it("cuts at 40 characters", () => {
    expect(normalizeInstanceLabel("가".repeat(50))).toHaveLength(40);
  });
});

describe("resolveRepeatInstances", () => {
  it("returns null for an identity that appears once", () => {
    expect(resolveRepeatInstances([candidate("a", "혼자")])).toEqual([null]);
  });

  it("numbers repeats in document order", () => {
    const resolved = resolveRepeatInstances([
      candidate("card", "첫째"),
      candidate("card", "둘째"),
      candidate("card", "셋째")
    ]);

    expect(resolved).toEqual([
      { instance: 1, instanceLabel: "첫째" },
      { instance: 2, instanceLabel: "둘째" },
      { instance: 3, instanceLabel: "셋째" }
    ]);
  });

  it("counts each identity separately", () => {
    const resolved = resolveRepeatInstances([
      candidate("card", "A"),
      candidate("link", "L1"),
      candidate("card", "B"),
      candidate("link", "L2")
    ]);

    expect(resolved.map((value) => value?.instance)).toEqual([1, 1, 2, 2]);
  });

  it("falls back to the nearest repeating ancestor when the element has no text", () => {
    // 0,2 = 카드(반복) · 1,3 = 카드 안의 아이콘 버튼(반복, 텍스트 없음)
    const resolved = resolveRepeatInstances([
      candidate("card", "강남 A병원"),
      candidate("icon", "", 0),
      candidate("card", "강남 B병원"),
      candidate("icon", "", 2)
    ]);

    expect(resolved[1]).toEqual({ instance: 1, instanceLabel: "강남 A병원" });
    expect(resolved[3]).toEqual({ instance: 2, instanceLabel: "강남 B병원" });
  });

  it("skips a non-repeating ancestor when looking for a label", () => {
    // 0 = 목록 컨테이너(한 번만 나옴) · 1,2 = 텍스트 없는 반복 요소
    const resolved = resolveRepeatInstances([
      candidate("list", "목록 전체 텍스트"),
      candidate("icon", "", 0),
      candidate("icon", "", 0)
    ]);

    expect(resolved[1]).toEqual({ instance: 1, instanceLabel: "" });
    expect(resolved[2]).toEqual({ instance: 2, instanceLabel: "" });
  });

  it("keeps its own text even when an ancestor also has text", () => {
    const resolved = resolveRepeatInstances([
      candidate("card", "카드 전체"),
      candidate("title", "제목", 0),
      candidate("card", "카드 전체 2"),
      candidate("title", "제목 2", 2)
    ]);

    expect(resolved[1]?.instanceLabel).toBe("제목");
  });

  it("stops instead of looping when ancestors form a cycle", () => {
    const cyclic: RepeatCandidate[] = [
      { identity: "a", text: "", parentIndex: 1 },
      { identity: "a", text: "", parentIndex: 0 }
    ];

    expect(resolveRepeatInstances(cyclic)).toEqual([
      { instance: 1, instanceLabel: "" },
      { instance: 2, instanceLabel: "" }
    ]);
  });
});
