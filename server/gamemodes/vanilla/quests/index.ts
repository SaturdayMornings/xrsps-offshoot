import type { IScriptRegistry, ScriptServices } from "../../../src/game/scripts/types";
import { getQuestDefinitionByName, registerQuestDefinition } from "./QuestRegistry";
import {
    VARP_QUEST_POINTS,
    completeAllQuests,
    registerQuestCompletedWidgetHandlers,
    setQuestStage,
} from "./QuestService";
import { blackKnightsFortressQuest } from "./definitions/blackKnightsFortress";
import { biohazardQuest } from "./definitions/biohazard";
import { bigChompyBirdHuntingQuest } from "./definitions/bigChompyBirdHunting";
import { clockTowerQuest } from "./definitions/clockTower";
import { cooksAssistantQuest } from "./definitions/cooksAssistant";
import { deathPlateauQuest } from "./definitions/deathPlateau";
import { demonSlayerQuest } from "./definitions/demonSlayer";
import { desertTreasureIQuest } from "./definitions/desertTreasureI";
import { digSiteQuest } from "./definitions/digSite";
import { doricsQuest } from "./definitions/dorics";
import { dragonSlayerIQuest } from "./definitions/dragonSlayerI";
import { druidicRitualQuest } from "./definitions/druidicRitual";
import { dwarfCannonQuest } from "./definitions/dwarfCannon";
import { elementalWorkshopIQuest } from "./definitions/elementalWorkshopI";
import { ernestTheChickenQuest } from "./definitions/ernestTheChicken";
import { familyCrestQuest } from "./definitions/familyCrest";
import { fightArenaQuest } from "./definitions/fightArena";
import { fishingContestQuest } from "./definitions/fishingContest";
import { gertrudesCatQuest } from "./definitions/gertrudesCat";
import { grandTreeQuest } from "./definitions/grandTree";
import { goblinDiplomacyQuest } from "./definitions/goblinDiplomacy";
import { hazeelCultQuest } from "./definitions/hazeelCult";
import { holyGrailQuest } from "./definitions/holyGrail";
import { heroesQuest } from "./definitions/heroesQuest";
import { impCatcherQuest } from "./definitions/impCatcher";
import { junglePotionQuest } from "./definitions/junglePotion";
import { knightsSwordQuest } from "./definitions/knightsSword";
import { lostCityQuest } from "./definitions/lostCity";
import { merlinsCrystalQuest } from "./definitions/merlinsCrystal";
import { monksFriendQuest } from "./definitions/monksFriend";
import { murderMysteryQuest } from "./definitions/murderMystery";
import { natureSpiritQuest } from "./definitions/natureSpirit";
import { observatoryQuest } from "./definitions/observatoryQuest";
import { piratesTreasureQuest } from "./definitions/piratesTreasure";
import { plagueCityQuest } from "./definitions/plagueCity";
import { priestInPerilQuest } from "./definitions/priestInPeril";
import { princeAliRescueQuest } from "./definitions/princeAliRescue";
import { preservationRemainderQuests } from "./definitions/preservationRemainder";
import { restlessGhostQuest } from "./definitions/restlessGhost";
import { romeoAndJulietQuest } from "./definitions/romeoAndJuliet";
import { runeMysteriesQuest } from "./definitions/runeMysteries";
import { scorpionCatcherQuest } from "./definitions/scorpionCatcher";
import { seaSlugQuest } from "./definitions/seaSlug";
import { sheepHerderQuest } from "./definitions/sheepHerder";
import { sheepShearerQuest } from "./definitions/sheepShearer";
import { shieldOfArravQuest } from "./definitions/shieldOfArrav";
import { templeOfIkovQuest } from "./definitions/templeOfIkov";
import { touristTrapQuest } from "./definitions/touristTrap";
import { trollStrongholdQuest } from "./definitions/trollStronghold";
import { treeGnomeVillageQuest } from "./definitions/treeGnomeVillage";
import { tribalTotemQuest } from "./definitions/tribalTotem";
import { vampyreSlayerQuest } from "./definitions/vampyreSlayer";
import { waterfallQuest } from "./definitions/waterfallQuest";
import { witchsHouseQuest } from "./definitions/witchsHouse";
import { witchsPotionQuest } from "./definitions/witchsPotion";
import type { QuestDefinition } from "./types";

/** Set once every implemented quest definition has been registered. */
let definitionsRegistered = false;

const QUEST_DEFINITIONS: QuestDefinition[] = [
    blackKnightsFortressQuest,
    bigChompyBirdHuntingQuest,
    clockTowerQuest,
    cooksAssistantQuest,
    demonSlayerQuest,
    doricsQuest,
    dragonSlayerIQuest,
    druidicRitualQuest,
    dwarfCannonQuest,
    elementalWorkshopIQuest,
    ernestTheChickenQuest,
    familyCrestQuest,
    fightArenaQuest,
    fishingContestQuest,
    gertrudesCatQuest,
    grandTreeQuest,
    goblinDiplomacyQuest,
    hazeelCultQuest,
    holyGrailQuest,
    heroesQuest,
    impCatcherQuest,
    junglePotionQuest,
    knightsSwordQuest,
    lostCityQuest,
    merlinsCrystalQuest,
    monksFriendQuest,
    murderMysteryQuest,
    piratesTreasureQuest,
    plagueCityQuest,
    biohazardQuest,
    princeAliRescueQuest,
    restlessGhostQuest,
    romeoAndJulietQuest,
    runeMysteriesQuest,
    scorpionCatcherQuest,
    seaSlugQuest,
    sheepHerderQuest,
    sheepShearerQuest,
    treeGnomeVillageQuest,
    tribalTotemQuest,
    witchsHouseQuest,
    witchsPotionQuest,
    vampyreSlayerQuest,
    deathPlateauQuest,
    digSiteQuest,
    templeOfIkovQuest,
    touristTrapQuest,
    trollStrongholdQuest,
    priestInPerilQuest,
    natureSpiritQuest,
    observatoryQuest,
    waterfallQuest,
    ...preservationRemainderQuests,
    desertTreasureIQuest,
    // Registered last so shared Varrock NPCs can delegate to the other quest handlers.
    shieldOfArravQuest,
];

