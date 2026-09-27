/**
 * LeagueTaskIndex - Builds and maintains indexed lookups for efficient task matching.
 *
 * Instead of iterating all 1800+ tasks on every event, we build reverse indexes:
 * - npcIdToTasks: Which tasks care about killing NPC X?
 * - itemIdToTasks: Which tasks care about obtaining/equipping item X?
 *
 * This gives O(1) lookup + O(m) checks where m is typically 1-5 tasks.
 */
import type { LeagueTaskRow } from "../../../client/common/gamemode/GamemodeDataTypes";
import {
    type RegisteredCustomChallenge,
    type RegisteredCustomTask,
    getAllCustomChallenges,
    getAllCustomTasks,
} from "./data/custom";
import { LEAGUE_TASKS } from "./data/leagueTasks.data";
import {
    type TriggerParserLoaders,
    buildNameLookups,
    parseTaskTrigger,
} from "./triggers/TriggerParser";
import { TriggerType } from "./triggers/TriggerTypes";
import type { TaskTrigger } from "./triggers/TriggerTypes";

export interface ParsedTask {
    taskId: number;
    trigger: TaskTrigger;
    row: LeagueTaskRow;
    /** If this is a custom task, contains the custom task data */
    customTask?: RegisteredCustomTask;
}

export interface ParsedChallenge {
    trigger: TaskTrigger;
    challenge: RegisteredCustomChallenge;
}

export class LeagueTaskIndex {
    // Tier 1 indexes - O(1) lookup by ID
    private npcIdToTasks = new Map<number, ParsedTask[]>();
    private npcIdToInteractTasks = new Map<number, ParsedTask[]>();
    private itemEquipToTasks = new Map<number, ParsedTask[]>();
    private itemObtainToTasks = new Map<number, ParsedTask[]>();
    private itemCraftToTasks = new Map<number, ParsedTask[]>();
    private itemBuryToTasks = new Map<number, ParsedTask[]>();

    // Challenge indexes - O(1) lookup by trigger ID
    private npcIdToChallenges = new Map<number, ParsedChallenge[]>();
    private itemEquipToChallenges = new Map<number, ParsedChallenge[]>();
    private itemObtainToChallenges = new Map<number, ParsedChallenge[]>();
    private itemCraftToChallenges = new Map<number, ParsedChallenge[]>();
    private itemBuryToChallenges = new Map<number, ParsedChallenge[]>();

    // Combat-level challenges - checked on every NPC kill (small list)
    private npcKillCombatLevelChallenges: ParsedChallenge[] = [];

    // Level milestone tasks - re-evaluated on level-up / login (small list)
    private levelReachTasks: ParsedTask[] = [];

    // Quest completion tasks - re-evaluated on quest completion / login (small list)
    private questCompleteTasks: ParsedTask[] = [];

    // Stats for debugging
    private parsedCount = 0;
    private unparsedCount = 0;
    private parseFailures: string[] = [];
    private challengeCount = 0;

    /**
     * Build indexes from task definitions.
     * Call this once at server startup.
     */
    static build(
        npcTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
        objTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
        options: { getQuestKeyByName?: (name: string) => string | undefined } = {},
    ): LeagueTaskIndex {
        const index = new LeagueTaskIndex();
        const loaders: TriggerParserLoaders = {
            ...buildNameLookups(npcTypeLoader, objTypeLoader),
            getQuestKeyByName: options.getQuestKeyByName,
        };

        // Index cache-defined tasks
        for (const task of LEAGUE_TASKS) {
            index.indexTask(task, loaders);
        }

        // Index custom tasks from the registry
        for (const customTask of getAllCustomTasks()) {
            index.indexCustomTask(customTask);
        }

        // Index custom challenges from the registry
        for (const challenge of getAllCustomChallenges()) {
            index.indexCustomChallenge(challenge);
        }

        return index;
    }

