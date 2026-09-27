/**
 * Parses task names to extract trigger criteria.
 * Uses pattern matching to identify trigger type and target.
 */
import { SkillId } from "../../../../client/rs/skill/skills";
import { type TaskTrigger, TriggerType } from "./TriggerTypes";

export type NameToIdsLookup = (name: string) => number[];

export interface TriggerParserLoaders {
    getNpcIdsByName: NameToIdsLookup;
    getItemIdsByName: NameToIdsLookup;
}

/**
 * Skill name -> skill id, built from the shared SkillId enum so task text like
 * "Reach Level 99 Woodcutting" resolves without a second hard-coded list.
 * The few aliases below cover wording used by the cache task descriptions.
 */
const SKILL_NAME_TO_ID: ReadonlyMap<string, number> = (() => {
    const map = new Map<string, number>();
    for (const [name, value] of Object.entries(SkillId)) {
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        map.set(name.toLowerCase(), value);
    }
    map.set("runecrafting", SkillId.Runecraft);
    map.set("hitpoint", SkillId.Hitpoints);
    map.set("defense", SkillId.Defence);
    map.set("range", SkillId.Ranged);
    return map;
})();

const ACHIEVE_FIRST_LEVEL_UP = /^achieve your first level up$/;
const ACHIEVE_FIRST_LEVEL = /^achieve your first level (\d+)$/;
const REACH_TOTAL_LEVEL = /^reach total level (\d+)$/;
const REACH_BASE_LEVEL = /^reach base level (\d+)$/;
const REACH_COMBAT_LEVEL = /^reach combat level (\d+)$/;
const REACH_SKILL_LEVEL = /^reach level (\d+)\s+([a-z]+)$/;
/** e.g. "(not including Agility, Hitpoints and Runecraft)" */
const NOT_INCLUDING = /not including ([^)]+)/;

function parseExcludedSkillIds(descriptionLower: string): number[] | undefined {
    const match = descriptionLower.match(NOT_INCLUDING);
    if (!match) return undefined;

    const ids: number[] = [];
    for (const token of match[1].split(/,| and /)) {
        const skillId = SKILL_NAME_TO_ID.get(token.trim());
        if (skillId !== undefined && !ids.includes(skillId)) {
            ids.push(skillId);
        }
    }
    return ids.length > 0 ? ids : undefined;
}

/**
 * Parse level milestone task names ("Achieve Your First Level 5",
 * "Reach Total Level 500", "Reach Base Level 5", "Reach Combat Level 50",
 * "Reach Level 99 Woodcutting").
 * Returns undefined for names that only look similar (e.g. "Reach Level 5 in
 * Any Barbarian Assault Role", which tracks a minigame role, not a skill).
 */
function parseLevelTrigger(
    nameLower: string,
    descriptionLower: string,
): TaskTrigger | undefined {
    if (ACHIEVE_FIRST_LEVEL_UP.test(nameLower)) {
        return { type: TriggerType.LevelReach, scope: "levelUp", level: 2 };
    }

    const firstLevel = nameLower.match(ACHIEVE_FIRST_LEVEL);
    if (firstLevel) {
        return {
            type: TriggerType.LevelReach,
            scope: "any",
            level: parseInt(firstLevel[1], 10),
            excludeSkillIds: parseExcludedSkillIds(descriptionLower),
        };
    }

    const totalLevel = nameLower.match(REACH_TOTAL_LEVEL);
    if (totalLevel) {
        return {
            type: TriggerType.LevelReach,
            scope: "total",
            level: parseInt(totalLevel[1], 10),
        };
    }

    const baseLevel = nameLower.match(REACH_BASE_LEVEL);
    if (baseLevel) {
        return {
            type: TriggerType.LevelReach,
            scope: "all",
            level: parseInt(baseLevel[1], 10),
        };
    }

    const combatLevel = nameLower.match(REACH_COMBAT_LEVEL);
    if (combatLevel) {
        return {
            type: TriggerType.LevelReach,
            scope: "combat",
            level: parseInt(combatLevel[1], 10),
        };
    }

    const skillLevel = nameLower.match(REACH_SKILL_LEVEL);
    if (skillLevel) {
        const skillId = SKILL_NAME_TO_ID.get(skillLevel[2]);
        if (skillId !== undefined) {
            return {
                type: TriggerType.LevelReach,
                scope: "skill",
                level: parseInt(skillLevel[1], 10),
                skillId,
            };
        }
    }

    return undefined;
}

/**
 * Parse a task name and description to determine its trigger.
 * Returns undefined if the task can't be auto-parsed (needs manual trigger).
 */
