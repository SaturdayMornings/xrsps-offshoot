/**
 * Ambient bot roaming tests.
 *
 * The roam behaviour is random and tick-driven, so this exercises it end to end
 * instead of mocking the pieces: real precomputed collision cache, real
 * PathService, real MovementProcessor, and the real PlayerManager bot tick hook.
 * Several hundred ticks are simulated on the Grand Exchange spawn tiles and the
 * resulting positions are checked against the roam bounds and the collision map.
 *
 * Skipped automatically when the cache is not present on disk.
 *
 * Run with:  npx tsx tests/bot-roam.test.ts
 */
import { registerSkillConfiguration } from "../src/game/combat/SkillConfigurationProvider";
import type { GamemodeDefinition } from "../src/game/gamemodes/GamemodeDefinition";
import { MovementProcessor } from "../src/game/movement/engine/MovementProcessor";
import { PlayerManager, PlayerState, type BotRoamArea } from "../src/game/player";
import { PathService } from "../src/pathfinding/PathService";
import { serverPath } from "../src/paths";
import { initCacheEnv } from "../src/world/CacheEnv";
import { MapCollisionService } from "../src/world/MapCollisionService";

// Mirrors tests/combat-engagement-lifecycle.test.ts: a stub gamemode plus a
// registered skill config is all a headless PlayerState needs. Roaming itself
// touches neither, but PlayerState will not construct without them.
const TEST_GAMEMODE = {
    id: "bot-roam-test",
    name: "Bot roam test",
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
// Minimal test harness (mirrors tests/collision-encoder.test.ts)
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
// Environment — the same tiles and bounds wsServer.initTestBots() configures
// ============================================================================

const PLANE = 0;
const TICKS = 800;
const GE_SPAWNS: ReadonlyArray<{ x: number; y: number }> = [
    { x: 3168, y: 3475 },
    { x: 3173, y: 3475 },
    { x: 3166, y: 3475 },
    { x: 3177, y: 3475 },
    { x: 3171, y: 3480 },
];
const GE_ROAM_AREA: BotRoamArea = { minX: 3157, minY: 3469, maxX: 3181, maxY: 3494 };
// A sixth bot parked in the same area but never opted into roaming.
const STATIONARY_SPAWN = { x: 3171, y: 3478 };

type SimResult = {
    /** Distinct tiles each bot occupied, keyed by player id. */
    visited: Map<number, Set<string>>;
    /** Ticks on which each bot changed tile. */
    movedTicks: Map<number, number>;
    /** Total bot-ticks observed. */
    botTicks: number;
    /** Bot-ticks spent outside the declared roam rectangle. */
    outsideArea: number;
    /** A few offending positions, for diagnosing a bounds failure. */
    outsideSamples: string[];
    /** Bot-ticks where no adjacent step was possible (embedded in geometry). */
    embedded: number;
    /** Bot-ticks on a plane other than the roam plane. */
    wrongPlane: number;
    /** Distinct tiles the *stationary* bot occupied. */
    stationaryTiles: number;
    /** Player ids of the roaming bots, in spawn order. */
    roamingIds: number[];
};

let simulated: SimResult | undefined;
let setupError: string | undefined;

try {
    const cacheEnv = initCacheEnv("caches");
    const mapService = new MapCollisionService(cacheEnv, false, {
        precomputedRoot: serverPath("cache", "collision"),
        usePrecomputed: true,
    });
    const pathService = new PathService(mapService);
    const players = new PlayerManager(TEST_GAMEMODE, pathService);
    const movement = new MovementProcessor(pathService);

    const roaming: PlayerState[] = [];
    for (const spawn of GE_SPAWNS) {
        const bot = players.addBot(spawn.x, spawn.y, PLANE, "RoamTest");
        if (!bot) throw new Error("addBot returned undefined (id pool exhausted)");
        roaming.push(bot);
    }
    for (const bot of roaming) players.enableBotRoam(bot, GE_ROAM_AREA);

    const parked = players.addBot(STATIONARY_SPAWN.x, STATIONARY_SPAWN.y, PLANE, "StandingStill");
    if (!parked) throw new Error("addBot returned undefined for the stationary bot");

    const result: SimResult = {
        visited: new Map(),
        movedTicks: new Map(),
        botTicks: 0,
        outsideArea: 0,
        outsideSamples: [],
        embedded: 0,
        wrongPlane: 0,
        stationaryTiles: 0,
        roamingIds: roaming.map((bot) => bot.id),
    };

    const isInsideArea = (x: number, y: number): boolean =>
        x >= GE_ROAM_AREA.minX &&
        x <= GE_ROAM_AREA.maxX &&
        y >= GE_ROAM_AREA.minY &&
        y <= GE_ROAM_AREA.maxY;

    // A bot standing in open space can always step somewhere. If this ever
    // fails, a destination resolved to a tile inside solid geometry.
    const hasAdjacentStep = (x: number, y: number): boolean => {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const ok = pathService.canActorStep(
                    { x, y, plane: PLANE },
                    { x: x + dx, y: y + dy },
                    1,
                );
                if (ok) return true;
            }
        }
        return false;
    };

    const parkedTiles = new Set<string>();

    for (let tick = 1; tick <= TICKS; tick++) {
        const before = roaming.map((bot) => ({ x: bot.tileX, y: bot.tileY }));
        players.tickBots(tick, movement);

        roaming.forEach((bot, index) => {
            result.botTicks++;
            if (!isInsideArea(bot.tileX, bot.tileY)) {
                result.outsideArea++;
                if (result.outsideSamples.length < 6) {
                    const from = before[index];
                    result.outsideSamples.push(
                        `tick ${tick} bot ${bot.id}: (${from.x},${from.y}) -> ` +
                            `(${bot.tileX},${bot.tileY})`,
                    );
                }
            }
            if (!hasAdjacentStep(bot.tileX, bot.tileY)) result.embedded++;
            if (bot.level !== PLANE) result.wrongPlane++;

            if (bot.tileX !== before[index].x || bot.tileY !== before[index].y) {
                result.movedTicks.set(bot.id, (result.movedTicks.get(bot.id) ?? 0) + 1);
            }

            let seen = result.visited.get(bot.id);
            if (!seen) {
                seen = new Set<string>();
                result.visited.set(bot.id, seen);
            }
            seen.add(`${bot.tileX},${bot.tileY}`);
        });

        parkedTiles.add(`${parked.tileX},${parked.tileY}`);
    }

    result.stationaryTiles = parkedTiles.size;
    simulated = result;
} catch (err) {
    setupError = (err as Error)?.message ?? String(err);
}

