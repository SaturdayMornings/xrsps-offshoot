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
    /**
     * Item ids whose (lower-cased) cache name ends with the given suffix, e.g.
     * "bones" for "Bury any kind of Bones".
     */
    getItemIdsEndingWith: NameToIdsLookup;
    /**
     * Item ids whose (lower-cased) cache name starts with the given prefix, e.g.
     * "burnt " for "Burn any kind of food".
     */
    getItemIdsStartingWith?: NameToIdsLookup;
    /**
     * Resolve a quest name used by a "Complete X" task to the stable quest key
     * registered by the server (see the vanilla QuestRegistry). Returns
     * undefined for quests this server does not implement, which keeps those
     * tasks out of the index instead of silently registering a dead trigger.
     */
    getQuestKeyByName?: (name: string) => string | undefined;
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

/** Task names add location/context noise that item names never contain. */
const LOCATION_SUFFIX = /\s+(in|at|on|near|from)\s+.+$/i;
/**
 * Tool/requirement noise a task name may carry, e.g. "Mine some Ore With a
 * Steel Pickaxe" or "Chop Some Logs Using a Steel Axe". The qualifier is not
 * modelled, so those tasks resolve against the target item only.
 */
const TOOL_SUFFIX = /\s+(with|using)\s+.+$/i;
/** Any of these, used as a leading article, never belongs to the item name. */
const LEADING_ARTICLE =
    /^(?:a|an|the|some|any|any\s+kind\s+of|any\s+type\s+of|all|every|your|my)\s+/i;
/** Raw-item wording, e.g. "Cook Raw Shrimp" vs the cooked "Shrimps" item. */
const RAW_PREFIX = /^raw\s+/i;
/** "any kind of"/"any type of" wording expands to a whole item category. */
const ANY_KIND = /any\s+(?:kind|type)\s+of/;
/** "Bury any kind of Bones" / "Bury Some Bones" - any bone counts. */
const ANY_BONES = /^bones?$/;

/**
 * Task wording that never matches a cache item name directly.
 *
 * The value lists the cache names (or further task wording) the task name
 * stands for; the first entry that resolves wins.
 */
const ITEM_NAME_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
    // The plain logs item is called "Logs" in the cache.
    ["normal logs", ["logs"]],
    // Cache name keeps the "leaf" suffix.
    ["grimy guam", ["grimy guam leaf"]],
    // "a basic elemental staff" is any of the four elemental staves.
    ["elemental staff", ["staff of air", "staff of water", "staff of earth", "staff of fire"]],
    // Cache name is spaced.
    ["snapegrass", ["snape grass"]],
]);

/**
 * Leading adverbs task names sometimes carry ("Successfully Cut a Red Topaz"),
 * which the action patterns below do not expect.
 */
const LEADING_ADVERB = /^(?:successfully|successful|accidently|accidentally)\s+/i;

/**
 * Item names a task may use instead of the exact cache name.
 * "Cook Shrimp" -> "Shrimps", "Catch Shrimp" -> "Raw shrimps",
 * "Cook Raw Shark" -> "Shark", "Cook 100 Karambwans" -> "Cooked karambwan".
 *
 * Variants are ordered, so a task that already resolved by its exact name keeps
 * resolving to the same item.
 */
function itemNameVariants(name: string): string[] {
    const base = name.toLowerCase().trim();
    const variants: string[] = [];
    const add = (value: string) => {
        if (value.length > 0 && !variants.includes(value)) variants.push(value);
    };

    add(base);
    // Singular <-> plural, including "berries" -> "berry".
    if (base.endsWith("ies")) add(`${base.slice(0, -3)}y`);
    if (base.endsWith("s")) add(base.slice(0, -1));
    else add(`${base}s`);
    if (base.endsWith("y")) add(`${base.slice(0, -1)}ies`);
    // Cooked items drop the "Raw" prefix that raw items carry.
    if (RAW_PREFIX.test(base)) add(base.replace(RAW_PREFIX, ""));
    else add(`raw ${base}`);
    // ...but many cooked products are themselves prefixed ("Cooked karambwan").
    for (const variant of [...variants]) {
        add(`cooked ${variant.replace(RAW_PREFIX, "")}`);
    }

    // Potions are cache-named with a dose suffix ("Attack potion(3)") while
    // tasks leave the dose out. The server crafts the 3-dose item, so that is
    // the form worth matching.
    for (const variant of [...variants]) {
        if (!/\(\d\)$/.test(variant)) add(`${variant}(3)`);
    }

    return variants;
}

