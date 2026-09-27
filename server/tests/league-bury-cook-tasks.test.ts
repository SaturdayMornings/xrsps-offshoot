/**
 * Regression coverage for league tasks that complete on an item action.
 *
 *  - "Bury Some Bones" (task 97, 10 points) never registered: the trigger
 *    parser had no "bury" pattern and nothing in the game emitted a burial
 *    event, so burying bones completed nothing and paid no league points.
 *  - "Cook Shrimp" (task 296, 10 points) never registered either: cooking does
 *    emit `item:craft` (with the cooked "Shrimps", 315) but the parser looked
 *    the task's singular "Shrimp" up verbatim, found no item, and dropped the
 *    task at index build time.
 *
 * These tests cover the parser, the index and the manager against the real item
 * names in server/data/items.json.
 *
 * Run with: npx tsx tests/league-bury-cook-tasks.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
    VARBIT_LEAGUE_TOTAL_TASKS_COMPLETED,
    VARP_LEAGUE_POINTS_CLAIMED,
} from "../../client/common/vars";
import { register as registerPrayer } from "../gamemodes/vanilla/skills/prayer/prayer";
import type { IScriptRegistry, ScriptServices } from "../src/game/scripts/types";
import { LeagueTaskManager } from "../gamemodes/leagues-v/LeagueTaskManager";
import { LeagueTaskIndex } from "../gamemodes/leagues-v/LeagueTaskIndex";
import { LEAGUE_TASKS } from "../gamemodes/leagues-v/data/leagueTasks.data";
import { getLeagueTaskByTaskId } from "../gamemodes/leagues-v/data/leagueTaskLookup";
import {
    buildNameLookups,
    parseTaskTrigger,
    type TriggerParserLoaders,
} from "../gamemodes/leagues-v/triggers/TriggerParser";
import {
    type ItemBuryTrigger,
    type ItemCraftTrigger,
    type TaskTrigger,
    TriggerType,
} from "../gamemodes/leagues-v/triggers/TriggerTypes";

const PLAYER_ID = 42;
const BURY_BONES_TASK_ID = 97;
const BURY_WYVERN_OR_DRAGON_TASK_ID = 188;
const BURY_LAVA_DRAGON_TASK_ID = 971;
const COOK_SHRIMP_TASK_ID = 296;
/** A handful of stable cache ids referenced by the assertions below. */
const BONES = 526;
const BAT_BONES = 530;
const BIG_BONES = 532;
const DRAGON_BONES = 536;
const WYVERN_BONES = 6812;
const LONG_BONE = 10976;
const LAVA_DRAGON_BONES = 11943;
const SHRIMPS = 315;

// ---------------------------------------------------------------------------
// Real item-name lookups (the same loaders the server builds at startup)
// ---------------------------------------------------------------------------

interface ItemRow {
    id: number;
    name?: string;
}

function loadItemRows(): ItemRow[] {
    const candidates = ["./data/items.json", "../server/data/items.json"];
    const path = candidates.find((candidate) => existsSync(candidate));
    assert.ok(path, `could not find items.json (looked in ${candidates.join(", ")})`);
    return JSON.parse(readFileSync(path, "utf8")) as ItemRow[];
}

const itemsById = new Map<number, ItemRow>();
for (const row of loadItemRows()) {
    itemsById.set(row.id, row);
}

const objTypeLoader = { load: (id: number) => itemsById.get(id) };
const loaders: TriggerParserLoaders = buildNameLookups(undefined, objTypeLoader);
const index = LeagueTaskIndex.build(undefined, objTypeLoader);

function triggerFor(taskName: string): TaskTrigger | undefined {
    const row = LEAGUE_TASKS.find((task) => task.name === taskName);
    assert.ok(row, `task "${taskName}" should exist`);
    return parseTaskTrigger(row.name, row.description ?? "", loaders);
}

