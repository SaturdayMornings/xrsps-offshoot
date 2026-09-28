/**
 * Ambient bot outfit tests.
 *
 * Bots have no inventory and never equip anything, so their entire look is the
 * appearance `equip` array built from a BotOutfit. That makes the outfit data the
 * only thing between a bot and a naked model, which is why this validates it
 * against the real item definitions instead of trusting the hard-coded ids: every
 * id must resolve, must be a wearable (not a note), and must sit in a slot its
 * equipment type actually allows.
 *
 * Run with:  npx tsx tests/bot-outfits.test.ts
 */
import { EquipmentSlot } from "../../client/rs/config/player/Equipment";
import { registerSkillConfiguration } from "../src/game/combat/SkillConfigurationProvider";
import { getItemDefinition } from "../src/data/items";
import {
    BOT_OUTFIT_BLACK_DHIDE_RANGER,
    BOT_OUTFIT_BLACK_MYSTIC_MAGE,
    BOT_OUTFIT_ROTATION,
    BOT_OUTFIT_RUNE_MELEE,
    buildBotEquip,
    pickBotOutfit,
    type BotOutfit,
} from "../src/game/botOutfits";
import { DEFAULT_EQUIP_SLOT_COUNT } from "../src/game/equipment";
import type { GamemodeDefinition } from "../src/game/gamemodes/GamemodeDefinition";
import { PlayerManager } from "../src/game/player";
import type { PathService } from "../src/pathfinding/PathService";

// Mirrors tests/bot-roam.test.ts: a stub gamemode plus a registered skill config is
// all a headless PlayerState needs, and addBot never reaches into the pathfinder.
const TEST_GAMEMODE = {
    id: "bot-outfit-test",
    name: "Bot outfit test",
    initializePlayer: () => undefined,
    canInteract: () => true,
} as GamemodeDefinition;

registerSkillConfiguration({
    computeCombatLevel: () => 3,
    skillRestoreIntervalTicks: 100,
    skillBoostDecayIntervalTicks: 100,
    hitpointRegenIntervalTicks: 100,
    hitpointOverhealDecayIntervalTicks: 100,
    preserveDecayMultiplier: 1.5,
});

// ============================================================================
// Minimal test harness (mirrors tests/bot-roam.test.ts)
// ============================================================================

let passed = 0;
let failed = 0;
const failures: string[] = [];
let currentDescribe = "";
let currentIt = "";

function assert(condition: boolean, msg: string): void {
    if (condition) {
        passed++;
    } else {
        failed++;
        failures.push(`${currentDescribe} > ${currentIt} — ${msg}`);
        console.error(`  FAIL: ${msg}`);
    }
}

function describe(name: string, fn: () => void): void {
    currentDescribe = name;
    console.log(`\n${name}`);
    fn();
}

function it(name: string, fn: () => void): void {
    currentIt = name;
    try {
        fn();
    } catch (e: unknown) {
        failed++;
        const err = e as { message?: string };
        const detail = `${name} — threw: ${err.message ?? String(e)}`;
        failures.push(`${currentDescribe} > ${detail}`);
        console.error(`  FAIL: ${detail}`);
    }
}


// ============================================================================
// Helpers
// ============================================================================

/** The single slot an item's equipment type is allowed to occupy. */
const SLOT_FOR_EQUIPMENT_TYPE: Record<string, EquipmentSlot> = {
    FULL_HELMET: EquipmentSlot.HEAD,
    MED_HELMET: EquipmentSlot.HEAD,
    HAT: EquipmentSlot.HEAD,
    COIF: EquipmentSlot.HEAD,
    MASK: EquipmentSlot.HEAD,
    CAPE: EquipmentSlot.CAPE,
    AMULET: EquipmentSlot.AMULET,
    WEAPON: EquipmentSlot.WEAPON,
    BODY: EquipmentSlot.BODY,
    PLATEBODY: EquipmentSlot.BODY,
    SHIELD: EquipmentSlot.SHIELD,
    LEGS: EquipmentSlot.LEGS,
    GLOVES: EquipmentSlot.GLOVES,
    BOOTS: EquipmentSlot.BOOTS,
    RING: EquipmentSlot.RING,
    ARROWS: EquipmentSlot.AMMO,
};

