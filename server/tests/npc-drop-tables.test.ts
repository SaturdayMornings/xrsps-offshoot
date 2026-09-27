/**
 * NPC drop table coverage.
 *
 *  - Cuffs (npcTypeId 3279) must drop 100,000,000 coins (100M) on every kill. The
 *    NPC is attackable (cache actions: Talk-to / Attack / Pickpocket) and the
 *    guarantee comes from `MANUAL_NPC_DROP_OVERRIDES`, which takes precedence
 *    over the imported OSRS tables.
 *
 * These assertions go through the real registry and roll service, so a change
 * that stops the manual table from being picked up fails here rather than
 * silently dropping nothing in game.
 *
 * Run with: npx tsx tests/npc-drop-tables.test.ts
 */
import assert from "node:assert/strict";

import type { NpcTypeLoader } from "../../client/rs/config/npctype/NpcTypeLoader";
import { DropRollService } from "../src/game/drops/DropRollService";
import { resolveItemId } from "../src/game/drops/helpers";
import { NpcDropRegistry } from "../src/game/drops/NpcDropRegistry";
import type { DropContext } from "../src/game/drops/types";

const CUFFS_NPC_TYPE_ID = 3279;
const COINS = 995;
const EXPECTED_COINS = 100_000_000;
/** Every kill must be identical, so assert a sample of rolls. */
const ROLLS = 25;

// The manual table path never touches the cache, so the stub records whether it
// was asked for anything at all and reports unknown NPC types otherwise.
const loadCalls: number[] = [];
const stubLoader = {
    load: (id: number) => {
        loadCalls.push(id);
        return undefined;
    },
} as unknown as NpcTypeLoader;

const registry = new NpcDropRegistry(stubLoader);
const rollService = new DropRollService(registry);

function context(npcTypeId: number, npcName: string): DropContext {
    return {
        npcTypeId,
        npcName,
        tile: { x: 2986, y: 3434, level: 0 },
        isWilderness: false,
        recipients: [{ dropRateMultiplier: 1 }],
    };
}

// The registry resolves the manual override for Cuffs.
{
    const table = registry.get(CUFFS_NPC_TYPE_ID);
    assert.ok(table, `npc ${CUFFS_NPC_TYPE_ID} should have a drop table`);
    assert.equal(table.always.length, 1, "the table should hold a single always-drop");
    assert.equal(table.always[0].itemId, COINS, "the always-drop should be Coins (995)");
    assert.deepEqual(table.always[0].quantity, { min: EXPECTED_COINS, max: EXPECTED_COINS });
    assert.equal(table.pools.length, 0, "Cuffs should not roll any extra pools");
}

// Every kill rolls 100,000,000 coins, exactly once.
for (let roll = 0; roll < ROLLS; roll++) {
    const drops = rollService.roll(context(CUFFS_NPC_TYPE_ID, "Cuffs"));

    assert.equal(drops.length, 1, `roll ${roll}: Cuffs should drop exactly one stack`);
    const [coins] = drops;
    assert.equal(coins.itemId, COINS, `roll ${roll}: the drop should be Coins`);
    assert.equal(
        coins.quantity,
        EXPECTED_COINS,
        `roll ${roll}: the drop should be 100,000,000 coins`,
    );
    assert.equal(coins.isMonsterDrop, true, `roll ${roll}: the drop should be flagged as a drop`);
    assert.deepEqual(coins.tile, { x: 2986, y: 3434, level: 0 }, `roll ${roll}: drop tile`);
}

// Serving Cuffs never needed the cache: the manual override answered directly.
assert.deepEqual(loadCalls, [], "the Cuffs table should come from the manual override");

// The override is scoped to Cuffs: unrelated NPCs resolve nothing.
{
    const other = registry.get(1);
    assert.equal(other, undefined, "unrelated npc types should not resolve a manual table");
    assert.deepEqual(
        rollService.roll(context(3105, "Hans")),
        [],
        "an NPC without a table should roll nothing",
    );
    assert.deepEqual(loadCalls, [1, 3105], "only the unrelated npcs should be looked up in cache");
}

/**
 * Wiki drop-table regressions (ids from the OSRS Wiki `dropsline` bucket):
 * Rock Crabs (100-103) get their own table and drop no bones, armed level 2
 * goblins (5192/5193/5204-5208) and the level 13 goblin (3046) move to goblin
 * drop table 2, the Vault of War (2484-2489) and Goblin Village (655-668)
 * goblins share that table, and the God Wars Dungeon goblins (2245-2249) get
 * their own table with the ecumenical key and the wilderness looting bag.
 */
const BONES = 526;
const LOOTING_BAG = 11941;
const ECUMENICAL_KEY = 11942;
const GOBLIN_CHAMPION_SCROLL = 6801;
const NATURE_TALISMAN = 1462;

const GOBLIN_TABLE_1_IDS = [3028, 3037, 3044, 3051, 5195, 5203];
const GOBLIN_TABLE_2_IDS = [
    5192, 5193, 5204, 5205, 5206, 5207, 5208, 3045, 3073, 3074, 3075, 3076, 3046, 2484, 2485, 2486,
    2487, 2488, 2489, 655, 656, 657, 658, 659, 660, 661, 662, 663, 664, 665, 666, 667, 668,
];
const GWD_GOBLIN_IDS = [2245, 2246, 2247, 2248, 2249];
const ROCK_CRAB_IDS = [100, 101, 102, 103];