function triggerForTaskId(taskId: number): TaskTrigger | undefined {
    const row = getLeagueTaskByTaskId(taskId);
    assert.ok(row, `task ${taskId} should exist`);
    return parseTaskTrigger(row.name, row.description ?? "", loaders);
}

function buryTriggerFor(taskId: number): ItemBuryTrigger {
    const trigger = triggerForTaskId(taskId);
    assert.ok(trigger, `task ${taskId} should be parsed`);
    assert.equal(trigger.type, TriggerType.ItemBury, `task ${taskId} should be an ItemBury`);
    return trigger as ItemBuryTrigger;
}

function craftTriggerFor(taskId: number): ItemCraftTrigger {
    const trigger = triggerForTaskId(taskId);
    assert.ok(trigger, `task ${taskId} should be parsed`);
    assert.equal(trigger.type, TriggerType.ItemCraft, `task ${taskId} should be an ItemCraft`);
    return trigger as ItemCraftTrigger;
}

function itemNames(itemIds: readonly number[]): string[] {
    return itemIds.map((itemId) => (itemsById.get(itemId)?.name ?? `#${itemId}`).toLowerCase());
}


// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

// "Bury Some Bones" / "Bury any kind of Bones" means every bone in the cache.
{
    const trigger = buryTriggerFor(BURY_BONES_TASK_ID);
    for (const boneId of [BONES, BAT_BONES, BIG_BONES, DRAGON_BONES, LAVA_DRAGON_BONES]) {
        assert.ok(
            trigger.itemIds.includes(boneId),
            `"Bury Some Bones" should accept item ${boneId} (${itemsById.get(boneId)?.name})`,
        );
    }
    // Singular bone items are burial targets too (the prayer script buries them).
    assert.ok(trigger.itemIds.includes(LONG_BONE), "Long bone is buryable");
    assert.equal(trigger.count, undefined, "a single burial completes the task");
}

// "Bury Some Wyvern or Dragon Bones" lists two bone types sharing a noun.
{
    const trigger = buryTriggerFor(BURY_WYVERN_OR_DRAGON_TASK_ID);
    assert.ok(trigger.itemIds.includes(WYVERN_BONES), "Wyvern bones should count");
    assert.ok(trigger.itemIds.includes(DRAGON_BONES), "Dragon bones should count");
    assert.equal(trigger.itemIds.includes(BONES), false, "plain bones should not count");
}

// "Bury Some Lava Dragon Bones" is a single, specific bone type.
{
    const trigger = buryTriggerFor(BURY_LAVA_DRAGON_TASK_ID);
    assert.deepEqual(trigger.itemIds, [LAVA_DRAGON_BONES, 11944]);
}

// The reported bug: "Cook Shrimp" resolves to the cooked "Shrimps" the cooking
// script actually produces.
{
    const trigger = craftTriggerFor(COOK_SHRIMP_TASK_ID);
    assert.ok(trigger.itemIds.includes(SHRIMPS), "cooked Shrimps (315)");
    assert.equal(trigger.count, undefined);
    assert.ok(
        itemNames(trigger.itemIds).every((name) => name === "shrimps"),
        `"Cook Shrimp" should only track shrimps, got ${trigger.itemIds.join(", ")}`,
    );
}

// Regression: cook tasks that already resolved by exact name keep working...
{
    const trigger = triggerFor("Cook 100 Lobsters");
    assert.ok(trigger && trigger.type === TriggerType.ItemCraft, "Cook 100 Lobsters parses");
    assert.equal(trigger.count, 100);
    assert.ok(
        itemNames(trigger.itemIds).includes("lobster"),
        `Cook 100 Lobsters should track the cooked Lobster, got ${itemNames(trigger.itemIds).join(", ")}`,
    );
}

// ...and trailing location text no longer hides the item.
{
    const trigger = triggerFor("Cook 20 Sharks in Darkmeyer");
    assert.ok(trigger && trigger.type === TriggerType.ItemCraft, "location wording parses");
    assert.equal(trigger.count, 20);
    assert.ok(
        itemNames(trigger.itemIds).includes("shark"),
        `Cook 20 Sharks should track the cooked Shark, got ${itemNames(trigger.itemIds).join(", ")}`,
    );
}