const EVERY_OUTFIT: ReadonlyArray<BotOutfit> = [
    BOT_OUTFIT_RUNE_MELEE,
    BOT_OUTFIT_BLACK_DHIDE_RANGER,
    BOT_OUTFIT_BLACK_MYSTIC_MAGE,
];

/** Slots an outfit actually fills, as `[slot, itemId]` pairs. */
function filledSlots(outfit: BotOutfit): Array<[number, number]> {
    const equip = buildBotEquip(outfit);
    const filled: Array<[number, number]> = [];
    for (let slot = 0; slot < equip.length; slot++) {
        if (equip[slot] > 0) filled.push([slot, equip[slot]]);
    }
    return filled;
}

/** Item names an outfit wears, in slot order; used to assert a requested look. */
function wornNames(outfit: BotOutfit): string[] {
    return filledSlots(outfit).map(([, id]) => getItemDefinition(id)?.name ?? `#${id}`);
}

// How wsServer.initTestBots() spreads its five spawns around the Grand Exchange.
const GE_BOT_COUNT = 5;

// ============================================================================
// Assertions
// ============================================================================

describe("outfit data", () => {
    it("every outfit builds a full-length equip array", () => {
        for (const outfit of EVERY_OUTFIT) {
            const equip = buildBotEquip(outfit);
            assert(
                equip.length === DEFAULT_EQUIP_SLOT_COUNT,
                `${outfit.id}: equip has ${equip.length} slots; expected ${DEFAULT_EQUIP_SLOT_COUNT}`,
            );
            assert(equip.length === 14, `${outfit.id}: appearance.equip must stay 14 slots wide`);
            for (let slot = 0; slot < equip.length; slot++) {
                const value = equip[slot];
                assert(
                    value === -1 || value > 0,
                    `${outfit.id}: slot ${slot} is ${value}; expected an item id or -1`,
                );
            }
        }
    });

    it("outfits are named and uniquely identified", () => {
        const ids = new Set<string>();
        for (const outfit of EVERY_OUTFIT) {
            assert(outfit.id.length > 0, "an outfit has an empty id");
            assert(filledSlots(outfit).length > 0, `${outfit.id}: outfit wears nothing at all`);
            assert(!ids.has(outfit.id), `duplicate outfit id: ${outfit.id}`);
            ids.add(outfit.id);
        }
    });

    it("buildBotEquip drops slots outside the array length", () => {
        const equip = buildBotEquip({ id: "test", equip: { [EquipmentSlot.HEAD]: 1163 } }, 3);
        assert(equip.length === 3, `expected 3 slots, got ${equip.length}`);
        assert(equip[EquipmentSlot.HEAD] === 1163, "head item was dropped");
        assert(equip[1] === -1 && equip[2] === -1, "unmentioned slots must stay empty (-1)");
    });
});

