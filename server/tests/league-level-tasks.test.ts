/**
 * Regression coverage for Leagues V level milestone tasks.
 *
 * "Achieve Your First Level 5" (task 192, 10 points) - and every other level
 * task - never registered: the trigger parser only understood NPC/item
 * patterns, so level tasks were never indexed and nothing ever completed them,
 * meaning no league points were awarded.
 *
 * These tests cover the parser, the index and the manager's stateful
 * evaluation (level-up event + login catch-up).
 *
 * Run with: npx tsx tests/league-level-tasks.test.ts
 */
import assert from "node:assert/strict";

import { SKILL_COUNT, SKILL_IDS, SkillId, getXpForLevel } from "../../client/rs/skill/skills";
import {
    VARBIT_LEAGUE_TOTAL_TASKS_COMPLETED,
    VARP_LEAGUE_POINTS_CLAIMED,
    VARP_LEAGUE_POINTS_COMPLETED,
    VARP_LEAGUE_POINTS_CURRENCY,
} from "../../client/common/vars";
import { registerSkillConfiguration } from "../src/game/combat/SkillConfigurationProvider";
import { PlayerSkillSystem } from "../src/game/state/PlayerSkillSystem";
import { PlayerStatusState } from "../src/game/state/PlayerStatusState";
import { LeagueTaskIndex } from "../gamemodes/leagues-v/LeagueTaskIndex";
import { LeagueTaskManager } from "../gamemodes/leagues-v/LeagueTaskManager";
import { LEAGUE_TASK_COMPLETION_VARPS } from "../gamemodes/leagues-v/data/leagueTaskVarps";
import { getLeagueTaskByTaskId } from "../gamemodes/leagues-v/data/leagueTaskLookup";
import {
    type LevelReachTrigger,
    TriggerType,
} from "../gamemodes/leagues-v/triggers/TriggerTypes";

const PLAYER_ID = 42;
const FIRST_LEVEL_5_TASK_ID = 192;
const FIRST_LEVEL_UP_TASK_ID = 191;
/** Cache tasks whose names describe a level milestone. */
const LEVEL_TASK_COUNT = 66;

// ---------------------------------------------------------------------------
// Index / parser
// ---------------------------------------------------------------------------

const index = LeagueTaskIndex.build(undefined, undefined);
const levelTasks = index.getLevelReachTasks();

assert.equal(
    levelTasks.length,
    LEVEL_TASK_COUNT,
    "every cache level milestone task should be parsed",
);
assert.equal(index.getStats().indexSizes.levelReach, LEVEL_TASK_COUNT);

function triggerFor(taskId: number): LevelReachTrigger {
    const parsed = levelTasks.find((task) => task.taskId === taskId);
    assert.ok(parsed, `task ${taskId} should be indexed as a level task`);
    const trigger = parsed.trigger;
    assert.equal(trigger.type, TriggerType.LevelReach);
    return trigger as LevelReachTrigger;
}

// "Achieve Your First Level 5" - any skill, excluding the skills called out by
// the task description.
const level5Row = getLeagueTaskByTaskId(FIRST_LEVEL_5_TASK_ID);
assert.equal(level5Row?.points, 10);
assert.deepEqual(triggerFor(FIRST_LEVEL_5_TASK_ID), {
    type: TriggerType.LevelReach,
    scope: "any",
    level: 5,
    excludeSkillIds: [SkillId.Agility, SkillId.Hitpoints, SkillId.Runecraft],
});

// "Achieve Your First Level 10" excludes Agility + Hitpoints only.
assert.deepEqual(triggerFor(193).excludeSkillIds, [SkillId.Agility, SkillId.Hitpoints]);

// "Achieve Your First Level Up" fires on a real level-up, not on login.
assert.equal(triggerFor(FIRST_LEVEL_UP_TASK_ID).scope, "levelUp");

