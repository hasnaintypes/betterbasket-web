export function createTestClock(initial: Date | string = "2025-01-01T00:00:00.000Z") {
  let now = new Date(initial).getTime();
  if (!Number.isFinite(now)) throw new Error("Invalid initial test clock time");
  return {
    now: () => new Date(now),
    advanceBy(milliseconds: number) {
      if (!Number.isFinite(milliseconds)) throw new Error("Invalid clock advance");
      now += milliseconds;
      return new Date(now);
    },
    set(value: Date | string) {
      const next = new Date(value).getTime();
      if (!Number.isFinite(next)) throw new Error("Invalid test clock time");
      now = next;
      return new Date(now);
    },
  };
}
