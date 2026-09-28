import type {
    LeagueMasteryChallengeRow,
    LeagueMasteryNodeRow,
    LeagueRelicRow,
    LeagueTaskRow,
} from "./GamemodeDataTypes";

export type WorldLocChangeRow = {
    oldId: number;
    newId: number;
    x: number;
    y: number;
    level: number;
    newRotation?: number;
    moveToX?: number;
    moveToY?: number;
    matchType?: number;
    matchRotation?: number;
};

export type WorldLocSpawnRow = {
    locId: number;
    x: number;
    y: number;
    level: number;
    shape: number;
    rotation: number;
};

export type WorldTerrainOverrideRow = {
    x: number;
    y: number;
    level: number;
    underlay?: number;
    overlay?: number;
    shape?: number;
    rotation?: number;
    renderFlags?: number;
};

let tasksByStructId: Map<number, LeagueTaskRow> | null = null;
let tasksByTaskId: Map<number, LeagueTaskRow> | null = null;
let relicsByStructId: Map<number, LeagueRelicRow> | null = null;
let masteryNodesByStructId: Map<number, LeagueMasteryNodeRow> | null = null;
let masteryChallengesByStructId: Map<number, LeagueMasteryChallengeRow> | null = null;

let customTasksByStructId: Map<number, any> | null = null;
let customTasksByTaskId: Map<number, any> | null = null;
let customChallengesByStructId: Map<number, any> | null = null;
let customEnumOverrides: Map<number, any[]> | null = null;
let replacedCacheStructIds: Set<number> = new Set();

let dynamicWidgetGroups: Map<number, { root: any; widgets: Map<number, any> }> | null = null;
let worldLocChanges: WorldLocChangeRow[] = [];
let worldLocSpawns: WorldLocSpawnRow[] = [];
let worldTerrainOverrides: WorldTerrainOverrideRow[] = [];

let ready = false;

export function isReady(): boolean {
    return ready;
}