// Other milestone shapes.
assert.equal(triggerFor(205).scope, "total"); // Reach Total Level 500
assert.equal(triggerFor(205).level, 500);
assert.equal(triggerFor(215).scope, "all"); // Reach Base Level 5
assert.equal(triggerFor(215).level, 5);
assert.equal(triggerFor(403).scope, "combat"); // Reach Combat Level 50
assert.equal(triggerFor(403).level, 50);
const attack99 = triggerFor(226); // Reach Level 99 Attack
assert.equal(attack99.scope, "skill");
assert.equal(attack99.skillId, SkillId.Attack);
assert.equal(attack99.level, 99);

// Barbarian Assault roles are minigame progress, not skills.
assert.equal(
    levelTasks.some((task) => task.taskId === 739 || task.taskId === 740),
    false,
);

// ---------------------------------------------------------------------------
// Manager evaluation
// ---------------------------------------------------------------------------

function defaultLevels(): number[] {
    const levels = new Array(SKILL_COUNT).fill(1);
    levels[SkillId.Hitpoints] = 10;
    return levels;
}

function taskVarpId(taskId: number): number {
    const group = taskId >> 5;
    return LEAGUE_TASK_COMPLETION_VARPS[group] ?? 2616 + group;
}

function isTaskCompleted(varps: Map<number, number>, taskId: number): boolean {
    const mask = 1 << (taskId & 31);
    return ((varps.get(taskVarpId(taskId)) ?? 0) & mask) !== 0;
}

interface Harness {
    manager: LeagueTaskManager;
    varps: Map<number, number>;
    varbits: Map<number, number>;
    notifications: Array<{ title?: string; message?: string }>;
    levels(): number[];
    setLevels(levels: number[]): void;
    setCombatLevel(level: number): void;
    isComplete(taskId: number): boolean;
    claimedPoints(): number;
    completedTaskCount(): number;
}

function createHarness(startLevels: number[], startCombatLevel = 3): Harness {
    const varps = new Map<number, number>();
    const varbits = new Map<number, number>();
    const notifications: Array<{ title?: string; message?: string }> = [];
    let levels = [...startLevels];
    let combatLevel = startCombatLevel;

    const player = {
        varps: {
            getVarpValue: (id: number) => varps.get(id) ?? 0,
            setVarpValue: (id: number, value: number) => varps.set(id, value),
            getVarbitValue: (id: number) => varbits.get(id) ?? 0,
            setVarbitValue: (id: number, value: number) => varbits.set(id, value),
        },
        gamemodeState: new Map<string, unknown>(),
        getSkillLevels: () => levels,
        getTotalLevel: () => levels.reduce((sum, level) => sum + level, 0),
        getCombatLevel: () => combatLevel,
    };

    const manager = LeagueTaskManager.create(undefined, undefined, {
        getPlayer: (playerId) => (playerId === PLAYER_ID ? (player as never) : undefined),
        queueVarp: () => undefined,
        queueVarbit: () => undefined,
        queueNotification: (_playerId, notification) => {
            notifications.push(notification as { title?: string; message?: string });
        },
    });

    return {
        manager,
        varps,
        varbits,
        notifications,
        levels: () => levels,
        setLevels: (next) => {
            levels = [...next];
        },
        setCombatLevel: (next) => {
            combatLevel = next;
        },
        isComplete: (taskId) => isTaskCompleted(varps, taskId),
        claimedPoints: () => varps.get(VARP_LEAGUE_POINTS_CLAIMED) ?? 0,
        completedTaskCount: () => varbits.get(VARBIT_LEAGUE_TOTAL_TASKS_COMPLETED) ?? 0,
    };
}

