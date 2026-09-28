/**
 * Player appearance — arms visibility tests.
 *
 * Both the server (`PlayerAppearanceManager.refreshAppearanceKits`) and the client
 * (`PlayerModelLoader`) suppress the base identity-kit body parts that a worn item
 * replaces. Torso + arms used to be suppressed together for *any* body item, which
 * is only true for tops whose worn model carries sleeves. The black d'hide body
 * (and the chainbodies, leather bodies, studded bodies, aprons, ...) is a
 * torso-only model, so dropping the arms kit left those models armless — the bug
 * that made the GE's black d'hide ranger bots walk around without arms.
 *
 * The item metadata that distinguishes the two cases is the OSRS "arms" equipment
 * slot: a top that ships sleeves also occupies slot 6 (`wearPos2 == 6`, e.g. every
 * platebody and robe), while a sleeveless top leaves `wearPos2` unset.
 *
 * Run with:  npx tsx tests/player-appearance-arms.test.ts
 */
import fs from "fs";
import path from "path";

import { EquipmentSlot, itemCoversArms } from "../../client/rs/config/player/Equipment";
import type { ObjType } from "../../client/rs/config/objtype/ObjType";
import type { ServerServices } from "../src/game/ServerServices";
import { BOT_OUTFIT_BLACK_DHIDE_RANGER, BOT_OUTFIT_RUNE_MELEE } from "../src/game/botOutfits";
import { DEFAULT_EQUIP_SLOT_COUNT } from "../src/game/equipment";
import type { PlayerAppearance, PlayerState } from "../src/game/player";
import { PlayerAppearanceManager } from "../src/network/managers/PlayerAppearanceManager";

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

