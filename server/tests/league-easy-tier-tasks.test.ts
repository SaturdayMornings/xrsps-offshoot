/**
 * Easy tier (tier 1, 10 point) league tasks: coverage audit + behaviour.
 *
 * A league task only registers when three layers line up:
 *  1. the task name parses into a trigger (TriggerParser),
 *  2. the trigger is indexed by the matching id (LeagueTaskIndex),
 *  3. a game system emits the matching event and the leagues gamemode
 *     subscribes to it (LeagueTaskManager).
 *
 * "Bury Some Bones" (layer 3 was missing) and the level milestones (layer 1/2)
 * both shipped broken, so this suite locks down all three layers for the easy
 * tier: it lists every task that must stay wired, every task that is known to
 * need content the server does not implement yet, and drives the manager end to
 * end for each trigger family.
 *
 * Run with: npx tsx tests/league-easy-tier-tasks.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

import {
    VARBIT_LEAGUE_TOTAL_TASKS_COMPLETED,
    VARP_LEAGUE_POINTS_CLAIMED,
} from "../../client/common/vars";
import { LeagueContentProvider } from "../gamemodes/leagues-v/LeagueContentProvider";
import { LeagueTaskIndex } from "../gamemodes/leagues-v/LeagueTaskIndex";
import { LeagueTaskManager } from "../gamemodes/leagues-v/LeagueTaskManager";
import {
    CUSTOM_STRUCT_RANGES,
    CUSTOM_TASK_RANGE,
    ENUM_IDS,
    getAllCustomTasks,
} from "../gamemodes/leagues-v/data/custom";
import { LEAGUE_TASK_COMPLETION_VARPS } from "../gamemodes/leagues-v/data/leagueTaskVarps";
import { LEAGUE_TASKS } from "../gamemodes/leagues-v/data/leagueTasks.data";
import {
    buildNameLookups,
    parseTaskTrigger,
    type TriggerParserLoaders,
} from "../gamemodes/leagues-v/triggers/TriggerParser";
import { TriggerType } from "../gamemodes/leagues-v/triggers/TriggerTypes";
import { resolveImplementedQuestKey } from "../gamemodes/vanilla/quests";

const PLAYER_ID = 7;

// ---------------------------------------------------------------------------
// Loaders (the same shapes the server builds at startup, from the JSON dumps)
// ---------------------------------------------------------------------------

interface ItemRow {
    id: number;
    name?: string;
}
interface SpawnRow {
    id: number;
    name?: string;
}

function loadJson<T>(candidates: string[]): T {
    const path = candidates.find((candidate) => existsSync(candidate));
    assert.ok(path, `could not find any of ${candidates.join(", ")}`);
    return JSON.parse(readFileSync(path, "utf8")) as T;
}

const items = loadJson<ItemRow[]>(["data/items.json", "server/data/items.json"]);
const spawns = loadJson<SpawnRow[]>(["data/npc-spawns.json", "server/data/npc-spawns.json"]);

const itemsById = new Map<number, ItemRow>();
for (const row of items) itemsById.set(row.id, row);

const npcsById = new Map<number, { name?: string }>();
for (const row of spawns) {
    if (!npcsById.has(row.id)) npcsById.set(row.id, { name: row.name });
}

const npcTypeLoader = { load: (id: number) => npcsById.get(id) };
const objTypeLoader = { load: (id: number) => itemsById.get(id) };

const loaders: TriggerParserLoaders = {
    ...buildNameLookups(npcTypeLoader, objTypeLoader),
    getQuestKeyByName: resolveImplementedQuestKey,
};

const index = LeagueTaskIndex.build(npcTypeLoader, objTypeLoader, {
    getQuestKeyByName: resolveImplementedQuestKey,
});

function itemName(itemId: number): string {
    return itemsById.get(itemId)?.name ?? `#${itemId}`;
}

function triggerFor(taskId: number) {
    const row = LEAGUE_TASKS.find((task) => task.taskId === taskId);
    assert.ok(row, `task ${taskId} should exist`);
    return parseTaskTrigger(row.name, row.description ?? "", loaders);
}

function easyTaskIds(): number[] {
    return LEAGUE_TASKS.filter((task) => task.tier === 1 && task.points === 10).map(
        (task) => task.taskId,
    );
}

function registeredEasyTaskIds(): Set<number> {
    const registered = new Set<number>();
    for (const task of LEAGUE_TASKS) {
        if (task.tier !== 1 || task.points !== 10) continue;
        if (parseTaskTrigger(task.name, task.description ?? "", loaders)) {
            registered.add(task.taskId);
        }
    }
    return registered;
}


// ---------------------------------------------------------------------------
// Coverage audit
// ---------------------------------------------------------------------------

// The tier is 272 cache tasks worth 10 points each; if the cache data ever
// changes this assertion should be updated deliberately. ("Kill a Man" is the
// 273rd easy task and lives in the custom task registry instead - see below.)
{
    const easy = easyTaskIds();
    assert.equal(easy.length, 272, "there should be 272 easy (10 point) cache tasks");
}

// Regression baseline. Before this pass only 71 of the 273 easy tasks were
// registered (measured with the real cache loaders); the cache-free loaders used
// here miss a handful of items/NPCs, so the guard is set just below what they
// report today. A drop means a task silently stopped registering.
const registered = registeredEasyTaskIds();
{
    const before = 71;
    assert.ok(
        registered.size >= before,
        `easy task coverage regressed: ${registered.size} registered (was ${before} before the fix)`,
    );
    assert.ok(
        registered.size >= 105,
        `expected at least 105 easy tasks to be wired, got ${registered.size}`,
    );
}

// Every one of these is verified end to end: the trigger is parsed, indexed and
// a game system emits the matching event.
const MUST_REGISTER: ReadonlyArray<[number, string]> = [
    // NPC kills (npc:death)
    [61, "Defeat a Moss Giant"],
    [63, "Defeat a Goblin"],
    [1554, "Kill a Rat"],
    [1559, "Kill a Chicken with your fists"],
    [1552, "Kill a Spider by kicking it"],
    // ("Kill a Man" is not a cache task: it is defined in the custom task
    // registry and covered by the custom task section below.)
    // Burying (item:bury)
    [97, "Bury Some Bones"],
    // NPC interactions (npc:interact)
    [1556, "Talk to Hans"],
    [564, "Talk to Ilfeen in Tirannwn"],
    [1334, "Charm Gertrude"],
    [498, "Pet a Stray Dog in Varrock"],
    [1775, "Stroke your cat"],
    // Gathering / obtaining (item:obtain)
    [340, "Catch a Shrimp"],
    [341, "Catch a Herring"],
    [342, "Catch an Anchovy"],
    [1548, "Catch a Salmon"],
    [644, "Catch a Karambwanji"],
    [303, "Mine some Copper Ore"],
    [1371, "Mine 5 Tin Ore"],
    [304, "Mine some Ore With a Steel Pickaxe"],
    [1801, "Mine some essence"],
    [289, "Chop Some Logs"],
    [290, "Chop Some Logs With a Steel Axe"],
    [291, "Obtain a Bird Nest"],
    [1842, "Pick up Snapegrass"],
    [1714, "Pick some Sweetcorn from a Field"],
    // Crafting / producing (item:craft)
    [296, "Cook Shrimp"],
    [297, "Burn Some Food"],
    [371, "Burn Some Normal Logs"],
    [372, "Burn Some Oak Logs"],
    [347, "Smelt a Bronze Bar"],
    [348, "Smelt an Iron Bar"],
    [331, "Spin a Ball of Wool"],
    [332, "Cut a Sapphire"],
    [310, "Fletch Some Arrow Shafts"],
    [311, "Fletch an Oak Shortbow"],
    [333, "Craft a Leather Body"],
    [391, "Clean a Grimy Guam"],
    [392, "Make an Attack Potion"],
    [1366, "Create an Antipoison"],
    [1784, "Clean 25 Grimy Guam Leafs"],
    [1785, "Clean 15 Grimy Tarromin"],
    [1373, "Smith a Bronze full helm"],
    [1374, "Smith a Bronze plateskirt"],
    [365, "Craft Any Rune"],
    [774, "Craft an Air Rune"],
    // Equipping (equipment:equip)
    [321, "Equip a Spiny Helmet"],
    [421, "Equip a Studded Body and Chaps"],
    [430, "Equip an Elemental Staff"],
    [1560, "Equip an Iron dagger"],
    [1286, "Equip a Protest Banner"],
    // Level milestones (skill:levelUp / login recheck)
    [191, "Achieve Your First Level Up"],
    [192, "Achieve Your First Level 5"],
    [401, "Reach Combat Level 10"],
    // Quests (quest:complete / login recheck)
    [492, "Complete Rune Mysteries"],
    [504, "Complete Romeo & Juliet"],
    [506, "Complete Gertrude's Cat"],
    [510, "Complete The Restless Ghost"],
];

for (const [taskId, name] of MUST_REGISTER) {
    assert.ok(
        registered.has(taskId),
        `easy task ${taskId} "${name}" must register so a player can complete it`,
    );
}

// ---------------------------------------------------------------------------
// Custom tasks: registered ids, indexed trigger, and renderable by the client
// ---------------------------------------------------------------------------

// "Kill a Man" is not a cache task, so it is defined in CUSTOM_TASKS. It only
// reaches the player when three layers line up, and the third one used to be
// missing entirely (the task existed in the data but no client enum listed it,
// so it never rendered in the task list):
//  1. the registry assigns a synthetic taskId (1856+, group 58 = varp 4046),
//  2. the trigger is indexed by npc id (indexCustomTask needs task.trigger),
//  3. the payload tells the client which league task enum to insert the struct
//     into (enumGroupId) and ships the struct params it renders.
{
    const killAMan = getAllCustomTasks().find((task) => task.name === "Kill a Man");
    assert.ok(killAMan, `"Kill a Man" must be registered as a custom task`);

    assert.equal(
        killAMan.taskId,
        CUSTOM_TASK_RANGE.TASK_ID_BASE,
        "the first custom task takes the first custom taskId (group 58)",
    );
    assert.ok(
        killAMan.taskId >> 5 === 58,
        `custom task ids must stay in groups 58-61 (handled by the CS2 script), got group ${killAMan.taskId >> 5}`,
    );
    assert.equal(
        killAMan.structId,
        CUSTOM_STRUCT_RANGES.TASKS.start,
        "custom task structs come from the dedicated 90000+ range",
    );
    assert.equal(
        killAMan.enumGroupId,
        ENUM_IDS.L5_TASKS,
        "the client can only render tasks it can insert into the league task enum",
    );

    // The client renders STRUCT_PARAM(name 874 / tier 2044 / taskId 873); custom
    // structs have no cache struct, so the payload has to carry the values.
    assert.equal(killAMan.params?.[874], "Kill a Man", "name param");
    assert.equal(killAMan.params?.[875], "Kill a Man", "description param");
    assert.equal(killAMan.params?.[873], killAMan.taskId, "taskId param");
    assert.equal(killAMan.params?.[2044], 1, "tier param (league 5)");

    // Killing any NPC named "Man" completes it.
    for (const npcId of [1118, 3106, 11057]) {
        assert.ok(
            index.getTasksForNpcKill(npcId).some((task) => task.taskId === killAMan.taskId),
            `killing npc ${npcId} (a Man) should complete "Kill a Man"`,
        );
    }

    // Completion writes the varp the client's CS2 script reads back
    // (league_task_is_completed -> group 58 -> %league_task_completed_58).
    assert.equal(taskVarpId(killAMan.taskId), 4046, "group 58 maps to varp 4046");

    const harness = createHarness();
    harness.manager.onNpcKill(PLAYER_ID, 3106, 1);
    assert.equal(
        harness.isComplete(killAMan.taskId),
        true,
        `"Kill a Man" completes when a Man is killed`,
    );
    assert.ok(harness.claimedPoints() >= 10, "and pays its 10 league points");
    assert.equal(harness.completedTaskCount() >= 1, true);

    // The client can only do any of that if the fields survive the payload it
    // actually receives (JSON + deflate inside the gamemode content packet).
    const provider = new LeagueContentProvider();
    provider.build();
    const packet = (provider as unknown as { cachedPacket: Uint8Array | null }).cachedPacket;
    assert.ok(packet, "LeagueContentProvider must build a content packet");
    const dataLen = (packet[1] << 8) | packet[2];
    const payload = JSON.parse(
        inflateSync(Buffer.from(packet.subarray(8, 3 + dataLen))).toString("utf8"),
    ) as { datasets: Array<{ key: string; rows: Array<Record<string, any>> }> };

    const payloadRow = payload.datasets
        .find((dataset) => dataset.key === "customTasks")
        ?.rows.find((row) => row.name === "Kill a Man");
    assert.ok(payloadRow, `"Kill a Man" must be in the customTasks payload dataset`);
    assert.equal(
        payloadRow.enumGroupId,
        ENUM_IDS.L5_TASKS,
        "the payload has to announce the enum group or the client never lists the task",
    );
    assert.equal(payloadRow.params?.[874], "Kill a Man", "and ship the struct params it renders");
    assert.equal(payloadRow.params?.[873], killAMan.taskId, "including the taskId param");
    assert.equal(payloadRow.structId, killAMan.structId, "structId must match the registry");
}

// Tasks that need content this server does not implement. They must stay
// unparsed: registering them would look like support while never firing, which
// is exactly the bug this pass fixed ("Bury Some Bones" style dead triggers).
const KNOWN_UNSUPPORTED: ReadonlyArray<[number, string]> = [
    [0, "Complete Client of Kourend (quest not implemented)"],
    [67, "1 Wintertodt Kill (no Wintertodt)"],
    [71, "Complete 1 Farming Contract (no Farming)"],
    [94, "Restore 5 Prayer Points at an Altar (no altar praying)"],
    [273, "Pickpocket a Citizen (no thieving action trigger)"],
    [318, "Receive a Slayer Task (no Slayer)"],
    [388, "Complete a Rooftop Agility Course (no course laps)"],
    [410, "Perform a Special Attack (no special attack event)"],
    [431, "Cast Home Teleport (no home teleport event)"],
    [508, "Use a Fairy Ring (no fairy rings)"],
    [364, "Visit the Rune Essence Mine (no region-enter trigger)"],
    [831, "Room 1 of Pyramid Plunder (no Pyramid Plunder)"],
    [956, "Complete an Easy Temple Trek (no Temple Trekking)"],
    [1525, "Use the Falador Party room (no party room)"],
];

for (const [taskId, reason] of KNOWN_UNSUPPORTED) {
    assert.equal(
        registered.has(taskId),
        false,
        `easy task ${taskId} should stay unparsed until its content exists: ${reason}`,
    );
}


// ---------------------------------------------------------------------------
// Parser: the wording families the easy tier relies on
// ---------------------------------------------------------------------------

// Gathering names the raw item ("Catch a Shrimp" = Raw shrimps, 317) ...
{
    const trigger = triggerFor(340) as { type: string; itemIds: number[] };
    assert.equal(trigger.type, TriggerType.ItemObtain);
    assert.ok(
        trigger.itemIds.includes(317),
        `"Catch a Shrimp" should target raw shrimps (317), got ${trigger.itemIds
            .map(itemName)
            .join(", ")}`,
    );

    // ... while cooking names the cooked item, otherwise the wrong item would
    // complete the fishing task from the cooking event.
    const cooked = triggerFor(296) as { type: string; itemIds: number[] };
    assert.equal(cooked.type, TriggerType.ItemCraft);
    assert.ok(cooked.itemIds.includes(315), `"Cook Shrimp" should target shrimps (315)`);
    assert.equal(
        cooked.itemIds.includes(317),
        false,
        `"Cook Shrimp" must not accept the raw shrimps the fishing task wants`,
    );
}

// "any kind of logs" / "any type of rune" expand to the whole item family.
{
    const logs = triggerFor(289) as { itemIds: number[] };
    for (const logId of [1511, 1521, 1519, 1513]) {
        assert.ok(logs.itemIds.includes(logId), `"Chop Some Logs" should accept ${itemName(logId)}`);
    }

    const runes = triggerFor(365) as { itemIds: number[] };
    for (const runeId of [556, 554, 555]) {
        assert.ok(
            runes.itemIds.includes(runeId),
            `"Craft Any Rune" should accept ${itemName(runeId)}`,
        );
    }
}

// "Burn Some Food" targets the burnt items cooking produces (not "Fish food").
{
    const trigger = triggerFor(297) as { type: string; itemIds: number[] };
    assert.equal(trigger.type, TriggerType.ItemCraft);
    assert.ok(trigger.itemIds.includes(323), `"Burn Some Food" should accept Burnt fish (323)`);
    assert.equal(
        trigger.itemIds.includes(272),
        false,
        `"Fish food" is an item the player can obtain, not something they burn`,
    );
    assert.equal(
        trigger.itemIds.every((itemId) => /^burnt/i.test(itemName(itemId))),
        true,
        `every target of "Burn Some Food" should be a burnt item`,
    );
}

// "Chop Some Logs With a Steel Axe" keeps the log target (the axe qualifier is
// not modelled, which over-accepts rather than never registering).
{
    const trigger = triggerFor(290) as { type: string; itemIds: number[] };
    assert.equal(trigger.type, TriggerType.ItemObtain);
    assert.ok(trigger.itemIds.includes(1511));
}

// "Mine some Ore With a Steel Pickaxe" resolves the ore family.
{
    const trigger = triggerFor(304) as { type: string; itemIds: number[] };
    assert.equal(trigger.type, TriggerType.ItemObtain);
    for (const oreId of [436, 438, 440]) {
        assert.ok(trigger.itemIds.includes(oreId), `should accept ${itemName(oreId)}`);
    }
}

// Multi-item equips resolve every part, including the shared adjective.
{
    const studded = triggerFor(421) as { type: string; itemIds: number[] };
    assert.equal(studded.type, TriggerType.ItemEquip);
    assert.ok(studded.itemIds.includes(1133), `Studded body (1133) should count`);
    assert.ok(studded.itemIds.includes(1097), `Studded chaps (1097) should count`);

    const staff = triggerFor(430) as { itemIds: number[] };
    for (const staffId of [1381, 1383, 1385, 1387]) {
        assert.ok(staff.itemIds.includes(staffId), `elemental staff ${staffId} should count`);
    }
}

// Counted tasks carry their count.
{
    assert.equal((triggerFor(1371) as { count?: number }).count, 5, "Mine 5 Tin Ore");
    assert.equal((triggerFor(1784) as { count?: number }).count, 25, "Clean 25 Grimy Guam Leafs");
}

// Quest tasks carry the stable quest key and stay unparsed for quests the
// server does not implement.
{
    const trigger = triggerFor(492) as { type: string; questKey?: string };
    assert.equal(trigger.type, TriggerType.QuestComplete);
    assert.equal(trigger.questKey, "rune_mysteries");
    assert.equal(triggerFor(0), undefined, "unimplemented quests must stay unparsed");
}

// ---------------------------------------------------------------------------
// Index: the triggers are reachable by id
// ---------------------------------------------------------------------------

{
    assert.ok(
        index.getTasksForItemObtain(317).some((task) => task.taskId === 340),
        `the index should route a raw shrimps pickup to "Catch a Shrimp"`,
    );
    assert.ok(
        index.getTasksForItemCraft(1521).some((task) => task.taskId === 372),
        `the index should route lighting oak logs to "Burn Some Oak Logs"`,
    );
    assert.ok(
        index.getTasksForItemCraft(323).some((task) => task.taskId === 297),
        `the index should route burning food to "Burn Some Food"`,
    );
    assert.ok(
        index.getTasksForItemEquip(1097).some((task) => task.taskId === 421),
        `the index should route studded chaps to "Equip a Studded Body and Chaps"`,
    );
    assert.ok(
        index.getTasksForNpcKill(2090).some((task) => task.taskId === 61),
        `the index should route a moss giant kill to "Defeat a Moss Giant"`,
    );
    assert.ok(
        index.getTasksForNpcInteract(3105).some((task) => task.taskId === 1556),
        `the index should route talking to Hans to "Talk to Hans"`,
    );
    assert.ok(
        index.getLevelReachTasks().some((task) => task.taskId === 191),
        "level milestones should be indexed",
    );
    assert.ok(
        index.getQuestCompleteTasks().some((task) => task.taskId === 492),
        "quest tasks should be indexed",
    );
}

// ---------------------------------------------------------------------------
// Manager: each trigger family completes its task and pays 10 points
// ---------------------------------------------------------------------------

function taskVarpId(taskId: number): number {
    return LEAGUE_TASK_COMPLETION_VARPS[taskId >> 5] ?? 2616 + (taskId >> 5);
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
    completeQuests(...questKeys: string[]): void;
    isComplete(taskId: number): boolean;
    claimedPoints(): number;
    completedTaskCount(): number;
}

function createHarness(): Harness {
    const varps = new Map<number, number>();
    const varbits = new Map<number, number>();
    const notifications: Array<{ title?: string; message?: string }> = [];
    const completedQuests = new Set<string>();

    const player = {
        varps: {
            getVarpValue: (id: number) => varps.get(id) ?? 0,
            setVarpValue: (id: number, value: number) => varps.set(id, value),
            getVarbitValue: (id: number) => varbits.get(id) ?? 0,
            setVarbitValue: (id: number, value: number) => varbits.set(id, value),
        },
        gamemodeState: new Map<string, unknown>(),
        isQuestComplete: (questKey: string) => completedQuests.has(questKey),
    };

    const manager = LeagueTaskManager.create(npcTypeLoader, objTypeLoader, {
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
        completeQuests: (...questKeys) => {
            for (const key of questKeys) completedQuests.add(key);
        },
        isComplete: (taskId) => isTaskCompleted(varps, taskId),
        claimedPoints: () => varps.get(VARP_LEAGUE_POINTS_CLAIMED) ?? 0,
        completedTaskCount: () => varbits.get(VARBIT_LEAGUE_TOTAL_TASKS_COMPLETED) ?? 0,
    };
}

// Gathering: the raw shrimps fishing hands out completes "Catch a Shrimp".
{
    const harness = createHarness();

    // An item no league task cares about is a no-op, and unknown players are
    // ignored entirely.
    harness.manager.onItemObtain(PLAYER_ID, 999_999, 1);
    harness.manager.onItemObtain(PLAYER_ID + 1, 317, 1);
    assert.equal(harness.isComplete(340), false);
    assert.equal(harness.claimedPoints(), 0);

    harness.manager.onItemObtain(PLAYER_ID, 317, 1);

    assert.equal(harness.isComplete(340), true, `"Catch a Shrimp" completes`);
    assert.equal(harness.claimedPoints(), 10, "and pays its 10 league points");
    assert.equal(harness.completedTaskCount(), 1);
    assert.ok(
        harness.notifications.some(
            (notification) =>
                notification.message?.includes("Catch a Shrimp") &&
                notification.message?.includes("+10 League Points"),
        ),
        "the player should be told which task completed and how many points it paid",
    );

    // Obtaining more of the same item must not pay twice.
    harness.manager.onItemObtain(PLAYER_ID, 317, 5);
    assert.equal(harness.claimedPoints(), 10);
}

// Counted gathering: "Mine 5 Tin Ore" only completes on the fifth ore.
// (Tin ore is also a target of higher tier tasks, so only the 1371 task and its
// reward notification are asserted here.)
{
    const harness = createHarness();

    for (let i = 0; i < 4; i++) {
        harness.manager.onItemObtain(PLAYER_ID, 438, 1);
    }
    assert.equal(harness.isComplete(1371), false, "four of five ores is not enough");

    const pointsBefore = harness.claimedPoints();
    const countBefore = harness.completedTaskCount();
    harness.manager.onItemObtain(PLAYER_ID, 438, 1);

    assert.equal(harness.isComplete(1371), true, "the fifth ore completes the task");
    assert.ok(
        harness.completedTaskCount() > countBefore,
        "completing the task should be counted in the task total",
    );
    assert.ok(
        harness.claimedPoints() >= pointsBefore + 10,
        "the task should pay its 10 league points",
    );
    assert.ok(
        harness.notifications.some(
            (notification) =>
                notification.message?.includes("Mine 5 Tin Ore") &&
                notification.message?.includes("+10 League Points"),
        ),
        `the completed task should announce its 10 point reward`,
    );
}

// Firemaking: lighting oak logs completes "Burn Some Oak Logs".
{
    const harness = createHarness();
    harness.manager.onItemCraft(PLAYER_ID, 1521, 1);
    assert.equal(harness.isComplete(372), true);
    assert.equal(harness.claimedPoints(), 10);
}

// Cooking a burnt item completes "Burn Some Food".
{
    const harness = createHarness();
    harness.manager.onItemCraft(PLAYER_ID, 323, 1);
    assert.equal(harness.isComplete(297), true, `"Burn Some Food" completes`);
    assert.equal(harness.claimedPoints(), 10);
}

// Smithing: smelting a bronze bar completes "Smelt a Bronze Bar".
{
    const harness = createHarness();
    harness.manager.onItemCraft(PLAYER_ID, 2349, 1);
    assert.equal(harness.isComplete(347), true);
    assert.equal(harness.claimedPoints(), 10);
}

// Herblore: cleaning a grimy guam completes "Clean a Grimy Guam".
{
    const harness = createHarness();
    harness.manager.onItemCraft(PLAYER_ID, 199, 1);
    assert.equal(harness.isComplete(391), true);
    assert.equal(harness.claimedPoints(), 10);
}

// Equipping a spiny helmet completes "Equip a Spiny Helmet", and either half of
// the studded pair completes "Equip a Studded Body and Chaps".
{
    const harness = createHarness();
    harness.manager.onItemEquip(PLAYER_ID, 4551);
    assert.equal(harness.isComplete(321), true);
    assert.equal(harness.claimedPoints(), 10);

    harness.manager.onItemEquip(PLAYER_ID, 1097);
    assert.equal(harness.isComplete(421), true);
    assert.equal(harness.claimedPoints(), 20);
}

// Killing a moss giant completes "Defeat a Moss Giant" (task 532, "Defeat a
// Moss Giant in Tirannwn", shares the same NPCs). Each should pay 10 points and
// announce itself.
{
    const harness = createHarness();
    const pointsBefore = harness.claimedPoints();
    harness.manager.onNpcKill(PLAYER_ID, 2090, 5);

    assert.equal(harness.isComplete(61), true);
    assert.ok(harness.claimedPoints() >= pointsBefore + 10, "the kill should pay its points");
    assert.ok(
        harness.notifications.some(
            (notification) =>
                notification.message?.includes("Defeat a Moss Giant") &&
                notification.message?.includes("+10 League Points"),
        ),
        `the completed kill task should announce its 10 point reward`,
    );
}

// Talking to an NPC completes its interaction task.
{
    const harness = createHarness();
    const pointsBefore = harness.claimedPoints();

    // Interacting with an unrelated NPC is a no-op.
    harness.manager.onNpcInteract(PLAYER_ID, 1, "talk-to");
    assert.equal(harness.isComplete(1556), false);

    harness.manager.onNpcInteract(PLAYER_ID, 3105, "talk-to");

    assert.equal(harness.isComplete(1556), true, `"Talk to Hans" completes`);
    assert.ok(
        harness.claimedPoints() >= pointsBefore + 10,
        `the interaction should pay its 10 league points`,
    );
    assert.ok(
        harness.notifications.some(
            (notification) =>
                notification.message?.includes("Talk to Hans") &&
                notification.message?.includes("+10 League Points"),
        ),
        `the completed task should announce its 10 point reward`,
    );
}

// Quests: completing Rune Mysteries completes "Complete Rune Mysteries", both
// from the live event and from the login catch-up for a quest finished earlier.
{
    const harness = createHarness();
    harness.completeQuests("rune_mysteries");

    // Login catch-up: the quest is already complete, only the task is missing.
    harness.manager.recheckQuestTasks(PLAYER_ID, "login");
    assert.equal(harness.isComplete(492), true, "login recheck registers the quest task");
    assert.equal(harness.claimedPoints(), 10);

    // A quest the player has not finished must not complete anything.
    harness.manager.onQuestComplete(PLAYER_ID, "cooks_assistant");
    assert.equal(harness.claimedPoints(), 10);

    // The live event path works for a fresh player too.
    const live = createHarness();
    live.completeQuests("gertrudes_cat");
    live.manager.onQuestComplete(PLAYER_ID, "gertrudes_cat");
    assert.equal(live.isComplete(506), true);
    assert.equal(live.claimedPoints(), 10);
}

// eslint-disable-next-line no-console
console.log("league-easy-tier-tasks: all assertions passed");