// A brand new account starts at level 1 everywhere (Hitpoints at 10) and must
// not be handed level tasks - least of all "Achieve Your First Level Up".
{
    const harness = createHarness(defaultLevels());
    harness.manager.recheckLevelReachTasks(PLAYER_ID, "login");

    assert.equal(harness.isComplete(FIRST_LEVEL_UP_TASK_ID), false);
    assert.equal(harness.isComplete(FIRST_LEVEL_5_TASK_ID), false);
    assert.equal(harness.claimedPoints(), 0);
    assert.equal(harness.completedTaskCount(), 0);
    assert.equal(harness.notifications.length, 0);
}

// The reported bug: level 5 in a regular skill completes task 192 and pays the
// 10 league points, even when the level was already reached on login.
{
    const levels = defaultLevels();
    levels[SkillId.Woodcutting] = 5;

    const harness = createHarness(levels);
    harness.manager.recheckLevelReachTasks(PLAYER_ID, "login");

    assert.equal(harness.isComplete(FIRST_LEVEL_5_TASK_ID), true);
    // Reaching level 5 also proves the "first level up" milestone (task 191).
    assert.equal(harness.isComplete(FIRST_LEVEL_UP_TASK_ID), true);
    assert.equal(harness.claimedPoints(), 20); // 10 + 10
    assert.equal(harness.varps.get(VARP_LEAGUE_POINTS_COMPLETED), 20);
    assert.equal(harness.varps.get(VARP_LEAGUE_POINTS_CURRENCY), 20);
    assert.equal(harness.completedTaskCount(), 2);
    // Varp 2612 backs varbit 10046 - the client reads the task count from it.
    assert.equal((harness.varps.get(2612) ?? 0) & 0xffff, 2);
    assert.ok(
        harness.notifications.some(
            (notification) =>
                notification.message?.includes("Achieve Your First Level 5") &&
                notification.message?.includes("+10 League Points"),
        ),
        "the player should be told which task completed and how many points it paid",
    );
}

// Level-up event path: same task, reached live rather than on login.
{
    const harness = createHarness(defaultLevels());
    harness.manager.onSkillLevelUp(PLAYER_ID, SkillId.Crafting, 5);

    assert.equal(harness.isComplete(FIRST_LEVEL_5_TASK_ID), false);

    const reached = defaultLevels();
    reached[SkillId.Crafting] = 5;
    harness.setLevels(reached);
    harness.manager.onSkillLevelUp(PLAYER_ID, SkillId.Crafting, 5);

    assert.equal(harness.isComplete(FIRST_LEVEL_5_TASK_ID), true);
    assert.equal(harness.claimedPoints(), 20);
    assert.equal(harness.completedTaskCount(), 2);

    // Re-running must not pay twice.
    harness.manager.onSkillLevelUp(PLAYER_ID, SkillId.Crafting, 5);
    harness.manager.recheckLevelReachTasks(PLAYER_ID, "login");
    assert.equal(harness.claimedPoints(), 20);
    assert.equal(harness.completedTaskCount(), 2);
}


// Excluded skills do not count for "Achieve Your First Level 5".
for (const excluded of [SkillId.Agility, SkillId.Hitpoints, SkillId.Runecraft]) {
    const levels = defaultLevels();
    levels[excluded] = 5;

    const harness = createHarness(levels);
    harness.manager.recheckLevelReachTasks(PLAYER_ID, "login");
    assert.equal(
        harness.isComplete(FIRST_LEVEL_5_TASK_ID),
        false,
        `skill ${excluded} is excluded from task 192`,
    );
}

// "Achieve Your First Level Up" needs a real level-up, not just the starting
// Hitpoints level of 10, and is granted once any skill is trained.
{
    const harness = createHarness(defaultLevels());
    harness.manager.recheckLevelReachTasks(PLAYER_ID, "login");
    assert.equal(harness.isComplete(FIRST_LEVEL_UP_TASK_ID), false);

    const trained = defaultLevels();
    trained[SkillId.Mining] = 2;
    harness.setLevels(trained);
    harness.manager.recheckLevelReachTasks(PLAYER_ID, "login");
    assert.equal(harness.isComplete(FIRST_LEVEL_UP_TASK_ID), true);
    assert.equal(harness.isComplete(FIRST_LEVEL_5_TASK_ID), false);
}