/**
 * Resolve the item a task name refers to, tolerating singular/plural and
 * raw/cooked wording ("Cook Shrimp" is the cooked "Shrimps") as well as
 * trailing location text ("Cook 20 Sharks in Darkmeyer").
 *
 * The untrimmed name is tried first so item names that genuinely contain
 * location words still resolve.
 */
function resolveItemIds(name: string, loaders: TriggerParserLoaders): number[] {
    const raw = name
        .toLowerCase()
        .replace(/[.!?,]+$/, "")
        .trim();
    const withoutLocation = stripTrailingContext(raw);

    for (const candidate of withoutLocation !== raw ? [raw, withoutLocation] : [raw]) {
        for (const variant of itemNameVariants(candidate)) {
            const itemIds = loaders.getItemIdsByName(variant);
            if (itemIds.length > 0) return itemIds;
        }
        // Wording that never matches a cache name ("normal logs", "elemental staff").
        const synonyms = ITEM_NAME_SYNONYMS.get(candidate);
        if (synonyms) {
            const itemIds: number[] = [];
            for (const synonym of synonyms) {
                for (const variant of itemNameVariants(synonym)) {
                    for (const id of loaders.getItemIdsByName(variant)) {
                        if (!itemIds.includes(id)) itemIds.push(id);
                    }
                }
            }
            if (itemIds.length > 0) return itemIds;
        }
    }

    return [];
}

/**
 * Resolve the item produced by a gathering task ("Catch a Shrimp", "Mine some
 * Copper Ore", "Chop Some Logs").
 *
 * Fishing/hunter wording names the *cooked* form of an item ("Catch a Shrimp"
 * vs the cooked "Shrimps"), so the raw form is tried first and the normal
 * resolution is used as a fallback for items with no "raw" variant.
 */
function resolveGatheredItemIds(name: string, loaders: TriggerParserLoaders): number[] {
    const rawVariants = itemNameVariants(`raw ${name}`);
    for (const variant of rawVariants) {
        const itemIds = loaders.getItemIdsByName(variant);
        if (itemIds.length > 0) return itemIds;
    }
    return resolveItemIds(name, loaders);
}

/**
 * Resolve the item target of a task, expanding "any kind of X" wording into
 * every cache item whose name ends with X ("Chop Some Logs" accepts oak, yew,
 * magic, ... logs, not just plain "Logs").
 */
function resolveTargetItemIds(
    target: string,
    loaders: TriggerParserLoaders,
    options: { anyKind?: boolean; gathered?: boolean } = {},
): number[] {
    const cleaned = stripTrailingContext(target.toLowerCase().replace(/[.!?,]+$/, ""));

    if (options.anyKind && cleaned.length > 0) {
        // The wording may be singular ("any type of rune") or plural
        // ("any kind of logs"); use whichever suffix matches more items.
        const plural = cleaned.endsWith("s") ? cleaned : `${cleaned}s`;
        const singular = cleaned.endsWith("s") ? cleaned.slice(0, -1) : cleaned;
        const pluralIds = loaders.getItemIdsEndingWith(plural);
        const singularIds = loaders.getItemIdsEndingWith(singular);
        const best = pluralIds.length >= singularIds.length ? pluralIds : singularIds;
        if (best.length > 1) return best;
    }

    const resolved = options.gathered
        ? resolveGatheredItemIds(target, loaders)
        : resolveItemIds(target, loaders);
    if (resolved.length > 0) return resolved;

    // "Mine some essence", "Mine some Ore With a Steel Pickaxe": a bare category
    // noun names a whole family of items.
    if (options.gathered && /^[a-z]+$/.test(cleaned)) {
        return loaders.getItemIdsEndingWith(cleaned);
    }

    return resolved;
}

/** Strip the leading article from a task's item/npc target. */
function stripArticle(target: string): string {
    return target.replace(LEADING_ARTICLE, "").trim();
}

/**
 * Strip trailing context that task names add to a target but that is not part
 * of the name itself: location ("Moss Giant in Tirannwn"), tool or requirement
 * ("Ore With a Steel Pickaxe", "Chicken with your fists") and manner
 * ("Spider by kicking it").
 */
