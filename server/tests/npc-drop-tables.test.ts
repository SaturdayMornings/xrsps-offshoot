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

console.log("npc drop table tests passed");
