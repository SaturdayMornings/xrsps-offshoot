/**
 * Regression coverage for the Leagues V XP multiplier ladder.
 *
 * The multiplier is driven by claimed league points (VARBIT pool varp
 * VARP_LEAGUE_POINTS_CLAIMED) and feeds every XP path through
 * GamemodeDefinition#getSkillXpMultiplier (SkillService, CombatActionHandler,
 * CombatHandlerUtils), so a bad tier value silently doubles or halves all XP.
 *
 * Two properties matter:
 *  - the rates are the doubled Leagues V ladder (10x / 16x / 24x / 32x), and
 *  - the ladder never goes *down* as points are claimed. The base began life as
 *    the cache's 5x with 8x at 750 points; raising only the base would have made
 *    the multiplier fall from 10x back to 8x on the first claim.
 *
 * Run with: npx tsx tests/league-xp-multiplier.test.ts
 */
import assert from "node:assert/strict";

import {
    LEAGUE_V_XP_MULTIPLIER,
    getLeagueSkillXpMultiplier,
    getLeagueVSkillXpMultiplier,
} from "../gamemodes/leagues-v/leagueXp";

// Cache thresholds: relic unlock structs 1136..1143 (param_877).
const TIER_2_POINTS = 750;
const TIER_5_POINTS = 5000;
const TIER_7_POINTS = 16000;

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

const boundaries: Array<[number, number]> = [
    [0, 10],
    [1, 10],
    [TIER_2_POINTS - 1, 10],
    [TIER_2_POINTS, 16],
    [TIER_2_POINTS + 1, 16],
    [TIER_5_POINTS - 1, 16],
    [TIER_5_POINTS, 24],
    [TIER_7_POINTS - 1, 24],
    [TIER_7_POINTS, 32],
    [TIER_7_POINTS + 1, 32],
    [25000, 32],
];
for (const [points, expected] of boundaries) {
    assert.equal(
        getLeagueVSkillXpMultiplier(points),
        expected,
        `${points} claimed points must give ${expected}x`,
    );
}

// Guard rails around the shared value, not just the lookup.
assert.deepEqual(
    { ...LEAGUE_V_XP_MULTIPLIER },
    { base: 10, tier2: 16, tier5: 24, tier7: 32 },
    "the doubled Leagues V ladder must stay 10x / 16x / 24x / 32x",
);

// ---------------------------------------------------------------------------
// The ladder is monotonic: claiming points can never lower the multiplier
// ---------------------------------------------------------------------------

let previous = 0;
for (let points = 0; points <= 20000; points += 25) {
    const multiplier = getLeagueVSkillXpMultiplier(points);
    assert.ok(
        multiplier >= previous,
        `multiplier dropped from ${previous}x to ${multiplier}x at ${points} claimed points`,
    );
    previous = multiplier;
}

// ---------------------------------------------------------------------------
// Junk input must not award anything unexpected
// ---------------------------------------------------------------------------

assert.equal(getLeagueVSkillXpMultiplier(-1), 10, "negative points fall back to the base");
assert.equal(getLeagueVSkillXpMultiplier(NaN), 10, "NaN points fall back to the base");
assert.equal(
    getLeagueVSkillXpMultiplier(Infinity),
    10,
    "non-finite points fall back to the base (floor of Infinity is not a tier)",
);
assert.equal(
    getLeagueVSkillXpMultiplier(TIER_2_POINTS + 0.9),
    16,
    "fractional points floor into the lower tier",
);

// ---------------------------------------------------------------------------
// Only league type 5 is scaled (vanilla / other leagues stay 1x)
// ---------------------------------------------------------------------------

assert.equal(getLeagueSkillXpMultiplier(5, 0), 10, "league type 5 uses the ladder base");
assert.equal(getLeagueSkillXpMultiplier(5, TIER_7_POINTS), 32, "league type 5 uses the top tier");
for (const leagueType of [0, 1, 2, 3, 4, 6, 7]) {
    assert.equal(
        getLeagueSkillXpMultiplier(leagueType, TIER_7_POINTS),
        1,
        `league type ${leagueType} must not be scaled here`,
    );
}

console.log("league-xp-multiplier: all assertions passed");