describe("outfit item ids", () => {
    it("every item id resolves to a real definition", () => {
        for (const outfit of EVERY_OUTFIT) {
            for (const [slot, itemId] of filledSlots(outfit)) {
                const def = getItemDefinition(itemId);
                assert(
                    def !== undefined,
                    `${outfit.id}: slot ${slot} uses unknown item id ${itemId}`,
                );
            }
        }
    });

    it("every item is wearable rather than a bank note", () => {
        for (const outfit of EVERY_OUTFIT) {
            for (const [slot, itemId] of filledSlots(outfit)) {
                const def = getItemDefinition(itemId);
                if (!def) continue;
                assert(!def.noted, `${outfit.id}: slot ${slot} wears the note ${def.name}`);
                assert(
                    !!def.equipmentType && def.equipmentType !== "NONE",
                    `${outfit.id}: slot ${slot} wears ${def.name}, which has no equipment type`,
                );
            }
        }
    });

    it("every item sits in a slot its equipment type allows", () => {
        for (const outfit of EVERY_OUTFIT) {
            for (const [slot, itemId] of filledSlots(outfit)) {
                const def = getItemDefinition(itemId);
                if (!def?.equipmentType) continue;
                const expected = SLOT_FOR_EQUIPMENT_TYPE[def.equipmentType];
                assert(
                    expected !== undefined,
                    `${def.name}: unmapped equipment type ${def.equipmentType}`,
                );
                assert(
                    expected === slot,
                    `${outfit.id}: ${def.name} (${def.equipmentType}) is in slot ${slot}; expected ${expected}`,
                );
            }
        }
    });

    it("no outfit pairs a two-handed weapon with a shield", () => {
        for (const outfit of EVERY_OUTFIT) {
            const equip = buildBotEquip(outfit);
            const weaponId = equip[EquipmentSlot.WEAPON];
            const shieldId = equip[EquipmentSlot.SHIELD];
            if (weaponId <= 0 || shieldId <= 0) continue;
            const weapon = getItemDefinition(weaponId);
            assert(
                !weapon?.doubleHanded,
                `${outfit.id}: two-handed ${weapon?.name} cannot be worn with a shield`,
            );
        }
    });
});

describe("the two requested looks", () => {
    it("the ranger wears black dragonhide with a magic shortbow", () => {
        const equip = buildBotEquip(BOT_OUTFIT_BLACK_DHIDE_RANGER);
        assert(equip[EquipmentSlot.WEAPON] === 861, "weapon is not the magic shortbow (861)");
        assert(equip[EquipmentSlot.BODY] === 2503, "body is not the black d'hide body (2503)");
        assert(equip[EquipmentSlot.LEGS] === 2497, "legs are not black d'hide chaps (2497)");
        assert(equip[EquipmentSlot.GLOVES] === 2491, "hands are not black d'hide vambraces (2491)");

        for (const name of wornNames(BOT_OUTFIT_BLACK_DHIDE_RANGER)) {
            const lowered = name.toLowerCase();
            assert(
                lowered.includes("black d'hide") || lowered.includes("shortbow"),
                `ranger wears ${name}, which is not black d'hide or the shortbow`,
            );
        }
        assert(
            filledSlots(BOT_OUTFIT_BLACK_DHIDE_RANGER).length === 4,
            "the ranger should wear exactly body, chaps, vambraces and the bow",
        );
    });

    it("the mage wears the complete black mystic set plus a lava battlestaff", () => {
        const equip = buildBotEquip(BOT_OUTFIT_BLACK_MYSTIC_MAGE);
        assert(equip[EquipmentSlot.HEAD] === 4099, "head is not the mystic hat (dark) (4099)");
        assert(equip[EquipmentSlot.BODY] === 4101, "body is not mystic robe top (dark) (4101)");
        assert(equip[EquipmentSlot.LEGS] === 4103, "legs are not mystic robe bottom (dark) (4103)");
        assert(equip[EquipmentSlot.GLOVES] === 4105, "hands are not mystic gloves (dark) (4105)");
        assert(equip[EquipmentSlot.BOOTS] === 4107, "feet are not mystic boots (dark) (4107)");
        assert(equip[EquipmentSlot.WEAPON] === 3053, "weapon is not the lava battlestaff (3053)");

        const lava = getItemDefinition(3053);
        assert(
            lava?.weaponInterface === "STAFF",
            `lava battlestaff interface is ${lava?.weaponInterface}; expected STAFF`,
        );
        for (const name of wornNames(BOT_OUTFIT_BLACK_MYSTIC_MAGE)) {
            const lowered = name.toLowerCase();
            assert(
                lowered.includes("mystic") || lowered.includes("lava battlestaff"),
                `mage wears ${name}, which is not mystic or the battlestaff`,
            );
        }
        assert(
            filledSlots(BOT_OUTFIT_BLACK_MYSTIC_MAGE).length === 6,
            "the mage should wear exactly the five set pieces plus the staff",
        );
    });
});