// Cooked products whose cache name is prefixed ("Cooked karambwan") resolve too.
{
    const trigger = triggerFor("Cook 100 Karambwans");
    assert.ok(trigger && trigger.type === TriggerType.ItemCraft, "Cook 100 Karambwans parses");
    assert.equal(trigger.count, 100);
    assert.ok(
        itemNames(trigger.itemIds).includes("cooked karambwan"),
        `Cook 100 Karambwans should track the cooked Karambwan, got ${itemNames(trigger.itemIds).join(", ")}`,
    );
}


// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

function indexedTaskIds(tasks: ReadonlyArray<{ taskId: number }>): number[] {
    return tasks.map((task) => task.taskId);
}

assert.ok(
    indexedTaskIds(index.getTasksForItemBury(BONES)).includes(BURY_BONES_TASK_ID),
    "task 97 should be indexed against plain Bones",
);
assert.ok(
    indexedTaskIds(index.getTasksForItemBury(DRAGON_BONES)).includes(BURY_BONES_TASK_ID),
    '"Bury Some Bones" completes for any bone',
);
assert.ok(
    indexedTaskIds(index.getTasksForItemBury(LAVA_DRAGON_BONES)).includes(
        BURY_LAVA_DRAGON_TASK_ID,
    ),
    "task 11692 should be indexed against Lava dragon bones",
);
assert.ok(
    indexedTaskIds(index.getTasksForItemCraft(SHRIMPS)).includes(COOK_SHRIMP_TASK_ID),
    "task 296 should be indexed against Shrimps",
);

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

function taskVarpId(taskId: number): number {
    return 2616 + (taskId >> 5);
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
    isComplete(taskId: number): boolean;
    claimedPoints(): number;
    completedTaskCount(): number;
}