// ============================================================================
// Assertions
// ============================================================================

if (setupError) {
    describe("bot roam (skipped)", () => {
        it(`skipped — environment unavailable: ${setupError}`, () => {
            assert(true, "skipped");
        });
    });
} else {
    const result = simulated!;

    describe(`bot roam — ${TICKS} ticks at the Grand Exchange`, () => {
        it("every roaming bot actually moved", () => {
            for (const id of result.roamingIds) {
                const moved = result.movedTicks.get(id) ?? 0;
                assert(moved > 0, `bot ${id} never changed tile in ${TICKS} ticks`);
            }
        });

        it("bots spread across the area instead of jittering on the spot", () => {
            // Observed range is roughly 94-180 distinct tiles per bot per 800
            // ticks; 40 leaves margin without letting a broken roam pass.
            for (const id of result.roamingIds) {
                const tiles = result.visited.get(id) ?? new Set<string>();
                assert(
                    tiles.size >= 40,
                    `bot ${id} only ever occupied ${tiles.size} tile(s); expected >= 40`,
                );
            }
        });

        it("every bot keeps walking for the whole run, not just at first", () => {
            for (const id of result.roamingIds) {
                const moved = result.movedTicks.get(id) ?? 0;
                assert(moved >= 100, `bot ${id} only moved on ${moved} of ${TICKS} ticks`);
            }
        });

        it("bots never leave the configured roam rectangle", () => {
            assert(
                result.outsideArea === 0,
                `${result.outsideArea} of ${result.botTicks} bot-ticks were outside the area\n` +
                    result.outsideSamples.map((s) => `      ${s}`).join("\n"),
            );
        });

        it("bots never end up embedded in geometry", () => {
            assert(
                result.embedded === 0,
                `${result.embedded} of ${result.botTicks} bot-ticks had no legal adjacent step`,
            );
        });

        it("bots never change plane", () => {
            assert(result.wrongPlane === 0, `${result.wrongPlane} bot-ticks were off plane 0`);
        });

        it("movement is stop-start rather than continuous", () => {
            let moved = 0;
            for (const id of result.roamingIds) moved += result.movedTicks.get(id) ?? 0;
            const ratio = moved / result.botTicks;
            // A hop is a few ticks and the following pause averages ~11, so a
            // healthy ratio sits near 0.28. The bounds catch both a bot that
            // never rests and a bot that rarely moves.
            assert(moved > 0, "no movement ticks recorded");
            assert(
                ratio < 0.45,
                `bots moved on ${(ratio * 100).toFixed(0)}% of ticks; expected loitering (<45%)`,
            );
            assert(
                ratio > 0.15,
                `bots only moved on ${(ratio * 100).toFixed(1)}% of ticks; expected active (>15%)`,
            );
        });

        it("a bot without enableBotRoam() stays where it spawned", () => {
            assert(
                result.stationaryTiles === 1,
                `stationary bot occupied ${result.stationaryTiles} tiles; expected exactly 1`,
            );
        });
    });
}

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
console.log("bot roam tests OK");


