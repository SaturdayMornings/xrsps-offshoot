/**
 * Longsword attack animation tests.
 *
 * Every swing animation, stance override and attack speed the server uses comes
 * from the weapon data table in `gamemodes/vanilla/data/weapons.ts`. Equipping an
 * item that has no entry there is not a no-op: the weapon still gets a category
 * from its LONGSWORD interface, but it carries no attack sequence, so
 * PlayerCombatService falls through to the unarmed fallback and the player punches
 * with it. That is exactly what Vesta's longsword (22613) did until it was added.
 *
 * These tests pin the two halves together:
 *   1. every equippable LONGSWORD in the item data has a weapon table entry whose
 *      name matches the item definition (so a wrong id is loud, not silent),
 *   2. that entry carries the canonical longsword animation set shared by the rune
 *      and dragon longsword, and never the unarmed punch/kick,
 *   3. the live code path (PlayerCombatService + appearance stance overrides)
 *      returns real longsword animations for 22613.
 *
 * Run with:  npx tsx tests/weapon-longsword-animations.test.ts
 */
import { EquipmentSlot } from "../../client/rs/config/player/Equipment";
import {
    createCombatStyleSequenceProvider,
} from "../gamemodes/vanilla/combat/CombatStyleSequences";
import {
    CombatCategory,
    createWeaponDataProvider,
    getAttackAnimation,
    getAttackSequences,
    getWeaponData,
    weaponDataEntries,
    weaponDataMap,
} from "../gamemodes/vanilla/data/weapons";
import { getItemDefinition, loadItemDefinitions } from "../src/data/items";
import type { ServerServices } from "../src/game/ServerServices";
import {
    registerCombatStyleSequenceProvider,
} from "../src/game/combat/CombatStyleSequenceProvider";
import { registerSkillConfiguration } from "../src/game/combat/SkillConfigurationProvider";
import {
    registerWeaponDataProvider,
    type WeaponDataEntry,
} from "../src/game/combat/WeaponDataProvider";
import { getCategoryForWeaponInterface } from "../src/game/combat/WeaponInterfaces";
import { DEFAULT_EQUIP_SLOT_COUNT } from "../src/game/equipment";
import type { GamemodeDefinition } from "../src/game/gamemodes/GamemodeDefinition";
import { PlayerState } from "../src/game/player";
import { PlayerCombatService } from "../src/game/services/PlayerCombatService";

