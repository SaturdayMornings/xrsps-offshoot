/**
 * Combat mastery challenges: everything the mastery interface needs to list them.
 *
 * Widget group 311 is a cache interface, so its "Unlock combat mastery points by
 * completing any of the following tasks" list is drawn on the client by cache
 * scripts (7662 -> 7684 -> 7686). Those walk enum 5695 with
 * `for (key = 1; key <= enum_getoutputcount(5695); key++)`, read each row's text
 * from struct param 2028 and check completion through the 10 mastery point
 * unlock varbits (script 7656: position P <-> varbit 11585 + P - 1).
 *
 * A mastery challenge that only exists in our data therefore needs three things
 * to line up, and all three were broken (the challenge was in the data, the
 * interface never showed it):
 *  1. the client's enum override has to use the enum's own key base - 5695 is
 *     keyed 1..10 while the league task enum (5728) is keyed from 0, so the old
 *     zero-based prepend dropped "Defeat a Man." and shifted every other row,
 *  2. the payload has to ship struct param 2028 - the 90100+ structs have no
 *     cache struct, so the replaced rows rendered blank,
 *  3. each custom challenge has to stay inside positions 1-10 or the client can
 *     never highlight it as complete.
 *
 * Run with: npx tsx tests/league-mastery-challenges.test.ts
 */
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";

import {
    MASTERY_POINT_UNLOCK_VARBIT_COUNT,
    VARBIT_MASTERY_POINT_UNLOCK_BASE,
} from "../../client/common/gamemode/GamemodeDataTypes";
import {
    getCustomEnumOutputCount,
    loadFromPayload,
    resolveEnumKeyOverride,
} from "../../client/common/gamemode/GamemodeContentStore";
import { LeagueContentProvider } from "../gamemodes/leagues-v/LeagueContentProvider";
import {
    CUSTOM_STRUCT_RANGES,
    ENUM_IDS,
    getAllCustomChallenges,
} from "../gamemodes/leagues-v/data/custom";
import { LEAGUE_MASTERY_CHALLENGES } from "../gamemodes/leagues-v/data/leagueMasteries.data";

// ---------------------------------------------------------------------------
// Enum 5695 as the cache ships it (leagueMasteries.data.ts was exported from it)
// ---------------------------------------------------------------------------

// 10 entries, keys 1..10 -> structs 1177..1186. The keys start at 1, unlike the
// league task enum (5728) whose keys start at 0, and that difference is exactly
// what the client's override has to derive from the enum instead of assuming 0.
const CACHE_CHALLENGE_KEYS = LEAGUE_MASTERY_CHALLENGES.map((_, index) => index + 1);
const CACHE_CHALLENGE_VALUES = LEAGUE_MASTERY_CHALLENGES.map((row) => row.structId);

assert.equal(
    CACHE_CHALLENGE_KEYS[0],
    1,
    "enum 5695 is 1-based: the interface walks keys 1..enum_getoutputcount(5695)",
);

const CHALLENGE_DESCRIPTION_PARAM = 2028;

// ---------------------------------------------------------------------------
// Registry: ids, struct params and replacements
// ---------------------------------------------------------------------------

const challenges = getAllCustomChallenges();
assert.ok(challenges.length > 0, "there must be custom mastery challenges");

// The challenge that has no cache counterpart has to stay registered: it is the
// one that only exists because of this data ("Kill a Man" of the mastery list).
const defeatAMan = challenges.find((challenge) => challenge.description === "Defeat a Man.");
assert.ok(
    defeatAMan,
    `"Defeat a Man." must stay registered as a custom challenge - it has no cache struct to fall back on`,
);
assert.equal(
    defeatAMan.replacesStructId,
    undefined,
    `"Defeat a Man." is a new challenge, not a replacement`,
);
assert.equal(
    defeatAMan.structId,
    CUSTOM_STRUCT_RANGES.CHALLENGES.start,
    "custom challenge structs come from the dedicated 90100+ range",
);
assert.equal(defeatAMan.customIndex, 0, "the first custom challenge is prepended first");