    private indexTask(task: LeagueTaskRow, loaders: TriggerParserLoaders): void {
        // Check if task has a manual trigger override
        const manualTrigger = (task as unknown as Record<string, unknown>).trigger as
            | TaskTrigger
            | undefined;

        // Parse trigger from task name, or use manual override
        const trigger =
            manualTrigger ?? parseTaskTrigger(task.name, task.description ?? "", loaders);

        if (!trigger) {
            this.unparsedCount++;
            // Only log first 20 failures to avoid spam
            if (this.parseFailures.length < 20) {
                this.parseFailures.push(`[${task.taskId}] ${task.name}`);
            }
            return;
        }

        this.parsedCount++;

        const parsed: ParsedTask = {
            taskId: task.taskId,
            trigger,
            row: task,
        };

        // Index by trigger type
        switch (trigger.type) {
            case TriggerType.NpcKill:
                for (const npcId of trigger.npcIds) {
                    this.addToIndex(this.npcIdToTasks, npcId, parsed);
                }
                break;

            case TriggerType.NpcInteract:
                for (const npcId of trigger.npcIds) {
                    this.addToIndex(this.npcIdToInteractTasks, npcId, parsed);
                }
                break;

            case TriggerType.ItemEquip:
                for (const itemId of trigger.itemIds) {
                    this.addToIndex(this.itemEquipToTasks, itemId, parsed);
                }
                break;

            case TriggerType.ItemObtain:
                for (const itemId of trigger.itemIds) {
                    this.addToIndex(this.itemObtainToTasks, itemId, parsed);
                }
                break;

            case TriggerType.ItemCraft:
                for (const itemId of trigger.itemIds) {
                    this.addToIndex(this.itemCraftToTasks, itemId, parsed);
                }
                break;

            case TriggerType.ItemBury:
                for (const itemId of trigger.itemIds) {
                    this.addToIndex(this.itemBuryToTasks, itemId, parsed);
                }
                break;

            case TriggerType.LevelReach:
                this.levelReachTasks.push(parsed);
                break;

            case TriggerType.QuestComplete:
                this.questCompleteTasks.push(parsed);
                break;

            // Tier 2+ triggers - not indexed yet
            default:
                break;
        }
    }

    /**
     * Index a custom task from the registry.
     * Custom tasks have their trigger defined in the definition, no parsing needed.
     */
    private indexCustomTask(customTask: RegisteredCustomTask): void {
        const trigger = customTask.trigger;
        if (!trigger) {
            // Custom task without trigger - won't be auto-completed
            return;
        }

        this.parsedCount++;

        // Build a LeagueTaskRow-like object for the custom task
        const row: LeagueTaskRow = {
            taskId: customTask.taskId,
            name: customTask.name,
            description: customTask.description,
            tier: customTask.tier,
            points: customTask.points,
            category: customTask.category,
            area: customTask.area,
            skill: customTask.skill,
            structId: customTask.structId,
        };

        const parsed: ParsedTask = {
            taskId: customTask.taskId,
            trigger,
            row,
            customTask,
        };

        // Index by trigger type
        switch (trigger.type) {
            case TriggerType.NpcKill:
                for (const npcId of trigger.npcIds) {
                    this.addToIndex(this.npcIdToTasks, npcId, parsed);
                }
                break;

            case TriggerType.NpcInteract:
                for (const npcId of trigger.npcIds) {
                    this.addToIndex(this.npcIdToInteractTasks, npcId, parsed);
                }
                break;

            case TriggerType.ItemEquip:
                for (const itemId of trigger.itemIds) {
                    this.addToIndex(this.itemEquipToTasks, itemId, parsed);
                }
                break;

            case TriggerType.ItemObtain:
                for (const itemId of trigger.itemIds) {
                    this.addToIndex(this.itemObtainToTasks, itemId, parsed);
                }
                break;

            case TriggerType.ItemCraft:
                for (const itemId of trigger.itemIds) {
                    this.addToIndex(this.itemCraftToTasks, itemId, parsed);
                }
                break;

            case TriggerType.ItemBury:
                for (const itemId of trigger.itemIds) {
                    this.addToIndex(this.itemBuryToTasks, itemId, parsed);
                }
                break;

            case TriggerType.LevelReach:
                this.levelReachTasks.push(parsed);
                break;

            case TriggerType.QuestComplete:
                this.questCompleteTasks.push(parsed);
                break;

            default:
                break;
        }
    }