// Mirrors tests/bot-roam.test.ts: a stub gamemode plus a registered skill config is
// all a headless PlayerState needs, and these services never reach the pathfinder.
const TEST_GAMEMODE = {
    id: "weapon-longsword-animations-test",
    name: "Weapon longsword animation test",
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

// The vanilla gamemode wires these two providers at boot; the combat service reads
// weapon data and hit sounds through them, so the test registers the same pair.
registerWeaponDataProvider(createWeaponDataProvider());
registerCombatStyleSequenceProvider(createCombatStyleSequenceProvider());

// ============================================================================
// Minimal test harness (mirrors tests/bot-outfits.test.ts)
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
// Reference data
// ============================================================================

const VESTAS_LONGSWORD = 22613;
const RUNE_LONGSWORD = 1303;
const DRAGON_LONGSWORD = 1305;

/** Swing table every longsword shares: slash / slash / stab / slash. */
const CANONICAL_ATTACK_SEQS = { 0: 390, 1: 390, 2: 386, 3: 390 };
/** Stance: cache idle/walk/run plus human_sword_def_0 as the block. */
const CANONICAL_ANIM_OVERRIDES = { idle: 808, walk: 819, run: 824, block: 388 };
/** Sword hit sounds, selected by the style's attack type (slash / stab). */
const CANONICAL_HIT_SOUNDS = { stab: 2501, slash: 2500, crush: 2499 };
const CANONICAL_ATTACK_SPEED = 5;
const CANONICAL_HIT_DELAY = 1;
/** Unarmed swings — the fallback a weapon gets when the table has no sequence. */
const UNARMED_SWINGS = [422, 423];
const STYLE_SLOTS = [0, 1, 2, 3] as const;

/** Every longsword-style weapon the item data actually lets a player equip. */
function longswordItemIds(): number[] {
    return loadItemDefinitions()
        .filter((def) => def.equipmentType === "WEAPON" && def.weaponInterface === "LONGSWORD")
        .map((def) => def.id)
        .sort((a, b) => a - b);
}

function assertSame(actual: unknown, expected: unknown, label: string): void {
    assert(
        JSON.stringify(actual) === JSON.stringify(expected),
        `${label} is ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`,
    );
}

// ============================================================================
// PlayerCombatService harness
// ============================================================================

/**
 * Stand the combat service up the way the server does: weapon data comes off the
 * appearance service and the equip array off the equipment service. Nothing else
 * these code paths touch is needed.
 */
function createCombatService(): { service: PlayerCombatService; player: PlayerState } {
    const services = {
        appearanceService: { getWeaponData: () => weaponDataMap },
        equipmentService: { ensureEquipArray: (p: PlayerState) => p.appearance.equip },
        dataLoaderService: { getObjType: () => undefined },
    } as unknown as ServerServices;
    const player = new PlayerState(1, 3200, 3200, 0, TEST_GAMEMODE);
    return { service: new PlayerCombatService(services), player };
}

/**
 * Equip a weapon the way EquipmentService.updateWeaponCategory does: the weapon
 * table's category wins, and the weapon interface is only the fallback.
 */
function equipWeapon(player: PlayerState, itemId: number): void {
    const def = getItemDefinition(itemId);
    const category =
        getWeaponData(itemId)?.combatCategory ??
        getCategoryForWeaponInterface(def?.weaponInterface) ??
        0;
    player.appearance.equip[EquipmentSlot.WEAPON] = itemId;
    player.combat.weaponItemId = itemId;
    player.combat.weaponCategory = category;
    player.setCombatStyle(0, category);
}

/** Run `fn` with the player attacking on a specific style slot. */
function withStyleSlot(player: PlayerState, slot: number, fn: () => void): void {
    const previous = player.combat.styleSlot;
    player.combat.styleSlot = slot;
    try {
        fn();
    } finally {
        player.combat.styleSlot = previous;
    }
}

/** Expected swing for a style slot, straight from the canonical longsword table. */
function canonicalSwing(slot: number): number {
    return CANONICAL_ATTACK_SEQS[slot as keyof typeof CANONICAL_ATTACK_SEQS];
}

// ============================================================================
// Weapon table coverage
// ============================================================================

describe("longsword weapon table coverage", () => {
    it("has an entry for every equippable longsword in the item data", () => {
        const ids = longswordItemIds();
        assert(ids.length > 0, "item data has no LONGSWORD-interface weapons");
        for (const itemId of ids) {
            const def = getItemDefinition(itemId);
            assert(
                !!getWeaponData(itemId),
                `item ${itemId} (${def?.name}) has no weapon data entry, so it would swing unarmed`,
            );
        }
    });

    it("includes Vesta's longsword", () => {
        assert(
            longswordItemIds().includes(VESTAS_LONGSWORD),
            `${VESTAS_LONGSWORD} is not an equippable LONGSWORD in the item data`,
        );
        assert(!!getWeaponData(VESTAS_LONGSWORD), "Vesta's longsword has no weapon data entry");
    });

    it("still covers the bronze..dragon lineup", () => {
        const ids = longswordItemIds();
        const classic = [1291, 1293, 1295, 1297, 1299, 1301, 1303, 1305];
        for (const itemId of classic) {
            assert(ids.includes(itemId), `classic longsword ${itemId} missing from item data`);
            assert(!!getWeaponData(itemId), `classic longsword ${itemId} missing from weapon data`);
        }
    });

    it("names each entry after its item definition", () => {
        for (const itemId of longswordItemIds()) {
            const def = getItemDefinition(itemId);
            assertSame(getWeaponData(itemId)?.name, def?.name, `entry name for ${itemId}`);
        }
    });

    it("has exactly one entry per longsword id", () => {
        const ids = longswordItemIds();
        for (const itemId of ids) {
            const count = weaponDataEntries.filter((entry) => entry.itemId === itemId).length;
            assert(count === 1, `${itemId} has ${count} weapon table entries, want 1`);
        }
    });

    it("tags Vesta's longsword as a one-handed longsword weapon", () => {
        const entry = getWeaponData(VESTAS_LONGSWORD);
        assertSame(entry?.equipmentType, "longsword", "equipmentType");
        assertSame(entry?.combatCategory, CombatCategory.SCIMITAR, "combatCategory");
        assertSame(getItemDefinition(VESTAS_LONGSWORD)?.doubleHanded, false, "doubleHanded");
    });
});

// ============================================================================
// The canonical longsword animation set
// ============================================================================

describe("canonical longsword animations", () => {
    it("uses the shared slash/slash/stab/slash swing table", () => {
        for (const itemId of longswordItemIds()) {
            const entry = getWeaponData(itemId);
            assertSame(entry?.attackSequences, CANONICAL_ATTACK_SEQS, `swing table for ${itemId}`);
            assertSame(
                getAttackSequences(itemId),
                CANONICAL_ATTACK_SEQS,
                `resolved swings ${itemId}`,
            );
            for (const slot of STYLE_SLOTS) {
                assertSame(
                    getAttackAnimation(itemId, slot),
                    canonicalSwing(slot),
                    `swing for ${itemId} on style slot ${slot}`,
                );
            }
        }
    });

    it("uses the shared sword stance and block animation", () => {
        for (const itemId of longswordItemIds()) {
            assertSame(
                getWeaponData(itemId)?.animOverrides,
                CANONICAL_ANIM_OVERRIDES,
                `stance overrides for ${itemId}`,
            );
        }
    });

    it("swings every 5 ticks with sword hit sounds", () => {
        for (const itemId of longswordItemIds()) {
            const entry = getWeaponData(itemId);
            assertSame(entry?.attackSpeed, CANONICAL_ATTACK_SPEED, `attack speed for ${itemId}`);
            assertSame(entry?.hitDelay, CANONICAL_HIT_DELAY, `hit delay for ${itemId}`);
            assertSame(entry?.hitSounds, CANONICAL_HIT_SOUNDS, `hit sounds for ${itemId}`);
        }
    });

    it("never resolves a longsword to the unarmed swing", () => {
        for (const itemId of longswordItemIds()) {
            for (const slot of STYLE_SLOTS) {
                const anim = getAttackAnimation(itemId, slot);
                assert(
                    !UNARMED_SWINGS.includes(anim),
                    `${itemId} style slot ${slot} resolves to unarmed swing ${anim}`,
                );
            }
        }
    });
});

// ============================================================================
// Vesta's longsword parity with the rune / dragon longsword
// ============================================================================

describe("Vesta's longsword", () => {
    it("swings exactly like the rune and dragon longsword", () => {
        for (const referenceId of [RUNE_LONGSWORD, DRAGON_LONGSWORD]) {
            const reference = getWeaponData(referenceId);
            assert(!!reference, `reference longsword ${referenceId} missing from weapon data`);
            for (const slot of STYLE_SLOTS) {
                assertSame(
                    getAttackAnimation(VESTAS_LONGSWORD, slot),
                    getAttackAnimation(referenceId, slot),
                    `swing for ${VESTAS_LONGSWORD} vs ${referenceId} on style slot ${slot}`,
                );
            }
            assertSame(
                getWeaponData(VESTAS_LONGSWORD)?.animOverrides,
                reference?.animOverrides,
                `stance overrides vs ${referenceId}`,
            );
            assertSame(
                getWeaponData(VESTAS_LONGSWORD)?.combatCategory,
                reference?.combatCategory,
                `combat category vs ${referenceId}`,
            );
        }
    });

    it("uses the longsword swing table rather than the unarmed punch", () => {
        assertSame(getAttackSequences(VESTAS_LONGSWORD), CANONICAL_ATTACK_SEQS, "swing table");
        for (const slot of STYLE_SLOTS) {
            const anim = getAttackAnimation(VESTAS_LONGSWORD, slot);
            assert(
                anim === canonicalSwing(slot),
                `style slot ${slot} swings ${anim}, want ${canonicalSwing(slot)}`,
            );
            assert(!UNARMED_SWINGS.includes(anim), `style slot ${slot} still punches (${anim})`);
        }
    });
});

// ============================================================================
// The unarmed fallback this guards against
// ============================================================================

describe("unarmed fallback", () => {
    it("is what a weapon with no weapon table entry gets", () => {
        assertSame(getAttackAnimation(0, 0), UNARMED_SWINGS[0], "unknown weapon slot 0");
        assertSame(getAttackAnimation(0, 1), UNARMED_SWINGS[1], "unknown weapon slot 1");
        assert(!!getWeaponData(VESTAS_LONGSWORD), "Vesta's longsword fell back to no weapon data");
    });
});

// ============================================================================
// Live combat + appearance code paths
// ============================================================================

describe("live combat path", () => {
    it("plays a longsword swing for every style slot", () => {
        const { service, player } = createCombatService();
        equipWeapon(player, VESTAS_LONGSWORD);
        for (const slot of STYLE_SLOTS) {
            withStyleSlot(player, slot, () => {
                assertSame(
                    service.pickAttackSequence(player),
                    canonicalSwing(slot),
                    `pickAttackSequence on style slot ${slot}`,
                );
            });
        }
    });

    it("matches the rune longsword through the combat service", () => {
        const vesta = createCombatService();
        equipWeapon(vesta.player, VESTAS_LONGSWORD);
        const rune = createCombatService();
        equipWeapon(rune.player, RUNE_LONGSWORD);
        for (const slot of STYLE_SLOTS) {
            withStyleSlot(vesta.player, slot, () => {
                withStyleSlot(rune.player, slot, () => {
                    assertSame(
                        vesta.service.pickAttackSequence(vesta.player),
                        rune.service.pickAttackSequence(rune.player),
                        `pickAttackSequence on style slot ${slot}`,
                    );
                    assertSame(
                        vesta.service.pickCombatSound(vesta.player, true),
                        rune.service.pickCombatSound(rune.player, true),
                        `pickCombatSound on style slot ${slot}`,
                    );
                });
            });
        }
    });

    it("gives Vesta's longsword the sword block and 5-tick speed", () => {
        const { service, player } = createCombatService();
        equipWeapon(player, VESTAS_LONGSWORD);
        assertSame(service.pickBlockSequence(player), CANONICAL_ANIM_OVERRIDES.block, "block anim");
        assertSame(service.resolveBaseAttackSpeed(player), CANONICAL_ATTACK_SPEED, "attack speed");
        assertSame(service.pickAttackSpeed(player), CANONICAL_ATTACK_SPEED, "picked attack speed");
        assertSame(service.pickHitDelay(player), CANONICAL_HIT_DELAY, "hit delay");
    });

    it("plays the sword hit sounds, not the unarmed ones", () => {
        const { service, player } = createCombatService();
        equipWeapon(player, VESTAS_LONGSWORD);
        withStyleSlot(player, 0, () => {
            assertSame(
                service.pickCombatSound(player, true),
                CANONICAL_HIT_SOUNDS.slash,
                "slash sound",
            );
        });
        withStyleSlot(player, 2, () => {
            assertSame(
                service.pickCombatSound(player, true),
                CANONICAL_HIT_SOUNDS.stab,
                "stab sound",
            );
        });
    });

    it("sends the sword stance to clients", () => {
        // AppearanceService copies these overrides into the anim payload, so the
        // entry is what makes the client stand and walk with a sword, not fists.
        const entry = getWeaponData(VESTAS_LONGSWORD);
        assertSame(entry?.animOverrides?.idle, CANONICAL_ANIM_OVERRIDES.idle, "idle anim");
        assertSame(entry?.animOverrides?.walk, CANONICAL_ANIM_OVERRIDES.walk, "walk anim");
        assertSame(entry?.animOverrides?.run, CANONICAL_ANIM_OVERRIDES.run, "run anim");
        const { player } = createCombatService();
        equipWeapon(player, VESTAS_LONGSWORD);
        assert(
            player.appearance.equip[EquipmentSlot.WEAPON] === VESTAS_LONGSWORD,
            "weapon slot is not holding Vesta's longsword",
        );
        assert(
            player.appearance.equip.length === DEFAULT_EQUIP_SLOT_COUNT,
            "equip array is not the standard slot count",
        );
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
console.log("longsword animation tests OK");