for (const challenge of challenges) {
    // The interface renders struct_param(structId, 2028); cache challenge structs
    // (1177-1186) only define that one param, so custom ones ship it too.
    assert.equal(
        challenge.params?.[CHALLENGE_DESCRIPTION_PARAM],
        challenge.description,
        `"${challenge.description}" must ship param 2028 or its row renders blank`,
    );

    if (challenge.replacesStructId !== undefined) {
        assert.ok(
            CACHE_CHALLENGE_VALUES.includes(challenge.replacesStructId),
            `"${challenge.description}" replaces struct ${challenge.replacesStructId}, which is not one of the cache challenges (${CACHE_CHALLENGE_VALUES.join(", ")})`,
        );
    }
}

// ---------------------------------------------------------------------------
// Payload: the client only renders what survives the gamemode content packet
// ---------------------------------------------------------------------------

const provider = new LeagueContentProvider();
provider.build();
const packet = (provider as unknown as { cachedPacket: Uint8Array | null }).cachedPacket;
assert.ok(packet, "LeagueContentProvider must build a content packet");
const dataLen = (packet[1] << 8) | packet[2];
const payload = JSON.parse(
    inflateSync(Buffer.from(packet.subarray(8, 3 + dataLen))).toString("utf8"),
) as { gamemodeId: string; datasets: Array<{ key: string; rows: Array<Record<string, any>> }> };

const challengeRows =
    payload.datasets.find((dataset) => dataset.key === "customChallenges")?.rows ?? [];
assert.equal(
    challengeRows.length,
    challenges.length,
    "every registered challenge has to reach the client",
);
for (const row of challengeRows) {
    assert.equal(
        row.params?.[CHALLENGE_DESCRIPTION_PARAM],
        row.description,
        `payload row for "${row.description}" must carry param 2028`,
    );
}

loadFromPayload(payload);

// ---------------------------------------------------------------------------
// Render enum 5695 exactly like the cache script does
// ---------------------------------------------------------------------------

const outputCount = getCustomEnumOutputCount(
    ENUM_IDS.MASTERY_CHALLENGES,
    CACHE_CHALLENGE_KEYS.length,
    CACHE_CHALLENGE_VALUES,
);

const replaced = new Set(
    challenges
        .map((challenge) => challenge.replacesStructId)
        .filter((structId): structId is number => structId !== undefined),
);

assert.equal(
    outputCount,
    CACHE_CHALLENGE_VALUES.length - replaced.size + challenges.length,
    "custom challenges are added to the list, replaced cache challenges leave it",
);

const rendered: Array<{ key: number; structId: number }> = [];
for (let key = CACHE_CHALLENGE_KEYS[0]; key <= outputCount; key++) {
    const resolution = resolveEnumKeyOverride(
        ENUM_IDS.MASTERY_CHALLENGES,
        key,
        CACHE_CHALLENGE_KEYS,
        CACHE_CHALLENGE_VALUES,
    );
    assert.equal(
        resolution.kind,
        "structId",
        `key ${key} of ${outputCount} must resolve to a challenge (a "default" here is a blank or duplicated row in the interface)`,
    );
    if (resolution.kind === "structId") {
        rendered.push({ key, structId: resolution.structId });
    }
}

// Custom challenges are prepended in customIndex order, then the cache
// challenges that no custom challenge replaced, in cache order.
const expectedStructIds = [
    ...challenges.map((challenge) => challenge.structId),
    ...CACHE_CHALLENGE_VALUES.filter((structId) => !replaced.has(structId)),
];

assert.deepEqual(
    rendered.map((row) => row.structId),
    expectedStructIds,
    "the interface must list every data-defined challenge exactly once, in order",
);


// ... and every one of them has to have text (the blank-row regression).
const cacheDescriptionByStructId = new Map(
    LEAGUE_MASTERY_CHALLENGES.map((row) => [row.structId, row.description]),
);

// What a player sees in the mastery interface, top to bottom. "Defeat a Giant."
// and "Defeat 10 monsters..." keep their cache wording but come from the custom
// structs that replaced cache structs 1177/1178 (they carry the kill triggers).
const EXPECTED_ROWS: string[] = [
    "Defeat a Man.",
    "Defeat a Giant.",
    "Defeat 10 monsters with a combat level of 100 or more.",
    "Defeat Scurrius by yourself.",
    "Defeat a monster with a Slayer requirement of 55 or more.",
    "Defeat TzTok-Jad in the Fight Caves.",
    "Reach a combat level of 100.",
    "Defeat an Echo Boss.",
    "Defeat two unique Echo Bosses.",
    "Defeat three unique Echo Bosses.",
    "Defeat TzKal-Zuk.",
];