// Total / base / combat milestones.
{
    const levels = defaultLevels();
    for (let skillId = 0; skillId < levels.length; skillId++) {
        levels[skillId] = 5;
    }

    const harness = createHarness(levels, 3);
    harness.manager.recheckLevelReachTasks(PLAYER_ID, "login");

    assert.equal(harness.isComplete(215), true, "Reach Base Level 5");
    // Every skill at level 5 also clears total level 100 but not 250.
    assert.equal(harness.isComplete(203), true, "Reach Total Level 100");
    assert.equal(harness.isComplete(204), false, "Reach Total Level 250 needs more");
    assert.equal(harness.isComplete(403), false, "Reach Combat Level 50 needs more combat");

    harness.setCombatLevel(50);
    harness.manager.recheckLevelReachTasks(PLAYER_ID, "login");
    assert.equal(harness.isComplete(403), true, "Reach Combat Level 50");
}

// A player the manager does not know about (not logged in) is a no-op.
{
    const harness = createHarness(defaultLevels());
    harness.manager.recheckLevelReachTasks(PLAYER_ID + 1, "login");
    assert.equal(harness.claimedPoints(), 0);
}

// End-to-end shape check: the manager consumes the same accessors the gamemode
// wires up in `server/gamemodes/leagues-v/index.ts`, backed by a real
// PlayerSkillSystem rather than a stub.
{
    registerSkillConfiguration({
        computeCombatLevel: () => 3,
        skillRestoreIntervalTicks: 100,
        skillBoostDecayIntervalTicks: 100,
        hitpointRegenIntervalTicks: 100,
        hitpointOverhealDecayIntervalTicks: 100,
        preserveDecayMultiplier: 1.5,
    });

    const skillSystem = new PlayerSkillSystem(
        new PlayerStatusState(),
        () => false,
        () => undefined,
    );
    skillSystem.setSkillXp(SkillId.Woodcutting, getXpForLevel(5));

    const varps = new Map<number, number>();
    const varbits = new Map<number, number>();
    const gamemodeState = new Map<string, unknown>();

    const manager = LeagueTaskManager.create(undefined, undefined, {
        getPlayer: (playerId) =>
            playerId === PLAYER_ID
                ? Object.assign(
                      {
                          varps: {
                              getVarpValue: (id: number) => varps.get(id) ?? 0,
                              setVarpValue: (id: number, value: number) => varps.set(id, value),
                              getVarbitValue: (id: number) => varbits.get(id) ?? 0,
                              setVarbitValue: (id: number, value: number) => varbits.set(id, value),
                          },
                          gamemodeState,
                      },
                      {
                          getSkillLevels: () =>
                              SKILL_IDS.map(
                                  (skillId) => skillSystem.getSkill(skillId).baseLevel,
                              ),
                          getTotalLevel: () => skillSystem.skillTotal,
                          getCombatLevel: () => skillSystem.combatLevel,
                      },
                  )
                : undefined,
        queueVarp: () => undefined,
        queueVarbit: () => undefined,
        queueNotification: () => undefined,
    });

    manager.recheckLevelReachTasks(PLAYER_ID, "login");

    assert.equal(skillSystem.getSkill(SkillId.Woodcutting).baseLevel, 5);
    assert.equal(isTaskCompleted(varps, FIRST_LEVEL_5_TASK_ID), true);
    assert.equal(isTaskCompleted(varps, FIRST_LEVEL_UP_TASK_ID), true);
    assert.equal(varps.get(VARP_LEAGUE_POINTS_CLAIMED), 20);
    assert.equal(varbits.get(VARBIT_LEAGUE_TOTAL_TASKS_COMPLETED), 2);
}

console.log("league level task tests passed");