type ResolvedTable = NonNullable<ReturnType<NpcDropRegistry["get"]>>;

function tableFor(npcTypeId: number): ResolvedTable {
    const table = registry.get(npcTypeId);
    assert.ok(table, `npc ${npcTypeId} should resolve a drop table`);
    return table;
}

function itemIdOf(itemName: string): number {
    const itemId = resolveItemId({ itemName });
    assert.ok(itemId, `"${itemName}" should resolve to an item id`);
    return itemId;
}

function findEntry(table: ResolvedTable, itemId: number) {
    for (const pool of table.pools) {
        for (const entry of pool.entries) {
            if (entry.itemId === itemId) return { pool, entry };
        }
    }
    return undefined;
}

function assertDrop(table: ResolvedTable, itemId: number, expected: number, label: string): void {
    const found = findEntry(table, itemId);
    assert.ok(found, `${label}: item ${itemId} should be listed`);
    assert.ok(
        Math.abs((found.entry.probability ?? -1) - expected) < 1e-6,
        `${label}: item ${itemId} should have probability ${expected}, got ${found.entry.probability}`,
    );
}

// Rock Crabs: own table, no bones, sea/oyster loot, ~14% nothing.
{
    const crab = tableFor(ROCK_CRAB_IDS[0]);
    for (const id of ROCK_CRAB_IDS) {
        assert.equal(tableFor(id), crab, `npc ${id} should share the Rock Crab table`);
    }
    assert.notEqual(crab, tableFor(3028), "Rock Crabs must not share the goblin table");
    assert.deepEqual(crab.always, [], "Rock Crabs have no always-drops");
    assert.equal(findEntry(crab, BONES), undefined, "Rock Crabs must not drop bones");
    assert.equal(findEntry(crab, itemIdOf("Air talisman")), undefined, "no goblin loot");
    assertDrop(crab, itemIdOf("Bronze pickaxe"), 6 / 128, "Rock Crab");
    assertDrop(crab, itemIdOf("Coins"), 29 / 128, "Rock Crab");
    assertDrop(crab, NATURE_TALISMAN, 1 / 5461.33, "Rock Crab gem table");
    const nothing = crab.pools[0].nothingProbability;
    // The wiki's "Nothing 19/128" (≈0.148) also covers the gem table's blank
    // rolls, so the resolver lands slightly higher (~0.152).
    assert.ok(
        nothing > 0.14 && nothing < 0.16,
        `Rock Crab nothing should be ~15%, got ${nothing}`,
    );
}

// Goblins: table 1 (plain level 2) vs table 2 (armed 2 / 5 / 13, Vault, Village).
{
    const table1 = tableFor(GOBLIN_TABLE_1_IDS[0]);
    const table2 = tableFor(GOBLIN_TABLE_2_IDS[0]);
    assert.notEqual(table1, table2, "goblin drop table 1 and 2 must stay separate");
    for (const id of GOBLIN_TABLE_1_IDS) {
        assert.equal(tableFor(id), table1, `npc ${id} should use goblin drop table 1`);
    }
    for (const id of GOBLIN_TABLE_2_IDS) {
        assert.equal(tableFor(id), table2, `npc ${id} should use goblin drop table 2`);
    }
    assertDrop(table1, itemIdOf("Water rune"), 6 / 128, "goblin table 1");
    assert.equal(findEntry(table1, itemIdOf("Grapes")), undefined, "table 1 has no level 5 loot");
    assertDrop(table2, itemIdOf("Bronze axe"), 3 / 128, "goblin table 2");
    assertDrop(table2, itemIdOf("Grapes"), 1 / 128, "goblin table 2");
    assertDrop(table2, itemIdOf("Grimy guam leaf"), 1 / 256, "goblin table 2 herbs");
    const head = findEntry(table2, itemIdOf("Ensouled goblin head"));
    assert.ok(head, "table 2 should drop ensouled goblin heads");
    assert.equal(head.pool.kind, "independent", "tertiary goblin drops roll independently");
    assert.ok(findEntry(table2, GOBLIN_CHAMPION_SCROLL), "table 2 should drop champion scrolls");
}

// God Wars Dungeon goblins: own table, bones always, key + wilderness looting bag.
{
    const gwd = tableFor(GWD_GOBLIN_IDS[0]);
    for (const id of GWD_GOBLIN_IDS) {
        assert.equal(tableFor(id), gwd, `npc ${id} should share the GWD goblin table`);
    }
    assert.notEqual(gwd, tableFor(GOBLIN_TABLE_2_IDS[0]), "GWD goblins must not reuse table 2");
    assert.equal(gwd.always.some((entry) => entry.itemId === BONES), true, "bones always drop");
    assertDrop(gwd, ECUMENICAL_KEY, 1 / 60, "GWD goblin");
    assertDrop(gwd, itemIdOf("Grimy guam leaf"), 1 / 256, "GWD goblin herbs");
    const bag = findEntry(gwd, LOOTING_BAG);
    assert.ok(bag, "GWD goblins should list a looting bag drop");
    assert.equal(bag.entry.probability, 1 / 11, "looting bag base rate");
    assert.equal(bag.entry.altProbability, 1 / 10, "looting bag alt rate");
    assert.equal(bag.entry.condition?.wildernessOnly, true, "looting bag is wilderness only");
}

console.log("npc drop table tests passed");