const expectedTexts = expectedStructIds.map((structId) => {
    const custom = challenges.find((challenge) => challenge.structId === structId);
    return (
        custom?.params?.[CHALLENGE_DESCRIPTION_PARAM] ?? cacheDescriptionByStructId.get(structId)
    );
});

assert.deepEqual(
    expectedTexts,
    EXPECTED_ROWS,
    "the mastery interface must show exactly these rows: the new challenge leads the list and the two replaced cache rows are substituted by the custom entries. Extend this list when you add a mastery challenge.",
);
assert.ok(
    expectedTexts.every((text) => typeof text === "string" && text.length > 0),
    `every rendered row needs text, got ${JSON.stringify(expectedTexts)}`,
);

// A custom challenge is tracked by varbit 11585 + customIndex because it sits at
// position customIndex + 1 (the interface is 1-based) and the completion script
// reads position P from varbit 11585 + P - 1.
for (const challenge of challenges) {
    const row = rendered.find((entry) => entry.structId === challenge.structId);
    assert.ok(row, `"${challenge.description}" must be rendered`);
    const position = row!.key - CACHE_CHALLENGE_KEYS[0] + 1;
    assert.equal(
        position,
        challenge.customIndex + 1,
        `"${challenge.description}" renders at position ${position}, but the varbit the server sets is derived from customIndex (${challenge.customIndex})`,
    );
    assert.equal(
        VARBIT_MASTERY_POINT_UNLOCK_BASE + challenge.customIndex,
        VARBIT_MASTERY_POINT_UNLOCK_BASE + position - 1,
        "server varbit and client position must agree",
    );
    assert.ok(
        position <= MASTERY_POINT_UNLOCK_VARBIT_COUNT,
        `"${challenge.description}" sits at position ${position}, past the ${MASTERY_POINT_UNLOCK_VARBIT_COUNT} unlock varbits the client checks: it would be listed but never complete`,
    );
}

// A player who has done nothing still sees every row, with the replaced cache
// rows (1177 "Defeat a Giant." / 1178 "Defeat 10 monsters...") substituted by the
// custom entries rather than duplicated.
assert.equal(
    rendered.length,
    challenges.length + CACHE_CHALLENGE_VALUES.length - replaced.size,
    "the list is the cache challenges minus the replaced ones plus the custom ones",
);

// ---------------------------------------------------------------------------
// The other half of the key-base fix: the task enum is still 0-based
// ---------------------------------------------------------------------------

// Custom tasks are prepended to enum 5728, whose keys start at 0, so the first
// custom task still has to land on key 0 and cache tasks stay reachable by
// shifting the key past the custom entries.
const taskRows = (payload.datasets.find((dataset) => dataset.key === "customTasks")?.rows ??
    []) as Array<{ structId: number }>;
assert.ok(taskRows.length > 0, "the payload must ship the custom tasks");

assert.deepEqual(
    resolveEnumKeyOverride(ENUM_IDS.L5_TASKS, 0, [0, 1, 2, 3], [9001, 9002, 9003, 9004]),
    { kind: "structId", structId: taskRows[0].structId },
    "the 0-based task enum still prepends its custom tasks at key 0",
);

assert.deepEqual(
    resolveEnumKeyOverride(
        ENUM_IDS.L5_TASKS,
        taskRows.length,
        [0, 1, 2, 3],
        [9001, 9002, 9003, 9004],
    ),
    { kind: "structId", structId: 9001 },
    "cache tasks are still reachable by shifting the key past the custom ones",
);

assert.equal(
    getCustomEnumOutputCount(ENUM_IDS.L5_TASKS, 10, [9001, 9002, 9003, 9004]) - 10,
    taskRows.length,
    "custom tasks add to the task list instead of replacing cache tasks",
);

console.log(
    `league mastery challenge check passed (${challenges.length} custom challenge(s), ${rendered.length} rows)`,
);

