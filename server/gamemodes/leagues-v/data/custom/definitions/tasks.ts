import { TriggerType } from "../../../triggers/TriggerTypes";
import type { CustomTask } from "../CustomContentTypes";

/**
 * All custom tasks for League 5 (Raging Echoes).
 * Only add tasks here when the cache does not already define them.
 *
 * Tasks added here get a registry-assigned structId (90000+) and taskId
 * (1856+). The registry also ships the enum group (5728) and the struct params
 * in the gamemode payload, which is what makes the task render in the in-game
 * task list (widget group 657) - cache tasks render because they are members of
 * the enum, custom tasks render because the client prepends the override.
 *
 * A trigger is required: custom tasks are indexed from their trigger, they are
 * never parsed from the task name.
 */
export const CUSTOM_TASKS: CustomTask[] = [
    {
        name: "Kill a Man",
        description: "Kill a Man",
        tier: 1,
        points: 10,
        leagueType: 5,
        category: 2,
        area: 0,
        skill: 0,
        trigger: {
            type: TriggerType.NpcKill,
            // Every NPC named "Man" in the cache.
            npcIds: [
                1118, 3014, 3106, 3107, 3108, 3109, 3110, 3261, 3264, 3265, 3298, 3652, 4270, 4271,
                6776, 6818, 6987, 6988, 6989, 7281, 7919, 7920, 9390, 9391, 9392, 9394, 9395, 9396,
                9397, 11057, 11058,
            ],
        },
    },
];