function createHarness(): Harness {
    const varps = new Map<number, number>();
    const varbits = new Map<number, number>();
    const notifications: Array<{ title?: string; message?: string }> = [];

    const player = {
        varps: {
            getVarpValue: (id: number) => varps.get(id) ?? 0,
            setVarpValue: (id: number, value: number) => varps.set(id, value),
            getVarbitValue: (id: number) => varbits.get(id) ?? 0,
            setVarbitValue: (id: number, value: number) => varbits.set(id, value),
        },
        gamemodeState: new Map<string, unknown>(),
    };

    const manager = LeagueTaskManager.create(undefined, objTypeLoader, {
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
        isComplete: (taskId) => isTaskCompleted(varps, taskId),
        claimedPoints: () => varps.get(VARP_LEAGUE_POINTS_CLAIMED) ?? 0,
        completedTaskCount: () => varbits.get(VARBIT_LEAGUE_TOTAL_TASKS_COMPLETED) ?? 0,
    };
}

// Burying bones completes "Bury Some Bones" and pays its 10 points.
{
    const harness = createHarness();

    // Unrelated burials and unknown players are no-ops.
    harness.manager.onItemBury(PLAYER_ID, 2); // a non-bone item
    harness.manager.onItemBury(PLAYER_ID + 1, BONES); // not logged in
    assert.equal(harness.isComplete(BURY_BONES_TASK_ID), false);

    harness.manager.onItemBury(PLAYER_ID, BONES);

    assert.equal(harness.isComplete(BURY_BONES_TASK_ID), true, "task 97 completes");
    assert.equal(harness.claimedPoints(), 10);
    assert.equal(harness.completedTaskCount(), 1);
    assert.ok(
        harness.notifications.some(
            (notification) =>
                notification.message?.includes("Bury Some Bones") &&
                notification.message?.includes("+10 League Points"),
        ),
        "the player should be told which task completed and how many points it paid",
    );

    // Re-burying the same bone must not pay twice.
    harness.manager.onItemBury(PLAYER_ID, BONES);
    assert.equal(harness.claimedPoints(), 10);
    assert.equal(harness.completedTaskCount(), 1);

    // Dragon bones are their own task ("Bury Some Wyvern or Dragon Bones").
    const dragonTaskPoints = getLeagueTaskByTaskId(BURY_WYVERN_OR_DRAGON_TASK_ID)?.points ?? 0;
    harness.manager.onItemBury(PLAYER_ID, DRAGON_BONES);
    assert.equal(harness.isComplete(BURY_WYVERN_OR_DRAGON_TASK_ID), true, "task 188 completes");
    assert.equal(harness.claimedPoints(), 10 + dragonTaskPoints);
    assert.equal(harness.completedTaskCount(), 2);
}

// Cooking shrimps completes "Cook Shrimp" and pays its 10 points.
{
    const harness = createHarness();

    harness.manager.onItemCraft(PLAYER_ID, SHRIMPS, 1);

    assert.equal(harness.isComplete(COOK_SHRIMP_TASK_ID), true, "task 296 completes");
    assert.equal(harness.claimedPoints(), 10);
    assert.equal(harness.completedTaskCount(), 1);
    assert.ok(
        harness.notifications.some((notification) =>
            notification.message?.includes("Cook Shrimp"),
        ),
        'the player should be told that "Cook Shrimp" completed',
    );

    harness.manager.onItemCraft(PLAYER_ID, SHRIMPS, 1);
    assert.equal(harness.claimedPoints(), 10);
    assert.equal(harness.completedTaskCount(), 1);
}

// Both tasks together: bury then cook, exactly 20 points / 2 tasks.
{
    const harness = createHarness();

    harness.manager.onItemBury(PLAYER_ID, BIG_BONES);
    harness.manager.onItemCraft(PLAYER_ID, SHRIMPS, 1);

    assert.equal(harness.isComplete(BURY_BONES_TASK_ID), true);
    assert.equal(harness.isComplete(COOK_SHRIMP_TASK_ID), true);
    assert.equal(harness.claimedPoints(), 20);
    assert.equal(harness.completedTaskCount(), 2);
}

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

// The parser/index/manager are useless without something telling them a bone
// was buried: the prayer script is that source, and it uses the same event
// subscription the gamemode installs (`eventBus.on("item:bury", ...)`).
{
    const emitted: Array<{ name: string; payload: unknown }> = [];
    let buryHandler: ((ctx: unknown) => void) | undefined;

    const registry = new Proxy(
        {},
        {
            get: (_target, property) => (...args: unknown[]) => {
                if (property === "registerItemAction" && args[2] === "bury") {
                    const itemId = args[0] as number;
                    if (itemId === BONES) buryHandler = args[1] as (ctx: unknown) => void;
                }
                return { dispose() {} };
            },
        },
    ) as unknown as IScriptRegistry;

    const services = {
        system: {
            eventBus: {
                emit: (name: string, payload: unknown) => emitted.push({ name, payload }),
            },
        },
        inventory: {
            consumeItem: () => true,
            snapshotInventoryImmediate: () => undefined,
        },
        animation: { playPlayerSeq: () => undefined },
        sound: { playLocSound: () => undefined },
        data: { getObjType: () => ({ name: "Bones" }) },
        messaging: { sendGameMessage: () => undefined },
        skills: { addSkillXp: () => undefined },
    } as unknown as ScriptServices;

    registerPrayer(registry, services);
    assert.ok(buryHandler, "the prayer script should register a bury action for Bones");

    buryHandler({
        tick: 1,
        player: { id: PLAYER_ID, tileX: 0, tileY: 0, level: 0 },
        source: { slot: 0, itemId: BONES },
        services,
    });

    const buryEvent = emitted.find((entry) => entry.name === "item:bury");
    assert.ok(buryEvent, "burying bones should emit item:bury");
    assert.deepEqual(buryEvent.payload, { playerId: PLAYER_ID, itemId: BONES, count: 1 });
}

console.log("league bury/cook task tests passed");

console.log("league bury/cook task tests passed");