describe("Grand Exchange crowd composition", () => {
    it("the plaza is a mix, not a uniform set", () => {
        const ids = new Set<string>();
        for (let index = 0; index < GE_BOT_COUNT; index++) {
            ids.add(pickBotOutfit(index).id);
        }
        assert(ids.size === 2, `five bots produced ${ids.size} distinct look(s); expected 2`);
        assert(ids.has(BOT_OUTFIT_BLACK_MYSTIC_MAGE.id), "no bot wears the black mystic set");
        assert(ids.has(BOT_OUTFIT_BLACK_DHIDE_RANGER.id), "no bot wears black d'hide");
    });

    it("the autocasting bot (spawn 0) is the battlestaff mage", () => {
        assert(
            pickBotOutfit(0) === BOT_OUTFIT_BLACK_MYSTIC_MAGE,
            `spawn 0 wears ${pickBotOutfit(0).id}; the caster should hold the staff`,
        );
    });

    it("the rotation wraps and tolerates odd indices", () => {
        const count = BOT_OUTFIT_ROTATION.length;
        assert(count > 1, "rotation must contain more than one look");
        assert(pickBotOutfit(count) === pickBotOutfit(0), "index `count` did not wrap to 0");
        assert(pickBotOutfit(-1) === pickBotOutfit(count - 1), "negative index did not wrap");
        assert(pickBotOutfit(2.7) === pickBotOutfit(2), "fractional index was not truncated");
    });
});

describe("PlayerManager.addBot", () => {
    it("dresses the bot in the requested outfit", () => {
        const players = new PlayerManager(TEST_GAMEMODE, {} as PathService);
        for (const outfit of EVERY_OUTFIT) {
            const bot = players.addBot(3168, 3475, 0, "OutfitTest", outfit);
            assert(!!bot, `${outfit.id}: addBot returned undefined (id pool exhausted)`);
            if (!bot) continue;
            const equip = bot.appearance?.equip ?? [];
            assert(
                equip.length === DEFAULT_EQUIP_SLOT_COUNT,
                `${outfit.id}: bot appearance has ${equip.length} slots`,
            );
            const expected = buildBotEquip(outfit);
            for (let slot = 0; slot < expected.length; slot++) {
                assert(
                    equip[slot] === expected[slot],
                    `${outfit.id}: bot slot ${slot} is ${equip[slot]}, want ${expected[slot]}`,
                );
            }
        }
    });

    it("still defaults to the rune melee look callers relied on", () => {
        const players = new PlayerManager(TEST_GAMEMODE, {} as PathService);
        const bot = players.addBot(3168, 3475, 0, "DefaultOutfit");
        assert(!!bot, "addBot returned undefined (id pool exhausted)");
        if (!bot) return;
        const equip = bot.appearance?.equip ?? [];
        const expected = buildBotEquip(BOT_OUTFIT_RUNE_MELEE);
        for (let slot = 0; slot < expected.length; slot++) {
            assert(
                equip[slot] === expected[slot],
                `default slot ${slot} is ${equip[slot]}, want ${expected[slot]}`,
            );
        }
    });
});

// ============================================================================
// Summary
// ============================================================================

console.log(`\n${"-".repeat(60)}`);
console.log(`passed: ${passed}   failed: ${failed}`);
if (failed > 0) {
    console.log("\nFailures:");
    for (const line of failures) console.log(`  - ${line}`);
    process.exit(1);
}
console.log("bot outfit tests OK");