export function loadFromPayload(payload: {
    gamemodeId: string;
    datasets: Array<{ key: string; rows: unknown[] }>;
}): void {
    worldLocChanges = [];
    worldLocSpawns = [];
    worldTerrainOverrides = [];
    for (const dataset of payload.datasets) {
        switch (dataset.key) {
            case "leagueTasks":
                tasksByStructId = new Map();
                tasksByTaskId = new Map();
                for (const row of dataset.rows as LeagueTaskRow[]) {
                    const taskId = row.taskId | 0;
                    if (taskId >= 0) tasksByTaskId.set(taskId, row);
                    const structId = typeof row.structId === "number" ? row.structId | 0 : -1;
                    if (structId >= 0) tasksByStructId.set(structId, row);
                }
                break;
            case "leagueRelics":
                relicsByStructId = new Map();
                for (const row of dataset.rows as LeagueRelicRow[]) {
                    relicsByStructId.set(row.structId | 0, row);
                }
                break;
            case "leagueMasteryNodes":
                masteryNodesByStructId = new Map();
                for (const row of dataset.rows as LeagueMasteryNodeRow[]) {
                    masteryNodesByStructId.set(row.structId | 0, row);
                }
                break;
            case "leagueMasteryChallenges":
                masteryChallengesByStructId = new Map();
                for (const row of dataset.rows as LeagueMasteryChallengeRow[]) {
                    masteryChallengesByStructId.set(row.structId | 0, row);
                }
                break;
            case "customTasks":
                customTasksByStructId = new Map();
                customTasksByTaskId = new Map();
                customEnumOverrides = new Map();
                for (const row of dataset.rows as any[]) {
                    if (row.structId != null) customTasksByStructId.set(row.structId | 0, row);
                    if (row.taskId != null) customTasksByTaskId.set(row.taskId | 0, row);
                    if (row.enumGroupId != null) {
                        const group = customEnumOverrides.get(row.enumGroupId) ?? [];
                        group.push(row);
                        customEnumOverrides.set(row.enumGroupId, group);
                    }
                }
                break;
            case "customChallenges":
                customChallengesByStructId = new Map();
                replacedCacheStructIds = new Set();
                if (!customEnumOverrides) customEnumOverrides = new Map();
                for (const row of dataset.rows as any[]) {
                    if (row.structId != null) customChallengesByStructId.set(row.structId | 0, row);
                    if (row.replacesStructId != null)
                        replacedCacheStructIds.add(row.replacesStructId | 0);
                }
                // Register challenges into enum 5695 overrides (prepended)
                if (customChallengesByStructId.size > 0) {
                    const challengeEntries = Array.from(customChallengesByStructId.values());
                    const existing = customEnumOverrides.get(5695) ?? [];
                    customEnumOverrides.set(5695, [...challengeEntries, ...existing]);
                }
                break;
            case "customWidgets":
                try {
                    dynamicWidgetGroups = new Map();
                    for (const group of dataset.rows as any[]) {
                        if (!group?.groupId || !Array.isArray(group.widgets)) continue;
                        const widgets = new Map<number, any>();
                        let root: any = undefined;
                        for (const w of group.widgets) {
                            if (w.uid != null) widgets.set(w.uid, w);
                            if (w.parentUid === -1 || w.parentUid === undefined) root = w;
                        }
                        dynamicWidgetGroups.set(group.groupId | 0, { root, widgets });
                    }
                    console.log(
                        `[GamemodeContentStore] registered ${dynamicWidgetGroups.size} custom widget group(s)`,
                    );
                } catch (err) {
                    console.log("[GamemodeContentStore] failed to load custom widgets", err);
                }
                break;
            case "customItems":
                try {
                    const { CustomItemRegistry } = require("../../custom/items/CustomItemRegistry");
                    const { CustomItemBuilder } = require("../../custom/items/CustomItemBuilder");
                    CustomItemRegistry.clear();
                    for (const def of dataset.rows as any[]) {
                        if (!def || !def.id) continue;
                        if (def.baseItemId != null) {
                            const builder = CustomItemBuilder.create(def.id).basedOn(
                                def.baseItemId,
                            );
                            if (def.objType?.name) builder.name(def.objType.name);
                            if (def.objType?.recolorFrom && def.objType?.recolorTo) {
                                builder.recolor(def.objType.recolorFrom, def.objType.recolorTo);
                            }
                            if (def.objType?.inventoryActions) {
                                builder.inventoryActions(...def.objType.inventoryActions);
                            }
                            CustomItemRegistry.register(builder.build(), def.objType?.name);
                        } else {
                            CustomItemRegistry.register(def, def.objType?.name);
                        }
                    }
                    console.log(
                        `[GamemodeContentStore] registered ${dataset.rows.length} custom item(s)`,
                    );
                } catch (err) {
                    console.log("[GamemodeContentStore] failed to register custom items", err);
                }
                break;
            case "worldLocChanges":
                worldLocChanges = (dataset.rows as WorldLocChangeRow[]).filter(
                    (row) =>
                        typeof row?.oldId === "number" &&
                        typeof row?.newId === "number" &&
                        typeof row?.x === "number" &&
                        typeof row?.y === "number" &&
                        typeof row?.level === "number",
                );
                break;
            case "worldLocSpawns":
                worldLocSpawns = (dataset.rows as WorldLocSpawnRow[]).filter(
                    (row) =>
                        typeof row?.locId === "number" &&
                        typeof row?.x === "number" &&
                        typeof row?.y === "number" &&
                        typeof row?.level === "number" &&
                        typeof row?.shape === "number" &&
                        typeof row?.rotation === "number",
                );
                break;
            case "worldTerrainOverrides":
                worldTerrainOverrides = (dataset.rows as WorldTerrainOverrideRow[]).filter(
                    (row) =>
                        typeof row?.x === "number" &&
                        typeof row?.y === "number" &&
                        typeof row?.level === "number",
                );
                break;
        }
    }
    ready = true;
    console.log(
        `[GamemodeContentStore] loaded: ${tasksByTaskId?.size ?? 0} tasks, ${
            relicsByStructId?.size ?? 0
        } relics, ${masteryNodesByStructId?.size ?? 0} mastery nodes, ${
            customTasksByStructId?.size ?? 0
        } custom tasks`,
    );
}

export function getLeagueTaskStructParam(
    structId: number,
    paramId: number,
): number | string | undefined {
    const row = tasksByStructId?.get(structId | 0);
    if (!row) return undefined;
    const pid = paramId | 0;
    switch (pid) {
        case 873:
            return row.taskId | 0;
        case 874:
            return row.name ?? "";
        case 875:
            return row.description ?? "";
        case 1016:
            return typeof row.category === "number" ? row.category | 0 : 0;
        case 1017:
            return typeof row.area === "number" ? row.area | 0 : 0;
        case 1018:
            return typeof row.skill === "number" ? row.skill | 0 : 0;
        case 2044:
        case 1849:
        case 1850:
        case 1851:
        case 1852:
            return row.tier | 0;
        default:
            return undefined;
    }
}

export function getRelicOrMasteryStructParam(
    structId: number,
    paramId: number,
): number | string | undefined {
    const relic = relicsByStructId?.get(structId | 0);
    if (relic) {
        const pid = paramId | 0;
        switch (pid) {
            case 879:
                return relic.name ?? "";
            case 880:
                return relic.description ?? "";
            case 1855:
                return relic.hasItem ? 1 : 0;
            default:
                return undefined;
        }
    }
    const node = masteryNodesByStructId?.get(structId | 0);
    if (node) {
        const pid = paramId | 0;
        switch (pid) {
            case 2026:
                return node.name ?? "";
            case 2027:
                return node.category ?? 0;
            case 2028:
                return node.description ?? "";
            default:
                return undefined;
        }
    }
    const challenge = masteryChallengesByStructId?.get(structId | 0);
    if (challenge) {
        const pid = paramId | 0;
        switch (pid) {
            case 2028:
                return challenge.description ?? "";
            default:
                return undefined;
        }
    }
    return undefined;
}

