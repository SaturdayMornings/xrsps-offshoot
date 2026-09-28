/**
 * Player model composition — arms visibility.
 *
 * `PlayerModelLoader` drops the base identity-kit body parts that a worn item
 * replaces. Torso + arms used to be dropped together for any body item, but a
 * sleeveless top (black d'hide body, chainbody, leather body) has no arm geometry
 * of its own, so those models came out armless. Only tops that also occupy the OSRS
 * "arms" slot carry sleeves.
 *
 * The test drives the real composition path with stub cache loaders and records
 * which model ids the loader asks for: an arms-kit model request means the arms
 * were composed, no request means they were suppressed.
 *
 * Run with:  npx tsx tests/player-model-arms.test.ts
 */
import { EquipmentSlot } from "../rs/config/player/Equipment";
import { PlayerAppearance } from "../rs/config/player/PlayerAppearance";
import { PlayerModelLoader } from "../rs/config/player/PlayerModelLoader";
import type { ObjType } from "../rs/config/objtype/ObjType";

// ============================================================================
// Minimal test harness (mirrors server/tests/bot-outfits.test.ts)
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
// Stub cache loaders
// ============================================================================

/** Identity kits are stubbed as "kit id == body part index". */
const KIT_MODEL_BASE = 9000;
const ARMS_KIT = 3;
const TORSO_KIT = 2;

const IDK_LOADER = {
    getCount: () => 7,
    load: (id: number) => ({
        bodyPartId: id,
        modelIds: [KIT_MODEL_BASE + id],
        nonSelectable: false,
    }),
};

/** Records every model id asked for and returns nothing (no merge work needed). */
let requested: number[] = [];
const MODEL_LOADER = {
    missCount: 0,
    getModel: (id: number) => {
        requested.push(id);
        return undefined;
    },
};

/**
 * Item metadata modelled on the real cache: the sleeveless d'hide body is a single
 * torso-trunk model, the platebody adds a sleeves model (maleModel1) and claims the
 * arms slot via wearPos2 = 6.
 */
const OBJ_TYPES: Record<number, ObjType> = {
    2503: {
        name: "Black d'hide body",
        wearPos: 4,
        wearPos2: -1,
        wearPos3: -1,
        maleModel: 314,
        femaleModel: 477,
        maleModel1: -1,
        maleModel2: -1,
        femaleModel1: -1,
        femaleModel2: -1,
        resizeX: 128,
        resizeY: 128,
        resizeZ: 128,
    } as unknown as ObjType,
    1127: {
        name: "Rune platebody",
        wearPos: 4,
        wearPos2: 6,
        wearPos3: -1,
        maleModel: 306,
        femaleModel: 468,
        maleModel1: 164,
        maleModel2: -1,
        femaleModel1: 344,
        femaleModel2: -1,
        resizeX: 128,
        resizeY: 128,
        resizeZ: 128,
    } as unknown as ObjType,
};

const OBJ_LOADER = { load: (id: number) => OBJ_TYPES[id] };

/** 14-slot equip array with `itemId` (or nothing) in the body slot. */
function equipWithBody(itemId?: number): number[] {
    const equip = new Array<number>(14).fill(-1);
    equip[EquipmentSlot.BODY] = itemId ?? -1;
    return equip;
}

function buildModel(equip: Array<number | null | undefined>, kits: number[]): void {
    requested = [];
    const equipArray = new Array<number>(14).fill(-1);
    for (let slot = 0; slot < equip.length; slot++) {
        equipArray[slot] = equip[slot] ?? -1;
    }
    const appearance = new PlayerAppearance(0, [0, 0, 0, 0, 0], kits, equipArray, { prayer: -1 });
    const loader = new PlayerModelLoader(
        IDK_LOADER as never,
        OBJ_LOADER as never,
        MODEL_LOADER as never,
        undefined as never,
    );
    loader.buildStaticModelFromEquipment(appearance, equipArray);
}

const composedArmsKit = (): boolean => requested.includes(KIT_MODEL_BASE + ARMS_KIT);
const composedTorsoKit = (): boolean => requested.includes(KIT_MODEL_BASE + TORSO_KIT);

// ============================================================================
// Tests
// ============================================================================

const NO_KITS = new Array<number>(7).fill(-1);
const ALL_KITS = [0, 1, 2, 3, 4, 5, 6];

describe("PlayerModelLoader — body slot arms", () => {
    it("composes the arms and torso kits for a bare chest", () => {
        buildModel(equipWithBody(), NO_KITS);
        assert(composedArmsKit(), "bare chest: the arms kit is composed");
        assert(composedTorsoKit(), "bare chest: the torso kit is composed");
    });

    it("composes the base arms when the server sent no arms kit (bot data)", () => {
        buildModel(equipWithBody(2503), NO_KITS);
        assert(requested.includes(314), "the d'hide body model is composed");
        assert(composedArmsKit(), "arms kit composed for the sleeveless body");
        assert(!composedTorsoKit(), "torso kit still replaced by the body item");
    });

    it("composes the base arms when the server already cleared them", () => {
        // Regression: bots/spawn data may arrive with kits[3] = -1 from the old
        // "hide arms for every body item" rule; the client must restore them.
        const kits = [0, 1, 2, -1, 4, 5, 6];
        buildModel(equipWithBody(2503), kits);
        assert(composedArmsKit(), "arms kit is restored for the sleeveless body");
    });

    it("keeps the arms kit when the server already supplied it", () => {
        buildModel(equipWithBody(2503), ALL_KITS);
        assert(composedArmsKit(), "arms kit composed for the sleeveless body");
    });

    it("suppresses the base arms for a platebody (the item ships sleeves)", () => {
        buildModel(equipWithBody(1127), NO_KITS);
        assert(requested.includes(306), "platebody torso model is composed");
        assert(requested.includes(164), "platebody sleeve model is composed");
        assert(!composedArmsKit(), "arms kit suppressed for the platebody");
        assert(!composedTorsoKit(), "torso kit suppressed for the platebody");
    });

    it("suppresses a stale arms kit for a platebody", () => {
        buildModel(equipWithBody(1127), ALL_KITS);
        assert(!composedArmsKit(), "arms kit dropped for the platebody");
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
console.log("player model arms tests OK");