function stripTrailingContext(target: string): string {
    return target
        .replace(LOCATION_SUFFIX, "")
        .replace(TOOL_SUFFIX, "")
        .replace(/\s+by\s+.+$/i, "")
        .trim();
}

/**
 * Verbs whose task wording names the *raw* form of the gathered item
 * ("Catch a Shrimp" is the raw "Raw shrimps", "Mine a Runite Ore").
 */
const GATHERING_VERBS = new Set(["catch", "snare", "fish", "mine", "chop", "pick", "harvest"]);

/**
 * Resolve an item target that may name more than one item
 * ("Equip a Studded Body and Chaps").
 *
 * The full name is tried first so items that genuinely contain "and" keep
 * resolving normally. Otherwise each part must resolve, with later parts
 * inheriting the leading adjective of the first part ("Studded Body and Chaps"
 * -> "Studded Body" + "Studded Chaps"); a part that still cannot be resolved
 * leaves the whole task unparsed instead of matching the wrong items.
 */
function resolveMultiItemIds(name: string, loaders: TriggerParserLoaders): number[] {
    const direct = resolveItemIds(name, loaders);
    if (direct.length > 0) return direct;

    const parts = name.split(/\s+and\s+/i).map((part) => part.trim());
    if (parts.length < 2) return [];

    const headWords = stripArticle(parts[0]).split(/\s+/);
    const head = headWords.length > 1 ? headWords.slice(0, -1).join(" ") : "";

    const itemIds: number[] = [];
    for (let i = 0; i < parts.length; i++) {
        const part = stripArticle(parts[i]);
        let partIds = resolveItemIds(part, loaders);
        if (partIds.length === 0 && head.length > 0 && i > 0) {
            partIds = resolveItemIds(`${head} ${part}`, loaders);
        }
        if (partIds.length === 0) return [];
        for (const id of partIds) {
            if (!itemIds.includes(id)) itemIds.push(id);
        }
    }

    return itemIds;
}

/**
 * Resolve the target of a "Bury ..." task.
 *
 * "Bury Some Bones" means any bone in the game, so it expands to every bone
 * item ("Bones", "Big bones", "Dragon bones", ...). Lists such as "Bury Some
 * Wyvern or Dragon Bones" share the trailing noun of the last entry, and named
 * bones resolve through the cache item names ("Lava dragon bones").
 */
function resolveBuryItemIds(target: string, loaders: TriggerParserLoaders): number[] {
    const cleaned = target.toLowerCase().trim();
    const parts = cleaned.split(/\s+or\s+/);
    const sharedNoun = parts.length > 1 ? parts[parts.length - 1].split(/\s+/).pop() : undefined;

    const itemIds: number[] = [];
    const add = (ids: readonly number[]) => {
        for (const id of ids) {
            if (!itemIds.includes(id)) itemIds.push(id);
        }
    };

    for (const part of parts) {
        // "Wyvern or Dragon Bones" -> the bare "Wyvern" shares the trailing noun.
        const candidates =
            sharedNoun && !part.endsWith(` ${sharedNoun}`) ? [`${part} ${sharedNoun}`, part] : [part];

        for (const candidate of candidates) {
            // "Bury any kind of Bones" accepts every bone in the cache.
            if (ANY_BONES.test(candidate)) {
                add(loaders.getItemIdsEndingWith("bones"));
                add(loaders.getItemIdsEndingWith("bone"));
                break;
            }

            const exact = loaders.getItemIdsByName(candidate);
            if (exact.length > 0) {
                add(exact);
                break;
            }

            // Bone-suffix lookup catches variants the exact name misses.
            if (candidate.endsWith("bones") || candidate.endsWith("bone")) {
                const suffixMatches = loaders.getItemIdsEndingWith(candidate);
                if (suffixMatches.length > 0) {
                    add(suffixMatches);
                    break;
                }
            }
        }
    }

    return itemIds;
}

/**
 * Parse a "Complete <quest>" task.
 *
 * Quest names are matched against the quest definitions the server actually
 * registered (through QuestRegistry), so an unimplemented quest leaves the task
 * unparsed instead of wiring a trigger nothing will ever fire. Both cache
 * wording variants are tried: "Complete Foo", "Complete the Foo quest" and
 * "Complete The Foo" (definitions keep the leading "The").
 */