    private addToIndex(map: Map<number, ParsedTask[]>, key: number, task: ParsedTask): void {
        let tasks = map.get(key);
        if (!tasks) {
            tasks = [];
            map.set(key, tasks);
        }
        tasks.push(task);
    }

    /**
     * Index a custom challenge from the registry.
     * Custom challenges have their trigger defined in the definition.
     */
    private indexCustomChallenge(challenge: RegisteredCustomChallenge): void {
        const trigger = challenge.trigger;
        if (!trigger) {
            // Challenge without trigger - won't be auto-completed
            return;
        }

        this.challengeCount++;

        const parsed: ParsedChallenge = {
            trigger,
            challenge,
        };

        // Index by trigger type
        switch (trigger.type) {
            case TriggerType.NpcKill:
                for (const npcId of trigger.npcIds) {
                    this.addToChallengeIndex(this.npcIdToChallenges, npcId, parsed);
                }
                break;

            case TriggerType.ItemEquip:
                for (const itemId of trigger.itemIds) {
                    this.addToChallengeIndex(this.itemEquipToChallenges, itemId, parsed);
                }
                break;

            case TriggerType.ItemObtain:
                for (const itemId of trigger.itemIds) {
                    this.addToChallengeIndex(this.itemObtainToChallenges, itemId, parsed);
                }
                break;

            case TriggerType.ItemCraft:
                for (const itemId of trigger.itemIds) {
                    this.addToChallengeIndex(this.itemCraftToChallenges, itemId, parsed);
                }
                break;

            case TriggerType.ItemBury:
                for (const itemId of trigger.itemIds) {
                    this.addToChallengeIndex(this.itemBuryToChallenges, itemId, parsed);
                }
                break;

            case TriggerType.NpcKillCombatLevel:
                this.npcKillCombatLevelChallenges.push(parsed);
                break;

            default:
                break;
        }
    }

    private addToChallengeIndex(
        map: Map<number, ParsedChallenge[]>,
        key: number,
        challenge: ParsedChallenge,
    ): void {
        let challenges = map.get(key);
        if (!challenges) {
            challenges = [];
            map.set(key, challenges);
        }
        challenges.push(challenge);
    }

    // === Lookup methods ===

    /**
     * Get tasks triggered by killing an NPC.
     */
    getTasksForNpcKill(npcId: number): ParsedTask[] {
        return this.npcIdToTasks.get(npcId) ?? [];
    }

    /**
     * Get tasks triggered by equipping an item.
     */
    getTasksForItemEquip(itemId: number): ParsedTask[] {
        return this.itemEquipToTasks.get(itemId) ?? [];
    }

    /**
     * Get tasks triggered by obtaining an item.
     */
    getTasksForItemObtain(itemId: number): ParsedTask[] {
        return this.itemObtainToTasks.get(itemId) ?? [];
    }

    /**
     * Get tasks triggered by crafting an item.
     */
    getTasksForItemCraft(itemId: number): ParsedTask[] {
        return this.itemCraftToTasks.get(itemId) ?? [];
    }

    /**
     * Get tasks triggered by burying an item ("Bury Some Bones").
     */
    getTasksForItemBury(itemId: number): ParsedTask[] {
        return this.itemBuryToTasks.get(itemId) ?? [];
    }

    // === Challenge Lookup methods ===

    /**
     * Get challenges triggered by killing an NPC.
     */
    getChallengesForNpcKill(npcId: number): ParsedChallenge[] {
        return this.npcIdToChallenges.get(npcId) ?? [];
    }