function assertEqual<T>(actual: T, expected: T, msg: string): void {
    assert(actual === expected, `${msg} (got ${String(actual)}, want ${String(expected)})`);
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

const ARMS_KIT = 13;
const TORSO_KIT = 12;
const HANDS_KIT = 14;
const LEGS_KIT = 15;
const FEET_KIT = 16;
const HEAD_KIT = 10;
const JAW_KIT = 11;

/** Sentinel default kits so a kept part is distinguishable from an empty slot. */
const DEFAULT_KITS = [HEAD_KIT, JAW_KIT, TORSO_KIT, ARMS_KIT, HANDS_KIT, LEGS_KIT, FEET_KIT];

/** Minimal ObjType stand-in carrying just the fields the appearance code reads. */
function fakeObj(fields: {
    name?: string;
    wearPos: number;
    wearPos2?: number;
    wearPos3?: number;
}): ObjType {
    return {
        name: fields.name ?? "",
        wearPos: fields.wearPos,
        wearPos2: fields.wearPos2 ?? -1,
        wearPos3: fields.wearPos3 ?? -1,
        params: new Map<number, number>([[1564, fields.wearPos]]),
    } as unknown as ObjType;
}

/**
 * Real wear-position metadata (read out of the OSRS cache) for the ids used in the
 * outfit-level tests below.
 */
const OBJECTS: Record<number, ObjType> = {
    861: fakeObj({ name: "Magic shortbow", wearPos: 3, wearPos2: 5 }), // two-handed
    1079: fakeObj({ name: "Rune platelegs", wearPos: 7 }),
    1127: fakeObj({ name: "Rune platebody", wearPos: 4, wearPos2: 6 }),
    1163: fakeObj({ name: "Rune full helm", wearPos: 0 }),
    1201: fakeObj({ name: "Rune kiteshield", wearPos: 5 }),
    1333: fakeObj({ name: "Rune scimitar", wearPos: 3 }),
    2491: fakeObj({ name: "Black d'hide vambraces", wearPos: 9 }),
    2497: fakeObj({ name: "Black d'hide chaps", wearPos: 7 }),
    2503: fakeObj({ name: "Black d'hide body", wearPos: 4 }),
    4131: fakeObj({ name: "Rune boots", wearPos: 10 }),
};

function createManager(): { manager: PlayerAppearanceManager; player: PlayerState } {
    const appearance: PlayerAppearance = {
        gender: 0,
        kits: [],
        colors: [0, 0, 0, 0, 0],
        equip: new Array<number>(DEFAULT_EQUIP_SLOT_COUNT).fill(-1),
        equipQty: new Array<number>(DEFAULT_EQUIP_SLOT_COUNT).fill(0),
        headIcons: { prayer: -1 },
    };
    const player = { appearance, anim: {} } as unknown as PlayerState;

    const svc = {
        idkTypeLoader: undefined,
        basTypeLoader: undefined,
        defaultPlayerAnim: undefined,
        defaultPlayerAnimMale: undefined,
        defaultPlayerAnimFemale: undefined,
        appearanceService: {
            getDefaultBodyKits: () => DEFAULT_KITS.slice(),
            applyWeaponAnimOverrides: () => undefined,
        },
        equipmentService: {
            ensureEquipArray: (p: PlayerState) => p.appearance?.equip ?? [],
        },
        dataLoaderService: {
            getObjType: (id: number) => OBJECTS[id],
        },
    } as unknown as ServerServices;

    return { manager: new PlayerAppearanceManager(svc), player };
}

/** Run a refresh for the given item per equipment slot and return the result kits. */
function kitsForEquip(equip: Readonly<Partial<Record<EquipmentSlot, number>>>): number[] {
    const { manager, player } = createManager();
    const slots = new Array<number>(DEFAULT_EQUIP_SLOT_COUNT).fill(-1);
    for (const [slot, itemId] of Object.entries(equip)) {
        slots[Number(slot)] = itemId as number;
    }
    player.appearance!.equip = slots;
    manager.refreshAppearanceKits(player);
    return player.appearance!.kits ?? [];
}

// ============================================================================
// 1. itemCoversArms — the shared client/server rule
// ============================================================================

describe("itemCoversArms", () => {
    it("treats a top that also occupies the arms slot as arm-covering", () => {
        assert(
            itemCoversArms(fakeObj({ name: "Rune platebody", wearPos: 4, wearPos2: 6 })),
            "platebody (wearPos2=6) covers the arms",
        );
        assert(
            itemCoversArms(fakeObj({ name: "Monk's robe top", wearPos: 4, wearPos2: 6 })),
            "robe top (wearPos2=6) covers the arms",
        );
        assert(
            itemCoversArms(fakeObj({ name: "Rune platebody", wearPos: 4, wearPos3: 6 })),
            "wearPos3=6 also covers the arms",
        );
    });

    it("treats a sleeveless top as NOT arm-covering", () => {
        assert(
            !itemCoversArms(fakeObj({ name: "Black d'hide body", wearPos: 4 })),
            "black d'hide body (wearPos2=-1) keeps the base arms",
        );
        assert(
            !itemCoversArms(fakeObj({ name: "Iron chainbody", wearPos: 4 })),
            "chainbody (wearPos2=-1) keeps the base arms",
        );
        assert(
            !itemCoversArms(fakeObj({ name: "Leather body", wearPos: 4 })),
            "leather body (wearPos2=-1) keeps the base arms",
        );
    });

    it("does not confuse the shield slot of a two-handed weapon with the arms slot", () => {
        assert(
            !itemCoversArms(fakeObj({ name: "Magic shortbow", wearPos: 3, wearPos2: 5 })),
            "wearPos2=5 (shield) is not the arms slot",
        );
        assert(!itemCoversArms(undefined), "a missing definition covers nothing");
    });
});

// ============================================================================
// 2. Server appearance kits — the bot path
// ============================================================================

describe("refreshAppearanceKits — body slot arms", () => {
    it("keeps the arms kit for the black d'hide ranger bots", () => {
        const kits = kitsForEquip(BOT_OUTFIT_BLACK_DHIDE_RANGER.equip);
        assertEqual(kits[3], ARMS_KIT, "black d'hide body keeps the arms kit");
        assertEqual(kits[2], -1, "black d'hide body still replaces the torso kit");
        assertEqual(kits[4], -1, "vambraces replace the hands kit");
        assertEqual(kits[5], -1, "chaps replace the legs kit");
        assertEqual(kits[0], HEAD_KIT, "no head item: hair kit is kept");
        assertEqual(kits[1], JAW_KIT, "no head item: jaw kit is kept");
        assertEqual(kits[6], FEET_KIT, "no boots: feet kit is kept");
    });

    it("still hides the arms for the rune melee bots (platebody ships sleeves)", () => {
        const kits = kitsForEquip(BOT_OUTFIT_RUNE_MELEE.equip);
        assertEqual(kits[3], -1, "rune platebody replaces the arms kit");
        assertEqual(kits[2], -1, "rune platebody replaces the torso kit");
        assertEqual(kits[0], -1, "rune full helm hides the hair kit");
        assertEqual(kits[1], -1, "rune full helm hides the jaw kit");
        assertEqual(kits[5], -1, "rune platelegs replace the legs kit");
        assertEqual(kits[6], -1, "rune boots replace the feet kit");
    });

    it("restores the arms when a platebody is swapped for a sleeveless top", () => {
        // Guards the in-place mutation: kits cleared for a previous item must not
        // leak into the next refresh.
        const { manager, player } = createManager();
        player.appearance!.equip[EquipmentSlot.BODY] = 1127; // rune platebody
        manager.refreshAppearanceKits(player);
        assertEqual(player.appearance!.kits?.[3], -1, "platebody clears the arms kit");

        player.appearance!.equip[EquipmentSlot.BODY] = 2503; // black d'hide body
        manager.refreshAppearanceKits(player);
        assertEqual(
            player.appearance!.kits?.[3],
            ARMS_KIT,
            "switching to a sleeveless top restores the arms kit",
        );
    });
});

// ============================================================================
// 3. Real cache data (skipped when the OSRS cache is not downloaded)
// ============================================================================

function findCacheRoot(): string | undefined {
    const targetPath = path.resolve("target.txt");
    if (!fs.existsSync(targetPath)) return undefined;
    const target = fs.readFileSync(targetPath, "utf8").trim();
    const cacheRoot = path.resolve("caches", target);
    return fs.existsSync(cacheRoot) ? cacheRoot : undefined;
}

describe("integration — real OSRS cache (skipped if cache is missing)", () => {
    const cacheRoot = findCacheRoot();
    if (!cacheRoot) {
        it("skipped (no OSRS cache present — run `npm run ensure-cache`)", () => {
            assert(true, "skipped");
        });
        return;
    }

    // Import lazily so a missing cache never breaks the unit-test runs.
    let env: ReturnType<typeof import("../src/world/CacheEnv").initCacheEnv> | undefined;
    let envErr: unknown;
    try {
        const CacheEnvMod = require("../src/world/CacheEnv");
        env = CacheEnvMod.initCacheEnv("caches", path.basename(cacheRoot));
    } catch (e) {
        envErr = e;
    }
    if (!env) {
        it(`skipped (CacheEnv failed to init: ${(envErr as Error)?.message ?? envErr})`, () => {
            assert(true, "skipped");
        });
        return;
    }

    const factory = require("../../client/rs/cache/loader/CacheLoaderFactory").getCacheLoaderFactory(
        env.info,
        env.cacheSystem,
    );
    const objTypeLoader = factory.getObjTypeLoader();

    it("matches the real wear positions: d'hide bodies are sleeveless, platebodies are not", () => {
        const sleeveless = new Map<number, string>([
            [1005, "White apron"],
            [1101, "Iron chainbody"],
            [1129, "Leather body"],
            [1131, "Hardleather body"],
            [1133, "Studded body"],
            [2499, "Blue d'hide body"],
            [2501, "Red d'hide body"],
            [2503, "Black d'hide body"],
        ]);
        for (const [id, name] of sleeveless) {
            const obj = objTypeLoader.load(id);
            assert(!!obj, `${name} (${id}) resolves in the cache`);
            assert(!itemCoversArms(obj), `${name} (${id}) must keep the base arms`);
        }

        const sleeved = new Map<number, string>([
            [426, "Priest gown"],
            [544, "Monk's robe top"],
            [577, "Blue wizard robe"],
            [1115, "Iron platebody"],
            [1127, "Rune platebody"],
            [3140, "Dragon chainbody"],
        ]);
        for (const [id, name] of sleeved) {
            const obj = objTypeLoader.load(id);
            assert(!!obj, `${name} (${id}) resolves in the cache`);
            assert(itemCoversArms(obj), `${name} (${id}) supplies its own sleeves`);
        }
    });

    it("confirms the geometry behind the rule: the d'hide body has no arm vertices", () => {
        const modelLoader = factory.getModelLoader();
        const maxAbsX = (id: number): number => {
            const obj = objTypeLoader.load(id) as { maleModel: number } | undefined;
            const model = obj ? modelLoader.getModel(obj.maleModel) : undefined;
            if (!model) return -1;
            let max = 0;
            for (let i = 0; i < model.verticesCount; i++) {
                max = Math.max(max, Math.abs(model.verticesX[i]));
            }
            return max;
        };
        // Identity-kit arms reach out to |x| ~= 33-39 and platebody sleeves to
        // |x| ~= 32, while a torso trunk only spans |x| ~= 18.
        assert(maxAbsX(2503) > 0 && maxAbsX(2503) < 24, "black d'hide body is torso-only");
        assert(maxAbsX(1127) >= 24, "rune platebody spans out to the arms");
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
console.log("player appearance arms tests OK");