function parseQuestTrigger(
    name: string,
    loaders: TriggerParserLoaders,
): TaskTrigger | undefined {
    if (!loaders.getQuestKeyByName) return undefined;

    const match = /^complete\s+(.+?)(?:\s+quest)?$/i.exec(name.trim());
    if (!match) return undefined;

    const raw = match[1].trim();
    if (raw.length === 0) return undefined;

    const candidates: string[] = [raw];
    if (/^the\s+/i.test(raw)) candidates.push(raw.replace(/^the\s+/i, ""));
    else candidates.push(`The ${raw}`);

    for (const candidate of candidates) {
        const questKey = loaders.getQuestKeyByName(candidate);
        if (questKey) {
            return {
                type: TriggerType.QuestComplete,
                questKey,
                questName: candidate,
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
    // Task names occasionally lead with an adverb ("Successfully Cut a Red
    // Topaz"); strip it so the action patterns below still match.
    const taskName = name.replace(LEADING_ADVERB, "");

    // === Level milestone patterns ===
    // Stateful: evaluated against the player's skills on level-up and login.
    const levelTrigger = parseLevelTrigger(nameLower, descLower);
    if (levelTrigger) {
        return levelTrigger;
    }

    // === Quest completion patterns ===
    // "Complete Rune Mysteries", "Complete The Restless Ghost", "Complete the
    // Queen of Thieves quest". Only quests the server implements resolve; the
    // rest stay unparsed so the audit reports them as unsupported rather than
    // registering a trigger that can never fire.
    const questTrigger = parseQuestTrigger(name, loaders);
    if (questTrigger) {
        return questTrigger;
    }

    // === NPC Kill patterns ===
    // "Defeat a Moss Giant", "Kill 10 Goblins", "Slay a Black Dragon"
    const killPatterns = [
        /^(defeat|kill|slay)\s+(a\s+|an\s+|the\s+|some\s+|any\s+)?(\d+\s+)?(.+)$/i,
        /^(\d+)\s+(.+?)\s+(kill|kills)$/i, // "10 Goblin Kills" or "1 Zulrah Kill"
    ];

    for (const pattern of killPatterns) {
        const match = taskName.match(pattern);
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

            // Clean up NPC name (remove trailing location/tool/manner context)
            // "Moss Giant in Tirannwn" -> "Moss Giant",
            // "Chicken with your fists" -> "Chicken",
            // "Spider by kicking it" -> "Spider"
            npcName = stripTrailingContext(npcName);

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

    // === NPC interaction patterns ===
    // "Talk to Hans", "Speak to Ilfeen in Tirannwn", "Pet a Stray Dog in
    // Varrock", "Stroke your cat", "Charm Gertrude"
    const interactPatterns = [
        /^(?:talk|speak)\s+to\s+(.+)$/i,
        /^(?:pet|stroke|charm)\s+(.+)$/i,
    ];
    for (const pattern of interactPatterns) {
        const match = taskName.match(pattern);
        if (!match) continue;
        const npcName = stripTrailingContext(stripArticle(match[1]));
        const npcIds = loaders.getNpcIdsByName(npcName);
        if (npcIds.length > 0) {
            return {
                type: TriggerType.NpcInteract,
                npcIds,
            };
        }
    }

    // === Item Equip patterns ===
    // "Equip a Dragon Scimitar", "Wear a Fire Cape",
    // "Equip a Studded Body and Chaps"
    const equipMatch = taskName.match(/^(equip|wear)\s+(.+)$/i);
    if (equipMatch) {
        const itemName = stripArticle(equipMatch[2]);
        const lowerItemName = itemName.toLowerCase();

        // "Piece of X" / "Full X set" style rewards need bespoke handling.
        if (!lowerItemName.includes("piece of") && !lowerItemName.includes("set")) {
            const itemIds = resolveMultiItemIds(itemName, loaders);
            if (itemIds.length > 0) {
                return {
                    type: TriggerType.ItemEquip,
                    itemIds,
                };
            }
        }
    }

    // === Item Obtain patterns ===
    // "Obtain a Dragon Axe", "Receive a Pet", "Pick up Snapegrass",
    // "Catch a Shrimp", "Mine 5 Tin Ore", "Chop Some Logs"
    const obtainMatch = taskName.match(
        /^(obtain|receive|get|loot|take|pick\s+up|pick|find|gather|catch|snare|fish|mine|chop|harvest)\s+(a\s+|an\s+|the\s+|some\s+|any\s+)?(\d+\s+)?(.+)$/i,
    );
    if (obtainMatch) {
        const verb = obtainMatch[1].toLowerCase();
        const count = obtainMatch[3] ? parseInt(obtainMatch[3], 10) || 1 : 1;
        const itemName = obtainMatch[4].trim();
        const gathered = GATHERING_VERBS.has(verb);

        const itemIds = resolveTargetItemIds(itemName, loaders, {
            anyKind: ANY_KIND.test(descLower),
            gathered,
        });
        if (itemIds.length > 0) {
            return {
                type: TriggerType.ItemObtain,
                itemIds,
                count: count > 1 ? count : undefined,
            };
        }
    }

    // === Item Craft patterns ===
    // "Craft a Black D'hide Body", "Smith a Rune Platebody", "Cook a Shark",
    // "Smelt a Bronze Bar", "Clean a Grimy Guam", "Spin a Ball of Wool"
    const craftMatch = taskName.match(
        /^(craft|smith|cook|fletch|create|make|brew|smelt|clean|cut|spin|burn|light)\s+(a\s+|an\s+|the\s+|some\s+|any\s+)?(\d+\s+)?(.+)$/i,
    );
    if (craftMatch) {
        const count = craftMatch[3] ? parseInt(craftMatch[3], 10) || 1 : 1;
        let itemName = craftMatch[4].trim();

        // Remove "(u)" suffix for unstrung items
        itemName = itemName.replace(/\s*\(u\)\s*$/i, "");

        // "Burn Some Food" is completed by burning any food while cooking, so it
        // expands to every "Burnt ..." item rather than to items named "food".
        const burnFood = /^burn/i.test(craftMatch[1]) && /\bfood\b/i.test(itemName);
        const itemIds = burnFood
            ? (loaders.getItemIdsStartingWith?.("burnt ") ?? [])
            : resolveTargetItemIds(itemName, loaders, {
                  anyKind: ANY_KIND.test(descLower),
              });
        if (itemIds.length > 0) {
            return {
                type: TriggerType.ItemCraft,
                itemIds,
                count: count > 1 ? count : undefined,
            };
        }
    }

    // === Item Bury patterns ===
    // "Bury Some Bones", "Bury 10 Dragon Bones", "Bury any kind of Bones"
    const buryMatch = taskName.match(
        /^bury\s+(?:(?:any|some|a|an|the)\s+)?(?:kind\s+of\s+)?(?:(\d+)\s+)?(.+)$/i,
    );
    if (buryMatch) {
        const count = buryMatch[1] ? parseInt(buryMatch[1], 10) || 1 : 1;
        const itemIds = resolveBuryItemIds(buryMatch[2].trim(), loaders);
        if (itemIds.length > 0) {
            return {
                type: TriggerType.ItemBury,
                itemIds,
                count: count > 1 ? count : undefined,
            };
        }
    }

    // Resource gathering ("Chop 100 Magic Logs", "Mine a Runite Ore",
    // "Catch a Shark") is handled by the obtain patterns above, where those
    // verbs resolve the *raw* form of the item and expand "any kind of" wording.

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

    // Suffix lookups walk the whole name map, so cache each query.
    const itemSuffixCache = new Map<string, number[]>();
    const itemPrefixCache = new Map<string, number[]>();

    return {
        getNpcIdsByName: (name: string) => npcNameToIds.get(name.toLowerCase()) ?? [],
        getItemIdsByName: (name: string) => itemNameToIds.get(name.toLowerCase()) ?? [],
        getItemIdsEndingWith: (suffix: string) => {
            const needle = suffix.toLowerCase();
            if (needle.length === 0) return [];

            let ids = itemSuffixCache.get(needle);
            if (!ids) {
                ids = [];
                for (const [name, nameIds] of itemNameToIds) {
                    if (name.endsWith(needle)) ids.push(...nameIds);
                }
                itemSuffixCache.set(needle, ids);
            }
            return ids;
        },
        getItemIdsStartingWith: (prefix: string) => {
            const needle = prefix.toLowerCase();
            if (needle.length === 0) return [];

            let ids = itemPrefixCache.get(needle);
            if (!ids) {
                ids = [];
                for (const [name, nameIds] of itemNameToIds) {
                    if (name.startsWith(needle)) ids.push(...nameIds);
                }
                itemPrefixCache.set(needle, ids);
            }
            return ids;
        },
    };
}