    /**
     * Get tasks triggered by interacting with an NPC ("Talk to Hans",
     * "Pet a Stray Dog in Varrock", ...).
     */
    getTasksForNpcInteract(npcId: number): ParsedTask[] {
        return this.npcIdToInteractTasks.get(npcId) ?? [];
    }

    /**
     * Get challenges triggered by equipping an item.
     */
    getChallengesForItemEquip(itemId: number): ParsedChallenge[] {
        return this.itemEquipToChallenges.get(itemId) ?? [];
    }

    /**
     * Get challenges triggered by obtaining an item.
     */
    getChallengesForItemObtain(itemId: number): ParsedChallenge[] {
        return this.itemObtainToChallenges.get(itemId) ?? [];
    }

    /**
     * Get challenges triggered by crafting an item.
     */
    getChallengesForItemCraft(itemId: number): ParsedChallenge[] {
        return this.itemCraftToChallenges.get(itemId) ?? [];
    }

    /**
     * Get challenges triggered by burying an item.
     */
    getChallengesForItemBury(itemId: number): ParsedChallenge[] {
        return this.itemBuryToChallenges.get(itemId) ?? [];
    }

    getChallengesForNpcKillCombatLevel(combatLevel: number): ParsedChallenge[] {
        return this.npcKillCombatLevelChallenges.filter((parsed) => {
            const trigger = parsed.trigger;
            if (trigger.type !== TriggerType.NpcKillCombatLevel) return false;
            return combatLevel >= trigger.minCombatLevel;
        });
    }

    /**
     * Get tasks that complete once the player's skills reach a level milestone.
     * Level tasks are stateful, so they are evaluated as one small list on
     * level-up and login instead of being looked up by an event id.
     */
    getLevelReachTasks(): readonly ParsedTask[] {
        return this.levelReachTasks;
    }

    /**
     * Get tasks that complete once the player finishes a quest.
     * Quest tasks are stateful (quest completion is varp-backed), so they are
     * evaluated as one small list on quest completion and on login.
     */
    getQuestCompleteTasks(): readonly ParsedTask[] {
        return this.questCompleteTasks;
    }

    // === Stats ===

    getStats(): {
        parsed: number;
        unparsed: number;
        total: number;
        coverage: string;
        challenges: number;
        indexSizes: {
            npcKill: number;
            npcInteract: number;
            itemEquip: number;
            itemObtain: number;
            itemCraft: number;
            itemBury: number;
            levelReach: number;
            questComplete: number;
        };
        challengeIndexSizes: {
            npcKill: number;
            itemEquip: number;
            itemObtain: number;
            itemCraft: number;
            itemBury: number;
        };
        sampleFailures: string[];
    } {
        const total = this.parsedCount + this.unparsedCount;
        return {
            parsed: this.parsedCount,
            unparsed: this.unparsedCount,
            total,
            coverage: `${((this.parsedCount / total) * 100).toFixed(1)}%`,
            challenges: this.challengeCount,
            indexSizes: {
                npcKill: this.npcIdToTasks.size,
                npcInteract: this.npcIdToInteractTasks.size,
                itemEquip: this.itemEquipToTasks.size,
                itemObtain: this.itemObtainToTasks.size,
                itemCraft: this.itemCraftToTasks.size,
                itemBury: this.itemBuryToTasks.size,
                levelReach: this.levelReachTasks.length,
                questComplete: this.questCompleteTasks.length,
            },
            challengeIndexSizes: {
                npcKill: this.npcIdToChallenges.size,
                itemEquip: this.itemEquipToChallenges.size,
                itemObtain: this.itemObtainToChallenges.size,
                itemCraft: this.itemCraftToChallenges.size,
                itemBury: this.itemBuryToChallenges.size,
            },
            sampleFailures: this.parseFailures,
        };
    }
}