export function getCustomStructParam(
    structId: number,
    paramId: number,
): number | string | undefined {
    const task = customTasksByStructId?.get(structId | 0);
    if (task?.params) {
        const val = task.params[paramId];
        if (val !== undefined) return val;
    }
    const challenge = customChallengesByStructId?.get(structId | 0);
    if (challenge?.params) {
        const val = challenge.params[paramId];
        if (val !== undefined) return val;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Enum overrides for custom league content (tasks + mastery challenges)
// ---------------------------------------------------------------------------
//
// The cache interfaces render league content by walking an enum:
//   - the task list draws enum 5728 (keys 0..1588),
//   - the combat mastery list draws enum 5695 (keys 1..10, 1-based!).
// Custom content is PREPENDED to those enums, so every cache key shifts down by
// the number of custom entries and cache entries a custom challenge replaces
// (`replacesStructId`) drop out of the list. The key base therefore has to come
// from the enum itself (its first key) instead of being assumed to be 0,
// otherwise the first custom entry lands on a key the interface never visits
// and silently disappears from the list.

export type EnumKeyResolution =
    /** No custom content for this enum: resolve the key against the cache. */
    | { kind: "cache" }
    /** The key maps onto this struct id. */
    | { kind: "structId"; structId: number }
    /** Custom content exists, but the key is past the end of the list. */
    | { kind: "default" };

/** Custom entries registered for an enum, in the order they are prepended. */
export function getCustomEnumEntries(enumId: number): readonly any[] {
    return customEnumOverrides?.get(enumId) ?? [];
}

/**
 * Number of entries an enum has once custom content is applied.
 *
 * Custom entries are added to the list; cache entries replaced by a custom
 * challenge are removed from it (the challenge takes their place).
 *
 * @param baseCount   cache entry count of the enum
 * @param cacheValues cache values of the enum (used to count replaced entries)
 */
export function getCustomEnumOutputCount(
    enumId: number,
    baseCount: number,
    cacheValues?: readonly number[],
): number {
    const entries = getCustomEnumEntries(enumId);
    if (entries.length === 0) return baseCount;

    let removed = 0;
    if (cacheValues && replacedCacheStructIds.size > 0) {
        for (const value of cacheValues) {
            if (replacedCacheStructIds.has(value | 0)) removed++;
        }
    }
    return baseCount - removed + entries.length;
}

/**
 * Resolve an enum key for an enum custom content was prepended to.
 *
 * @param enumKeys   cache keys of the enum, used for the key base (first key)
 * @param enumValues cache values of the enum, used to skip replaced entries
 */
export function resolveEnumKeyOverride(
    enumId: number,
    key: number,
    enumKeys?: readonly number[],
    enumValues?: readonly number[],
): EnumKeyResolution {
    const entries = getCustomEnumEntries(enumId);
    if (entries.length === 0) return { kind: "cache" };

    const keyBase = enumKeys && enumKeys.length > 0 ? enumKeys[0] | 0 : 0;
    const position = (key | 0) - keyBase;
    if (position < 0) return { kind: "cache" };
    if (position < entries.length) {
        return { kind: "structId", structId: entries[position].structId | 0 };
    }

    // Past the custom entries: take the Nth cache entry that no custom entry
    // replaced. The index counts entries that are still listed (replaced ones
    // are gone), not raw cache keys.
    const cacheIndex = position - entries.length;
    if (!enumKeys || !enumValues) return { kind: "default" };

    let seen = 0;
    for (let i = 0; i < enumKeys.length && i < enumValues.length; i++) {
        const value = enumValues[i] | 0;
        if (replacedCacheStructIds.has(value)) continue;
        if (seen === cacheIndex) return { kind: "structId", structId: value };
        seen++;
    }
    return { kind: "default" };
}

export function getReplacedChallengeStructIds(): ReadonlySet<number> {
    return replacedCacheStructIds;
}

export function getDynamicWidgetGroup(
    groupId: number,
): { root: any; widgets: Map<number, any> } | undefined {
    return dynamicWidgetGroups?.get(groupId | 0);
}

export function getWorldLocChanges(): readonly WorldLocChangeRow[] {
    return worldLocChanges;
}

export function getWorldLocSpawns(): readonly WorldLocSpawnRow[] {
    return worldLocSpawns;
}

export function getWorldTerrainOverrides(): readonly WorldTerrainOverrideRow[] {
    return worldTerrainOverrides;
}
