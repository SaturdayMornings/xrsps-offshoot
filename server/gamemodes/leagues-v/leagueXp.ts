/**
 * Leagues XP multiplier helpers.
 *
 * Cache parity references:
 * - enum_5702 stages map to relic unlock structs 1136..1143 with point thresholds
 *   (param_877): 0, 750, 1500, 2500, 5000, 8000, 16000, 25000.
 * - Stage passive text structs (param_2045) describe XP multiplier changes:
 *   1144 => "5x", 1145 => "5x to 8x", 1149 => "8x to 12x", 1151 => "12x to 16x".
 *   Those strings are cache data no server code can rewrite, so the climb keeps
 *   that shape (an upgrade at 750, 5000 and 16000 claimed points) with every
 *   tier doubled. The untouched cache text therefore still reads 5x/8x/12x/16x;
 *   aligning the Relics tab with the rates below would need a struct-param
 *   override for those passive structs (see PARAM_LEAGUE_RELIC_TIER_PASSIVE_STRUCT
 *   in scripts/leagueWidgets.ts).
 *
 * Resulting Leagues V XP multipliers by points claimed:
 * - 0-749: 10x
 * - 750-4999: 16x
 * - 5000-15999: 24x
 * - 16000+: 32x
 */

export const LEAGUE_V_XP_MULTIPLIER = Object.freeze({
    base: 10,
    tier2: 16,
    tier5: 24,
    tier7: 32,
});

const LEAGUE_V_TIER_2_POINTS = 750;
const LEAGUE_V_TIER_5_POINTS = 5000;
const LEAGUE_V_TIER_7_POINTS = 16000;

/**
 * Returns the Leagues V skill XP multiplier from total claimed league points.
 */
export function getLeagueVSkillXpMultiplier(pointsClaimed: number): number {
    const points = Math.max(0, Number.isFinite(pointsClaimed) ? Math.floor(pointsClaimed) : 0);
    if (points >= LEAGUE_V_TIER_7_POINTS) return LEAGUE_V_XP_MULTIPLIER.tier7;
    if (points >= LEAGUE_V_TIER_5_POINTS) return LEAGUE_V_XP_MULTIPLIER.tier5;
    if (points >= LEAGUE_V_TIER_2_POINTS) return LEAGUE_V_XP_MULTIPLIER.tier2;
    return LEAGUE_V_XP_MULTIPLIER.base;
}

/**
 * Returns the active league skill XP multiplier for a given league type.
 * Non-Leagues-V types intentionally return 1 (no multiplier) here.
 */
export function getLeagueSkillXpMultiplier(leagueType: number, pointsClaimed: number): number {
    if (leagueType !== 5) return 1;
    return getLeagueVSkillXpMultiplier(pointsClaimed);
}