export function parseTaskTrigger(
    name: string,
    description: string,
    loaders: TriggerParserLoaders,
): TaskTrigger | undefined {
    const nameLower = name.toLowerCase();
    const descLower = description.toLowerCase();

    // === Level milestone patterns ===
    // Stateful: evaluated against the player's skills on level-up and login.
    const levelTrigger = parseLevelTrigger(nameLower, descLower);
    if (levelTrigger) {
        return levelTrigger;
    }

    // === NPC Kill patterns ===
    // "Defeat a Moss Giant", "Kill 10 Goblins", "Slay a Black Dragon"
    const killPatterns = [
        /^(defeat|kill|slay)\s+(a\s+|an\s+|the\s+)?(\d+\s+)?(.+)$/i,
        /^(\d+)\s+(.+?)\s+(kill|kills)$/i, // "10 Goblin Kills" or "1 Zulrah Kill"
    ];

    for (const pattern of killPatterns) {
        const match = name.match(pattern);
        if (match) {
            let npcName: string;
            let count = 1;

            if (pattern === killPatterns[1]) {
                // "10 Goblin Kills" pattern
                count = parseInt(match[1], 10) || 1;
                npcName = match[2].trim();
            } else {
                // "Defeat a Moss Giant" pattern
                count = match[3] ? parseInt(match[3], 10) || 1 : 1;
                npcName = match[4].trim();
            }

            // Clean up NPC name (remove trailing location info)
            // "Moss Giant in Tirannwn" -> "Moss Giant"
            npcName = npcName.replace(/\s+(in|at|on|near)\s+.+$/i, "").trim();

            const npcIds = loaders.getNpcIdsByName(npcName);
            if (npcIds.length > 0) {
                return {
                    type: TriggerType.NpcKill,
                    npcIds,
                    count: count > 1 ? count : undefined,
                };
            }
        }
    }

    // === Item Equip patterns ===
    // "Equip a Dragon Scimitar", "Wear a Fire Cape"
    const equipMatch = name.match(/^(equip|wear)\s+(a\s+|an\s+|the\s+|any\s+)?(.+)$/i);
    if (equipMatch) {
        let itemName = equipMatch[3].trim();

        // Handle "Piece of X" or "Full X set" - these need special handling
        if (itemName.toLowerCase().includes("piece of") || itemName.toLowerCase().includes("set")) {
            // These are complex, skip auto-parsing
            return undefined;
        }

        const itemIds = loaders.getItemIdsByName(itemName);
        if (itemIds.length > 0) {
            return {
                type: TriggerType.ItemEquip,
                itemIds,
            };
        }
    }

    // === Item Obtain patterns ===
    // "Obtain a Dragon Axe", "Receive a Pet"
    const obtainMatch = name.match(
        /^(obtain|receive|get|loot)\s+(a\s+|an\s+|the\s+)?(\d+\s+)?(.+)$/i,
    );
    if (obtainMatch) {
        const count = obtainMatch[3] ? parseInt(obtainMatch[3], 10) || 1 : 1;
        const itemName = obtainMatch[4].trim();

        const itemIds = loaders.getItemIdsByName(itemName);
        if (itemIds.length > 0) {
            return {
                type: TriggerType.ItemObtain,
                itemIds,
                count: count > 1 ? count : undefined,
            };
        }
    }

    // === Item Craft patterns ===
    // "Craft a Black D'hide Body", "Smith a Rune Platebody", "Cook a Shark"
    const craftMatch = name.match(
        /^(craft|smith|cook|fletch|create|make|brew)\s+(a\s+|an\s+|the\s+)?(\d+\s+)?(.+)$/i,
    );
    if (craftMatch) {
        const count = craftMatch[3] ? parseInt(craftMatch[3], 10) || 1 : 1;
        let itemName = craftMatch[4].trim();

        // Remove "(u)" suffix for unstrung items
        itemName = itemName.replace(/\s*\(u\)\s*$/i, "");

        const itemIds = loaders.getItemIdsByName(itemName);
        if (itemIds.length > 0) {
            return {
                type: TriggerType.ItemCraft,
                itemIds,
                count: count > 1 ? count : undefined,
            };
        }
    }

    // === Resource Gather patterns ===
    // "Chop 100 Magic Logs", "Mine a Runite Ore", "Catch a Shark"
    const gatherMatch = name.match(
        /^(chop|mine|catch|fish|pick|harvest)\s+(a\s+|an\s+|the\s+)?(\d+\s+)?(.+)$/i,
    );
    if (gatherMatch) {
        const count = gatherMatch[3] ? parseInt(gatherMatch[3], 10) || 1 : 1;
        const itemName = gatherMatch[4].trim();

        const itemIds = loaders.getItemIdsByName(itemName);
        if (itemIds.length > 0) {
            // Gathering is essentially obtaining the item
            return {
                type: TriggerType.ItemObtain,
                itemIds,
                count: count > 1 ? count : undefined,
            };
        }
    }

    // No pattern matched - needs manual trigger
    return undefined;
}

/**
 * Build name-to-IDs lookup functions from cache loaders.
 */
export function buildNameLookups(
    npcTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
    objTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
): TriggerParserLoaders {
    // Build NPC name -> IDs map
    const npcNameToIds = new Map<string, number[]>();
    if (npcTypeLoader) {
        for (let id = 0; id < 20000; id++) {
            const npc = npcTypeLoader.load(id);
            if (npc?.name && npc.name !== "null") {
                const nameLower = npc.name.toLowerCase();
                let ids = npcNameToIds.get(nameLower);
                if (!ids) {
                    ids = [];
                    npcNameToIds.set(nameLower, ids);
                }
                ids.push(id);
            }
        }
    }

    // Build item name -> IDs map
    const itemNameToIds = new Map<string, number[]>();
    if (objTypeLoader) {
        for (let id = 0; id < 30000; id++) {
            const item = objTypeLoader.load(id);
            if (item?.name && item.name !== "null") {
                const nameLower = item.name.toLowerCase();
                let ids = itemNameToIds.get(nameLower);
                if (!ids) {
                    ids = [];
                    itemNameToIds.set(nameLower, ids);
                }
                ids.push(id);
            }
        }
    }

    return {
        getNpcIdsByName: (name: string) => npcNameToIds.get(name.toLowerCase()) ?? [],
        getItemIdsByName: (name: string) => itemNameToIds.get(name.toLowerCase()) ?? [],
    };
}