/**
 * Register every implemented quest definition without its interaction handlers.
 *
 * Idempotent, and safe to call before script bootstrap: the league task parser
 * uses it to resolve "Complete X quest" tasks at index build time, which happens
 * before registerQuestHandlers() runs.
 */
export function ensureQuestDefinitionsRegistered(): void {
    if (definitionsRegistered) return;
    definitionsRegistered = true;
    for (const quest of QUEST_DEFINITIONS) {
        registerQuestDefinition(quest);
    }
}

/**
 * Resolve a quest display name (as used by a league task name) to the stable
 * content key of the quest. Returns undefined for quests this server does not
 * implement, so those tasks stay unparsed instead of registering dead triggers.
 */
export function resolveImplementedQuestKey(name: string): string | undefined {
    ensureQuestDefinitionsRegistered();
    return getQuestDefinitionByName(name)?.key;
}

/**
 * Register all implemented quests: their interaction handlers, the shared
 * quest-completed scroll widget, and the registry consulted by the quest
 * journal for stage-specific text.
 *
 * Must run after skill handlers so quest gates can wrap skill loc handlers
 * (e.g. Doric's anvils wrapping the generic smith action).
 */
export function registerQuestHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    registerQuestCompletedWidgetHandlers(registry, services);
    ensureQuestDefinitionsRegistered();
    for (const quest of QUEST_DEFINITIONS) {
        quest.register(registry, services);
    }

    // Dev command: reset all registered quests (and quest points) for testing
    registry.registerCommand("resetquests", ({ player }) => {
        for (const quest of QUEST_DEFINITIONS) {
            setQuestStage(player, quest, services, 0);
            if (quest.stageBits) {
                player.varps.setVarpValue(quest.varpId, 0);
                services.variables.sendVarp(player, quest.varpId, 0);
            }
        }
        player.varps.setVarpValue(VARP_QUEST_POINTS, 0);
        services.variables.sendVarp(player, VARP_QUEST_POINTS, 0);
        // Desert Treasure's secondary varp stores the lit-torch and placed-diamond masks.
        player.varps.setVarpValue(441, 0);
        services.variables.sendVarp(player, 441, 0);
        player.varps.setVarpValue(61, 0);
        services.variables.sendVarp(player, 61, 0);
        player.varps.setVarpValue(201, 0);
        services.variables.sendVarp(player, 201, 0);
        player.varps.setVarpValue(14, 0);
        services.variables.sendVarp(player, 14, 0);
        player.varps.setVarpValue(224, 0);
        services.variables.sendVarp(player, 224, 0);
        player.varps.setVarpValue(225, 0);
        services.variables.sendVarp(player, 225, 0);
        player.varps.setVarpValue(193, 0);
        services.variables.sendVarp(player, 193, 0);
        player.varps.setVarpValue(194, 0);
        services.variables.sendVarp(player, 194, 0);
        player.varps.setVarpValue(195, 0);
        services.variables.sendVarp(player, 195, 0);
        player.varps.setVarpValue(1, 0);
        services.variables.sendVarp(player, 1, 0);
        player.varps.setVarpValue(69, 0);
        services.variables.sendVarp(player, 69, 0);
        player.varps.setVarpValue(70, 0);
        services.variables.sendVarp(player, 70, 0);
        player.varps.setVarpValue(308, 0);
        services.variables.sendVarp(player, 308, 0);
        player.varps.setVarpValue(294, 0);
        services.variables.sendVarp(player, 294, 0);
        for (const id of [140, 151, 162, 177, 183, 184, 213, 321, 322, 323, 324, 325, 329, 330, 331, 336, 337, 338, 340, 341, 348]) {
            player.varps.setVarpValue(id, 0);
            services.variables.sendVarp(player, id, 0);
        }
        services.system.logger.info?.(
            `[quests] ::resetquests - Reset ${QUEST_DEFINITIONS.length} quest(s) for player ${player.id}`,
        );
        return `Reset ${QUEST_DEFINITIONS.length} quest(s) and quest points.`;
    });

    // Dev command: complete every implemented quest in one idempotent operation.
    registry.registerCommand("completequests", ({ player }) => {
        const questPoints = completeAllQuests(player, services, QUEST_DEFINITIONS);
        services.system.logger.info?.(
            `[quests] ::completequests - Completed ${QUEST_DEFINITIONS.length} quest(s) for player ${player.id}`,
        );
        return `Completed ${QUEST_DEFINITIONS.length} quest(s). Quest points: ${questPoints}.`;
    });

    services.system.logger.info?.(`[quests] Registered ${QUEST_DEFINITIONS.length} quest(s)`);
}

export {
    getQuestDefinition,
    getQuestDefinitionByKey,
    getQuestDefinitionByName,
    getRegisteredQuests,
    normalizeQuestKey,
} from "./QuestRegistry";
export type {
    QuestDefinition,
    QuestItemRequirement,
    QuestProgressRequirement,
    QuestRequirements,
    QuestRewards,
    QuestSkillRequirement,
} from "./types";
