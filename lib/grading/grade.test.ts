import { describe, expect, it } from "vitest";
import { currentStat, gradeLeg, gradeParlay, hitCount } from "@/lib/grading/grade";

describe("grading", () => {
  it("reads the stat the market needs", () => {
    const line = { goals: 1, assists: 2, points: 3, shots: 4, toiSeconds: 600 };
    expect(currentStat("anytime_goal", line)).toBe(1);
    expect(currentStat("anytime_point", line)).toBe(3);
    expect(currentStat("sog_over_15", line)).toBe(4);
    expect(currentStat("anytime_goal", null)).toBe(0);
  });

  it("hits early, voids a scratch, and kills a final miss", () => {
    expect(gradeLeg({ current: 1, target: 1, gameFinal: false, inBoxscore: true, toiSeconds: 400 })).toBe("hit");
    expect(gradeLeg({ current: 1, target: 2, gameFinal: false, inBoxscore: true, toiSeconds: 400 })).toBe("pending");
    expect(gradeLeg({ current: 1, target: 2, gameFinal: true, inBoxscore: true, toiSeconds: 400 })).toBe("dead");
    expect(gradeLeg({ current: 0, target: 1, gameFinal: true, inBoxscore: false, toiSeconds: 0 })).toBe("void");
    expect(gradeLeg({ current: 0, target: 1, gameFinal: true, inBoxscore: true, toiSeconds: 0 })).toBe("void");
  });

  it("grades the parlay from its legs", () => {
    expect(gradeParlay(["hit", "hit", "pending"])).toBe("ALIVE");
    expect(gradeParlay(["hit", "hit", "hit"])).toBe("WON");
    expect(gradeParlay(["hit", "dead", "pending"])).toBe("LOST");
    expect(gradeParlay(["hit", "hit", "void"])).toBe("VOID");
    expect(hitCount(["hit", "pending", "hit"])).toBe(2);
  });
});
