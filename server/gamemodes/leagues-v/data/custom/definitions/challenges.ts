/**
 * Custom mastery challenge definitions.
 *
 * Add new custom challenges here. The registry will auto-assign:
 * - structId (from 90100+)
 * - customIndex (0, 1, 2...)
 *
 * Challenges appear in the mastery combat tree interface and grant
 * mastery points when completed.
 */
import { TriggerType } from "../../../triggers/TriggerTypes";
import type { CustomChallenge } from "../CustomContentTypes";

/**
 * All custom mastery challenges.
 *
 * These are PREPENDED to the mastery challenges enum (5695), so the challenge
 * with customIndex N renders at enum position N + 1 and cache challenges follow
 * it (minus the ones replaced below). The enum is 1-based while the league task
 * enum (5728) is 0-based, which the client's enum override derives from the
 * cache enum itself.
 *
 * IMPORTANT: the cache's completion script only handles enum positions 1-10
 * (the 10 mastery point unlock varbits 11585-11594). Anything pushed past
 * position 10 still renders in the list but can never be shown as complete, so
 * keep the number of custom challenges below 10.
 */
export const CUSTOM_CHALLENGES: CustomChallenge[] = [
    {
        description: "Defeat a Man.",
        trigger: { type: TriggerType.NpcKill, npcIds: [3106, 3107, 3108] },
    },
    {
        description: "Defeat a Giant.",
        replacesStructId: 1177,
        trigger: {
            type: TriggerType.NpcKill,
            npcIds: [
                // Hill Giant
                2098, 2099, 2100, 2101, 2102, 2103, 7261, 10374, 10375, 10376,
                // Moss Giant
                2090, 2091, 2092, 2093, 3851, 7262, 8015, 8016, 8017, 8018,
                // Ice Giant
                2085, 2086, 2087, 2088, 2089, 7878, 7879, 7880, 8488, 8489, 8490,
                // Fire Giant
                2075, 2076, 2077, 2078, 2079, 2080, 2081, 2082, 2083, 7251, 7252, 8392, 8393, 8394,
            ],
        },
    },
    {
        description: "Defeat 10 monsters with a combat level of 100 or more.",
        replacesStructId: 1178,
        trigger: {
            type: TriggerType.NpcKillCombatLevel,
            minCombatLevel: 100,
            count: 10,
        },
    },
];
