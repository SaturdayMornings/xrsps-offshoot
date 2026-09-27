import { PlayerType } from "../../../client/rs/chat/PlayerType";
import { SKILL_IDS } from "../../../client/rs/skill/skills";
import { LEAGUE_SUMMARY_GROUP_ID } from "../../../client/common/ui/leagueSummary";
import { decodeSideJournalTabFromStateVarp } from "../../../client/common/ui/sideJournal";
import {
    FEATURE_FLAG_LEAGUES,
    MAP_FLAGS_LEAGUE_WORLD,
    VARBIT_LEAGUE_AREA_LAST_VIEWED,
    VARBIT_LEAGUE_AREA_SELECTION_0,
    VARBIT_LEAGUE_AREA_SELECTION_1,
    VARBIT_LEAGUE_AREA_SELECTION_2,
    VARBIT_LEAGUE_AREA_SELECTION_3,
    VARBIT_LEAGUE_AREA_SELECTION_4,
    VARBIT_LEAGUE_AREA_SELECTION_5,
    VARBIT_LEAGUE_TUTORIAL_COMPLETED,
    VARBIT_LEAGUE_TYPE,
    VARP_FEATURE_FLAGS_CACHED,
    VARP_LEAGUE_GENERAL,
    VARP_LEAGUE_POINTS_CLAIMED,
    VARP_LEAGUE_POINTS_COMPLETED,
    VARP_LEAGUE_POINTS_CURRENCY,
    VARP_MAP_FLAGS_CACHED,
    VARP_SIDE_JOURNAL_STATE,
} from "../../../client/common/vars";
import type { EventSubscription } from "../../src/game/events";
import type {
    GamemodeBridge,
    GamemodeInitContext,
    GamemodeUiBridge,
    GamemodeUiController,
    HandshakeBridge,
} from "../../src/game/gamemodes/GamemodeDefinition";
import type { PlayerState } from "../../src/game/player";
import type { IScriptRegistry, ScriptServices } from "../../src/game/scripts/types";
import { VanillaGamemode } from "../vanilla/index";
import { LeagueContentProvider } from "./LeagueContentProvider";
import { LeagueTaskManager } from "./LeagueTaskManager";
import {
    LeagueTaskService,
    getChallengeProgress,
    setChallengeProgress,
    setTaskProgress,
} from "./LeagueTaskService";
import { LeaguesVUiController } from "./LeaguesVUiController";
import { LEAGUE_TASK_COMPLETION_VARPS } from "./data/leagueTaskVarps";
import {
    getLeagueVDropRateMultiplier,
    getLeagueVReplacementItemId,
    isLeagueVWorldPlayer,
} from "./leagueDrops";
import { syncLeagueGeneralVarp } from "./leagueGeneral";
import { getLeaguePackedVarpsForPlayer } from "./leaguePackedVarps";
import { LeagueSummaryTracker } from "./leagueSummary";
import { getLeagueSkillXpMultiplier } from "./leagueXp";
import { getActiveLeagueType, getTutorialCompleteStep, isLeagueWorld } from "./playerWorldRules";
import { registerLeagueTutorHandlers } from "./scripts/leagueTutor";
import { handleLeagueTutorialHintResume } from "./scripts/leagueTutorialHints";
import {
    LEAGUE_TUTORIAL_STEP_WELCOME,
    advanceLeagueTutorialToLeaguesPanel,
    syncLeagueTutorialHandshakeState,
} from "./scripts/leagueTutorialUiState";
import { registerLeagueTutorialWidgetHandlers } from "./scripts/leagueTutorialWidgets";
import { registerLeagueWidgetHandlers } from "./scripts/leagueWidgets";

const TUTORIAL_SPAWN = { x: 3094, y: 3107, level: 0 };
const LUMBRIDGE_SPAWN = { x: 3222, y: 3218, level: 0 };
const VARP_LEAGUE_TASK_COUNT = 2612;

export class LeaguesVGamemode extends VanillaGamemode {
    override readonly id = "leagues-v";
    override readonly name = "Raging Echoes";

    private taskManager: LeagueTaskManager | undefined;
    private initBridge: GamemodeBridge | undefined;
    private leagueSummary: LeagueSummaryTracker | undefined;
    private uiBridge: GamemodeUiBridge | undefined;
    private contentProvider: LeagueContentProvider = new LeagueContentProvider();
    private eventSubscriptions: EventSubscription[] = [];

    // === XP ===

    override getSkillXpMultiplier(player: PlayerState): number {
        if (!isLeagueWorld(player)) return 1;
        const leagueType = getActiveLeagueType(player);
        const pointsClaimed = player.varps.getVarpValue(VARP_LEAGUE_POINTS_CLAIMED);
        return getLeagueSkillXpMultiplier(leagueType, pointsClaimed ?? 0);
    }

    // === Drops ===

    override getDropRateMultiplier(player: PlayerState | undefined): number {
        return getLeagueVDropRateMultiplier(player);
    }

    override transformDropItemId(
        npcTypeId: number,
        itemId: number,
        player: PlayerState | undefined,
    ): number {
        return getLeagueVReplacementItemId(npcTypeId, itemId, isLeagueVWorldPlayer(player));
    }

    // === Player Rules ===

    override canInteract(player: PlayerState): boolean {
        const tutorialStep = player.varps.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
        return tutorialStep >= getTutorialCompleteStep(player);
    }

    canInteractWithNpc(player: PlayerState, npcTypeId: number, option: string): boolean {
        if (this.canInteract(player)) return true;
        const LEAGUE_TUTOR_NPC_TYPE_ID = 315;
        return npcTypeId === LEAGUE_TUTOR_NPC_TYPE_ID && (option === "" || option === "talk-to");
    }

    // === Player Lifecycle ===

    override initializePlayer(player: PlayerState): void {
        player.energy.drainEnabled = false;
        if (player.varps.getVarbitValue(VARBIT_LEAGUE_TYPE) === 0) {
            player.varps.setVarbitValue(VARBIT_LEAGUE_TYPE, 5);
        }
        if (player.varps.getVarpValue(VARP_LEAGUE_GENERAL) === 0) {
            syncLeagueGeneralVarp(player);
        }
        const a0 = player.varps.getVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_0);
        const a1 = player.varps.getVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_1);
        const a2 = player.varps.getVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_2);
        const a3 = player.varps.getVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_3);
        const a4 = player.varps.getVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_4);
        const a5 = player.varps.getVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_5);
        if ((a0 | a1 | a2 | a3 | a4 | a5) === 0) {
            player.varps.setVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_0, 1);
            player.varps.setVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_1, 0);
            player.varps.setVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_2, 0);
            player.varps.setVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_3, 0);
            player.varps.setVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_4, 0);
            player.varps.setVarbitValue(VARBIT_LEAGUE_AREA_SELECTION_5, 0);
        }
        if (player.varps.getVarbitValue(VARBIT_LEAGUE_AREA_LAST_VIEWED) === 0) {
            player.varps.setVarbitValue(VARBIT_LEAGUE_AREA_LAST_VIEWED, 1);
        }
    }

    override serializePlayerState(player: PlayerState): Record<string, unknown> | undefined {
        const result: Record<string, unknown> = {};

        const taskMap = player.gamemodeState.get("taskProgress") as Map<number, number> | undefined;
        if (taskMap && taskMap.size > 0) {
            const progress: Record<number, number> = {};
            for (const [taskId, value] of taskMap.entries()) {
                if (value > 0) progress[taskId] = value;
            }
            if (Object.keys(progress).length > 0) result.progress = progress;
        }

        const challengeMap = player.gamemodeState.get("challengeProgress") as
            | Map<number, number>
            | undefined;
        if (challengeMap && challengeMap.size > 0) {
            const challengeProgress: Record<number, number> = {};
            for (const [idx, value] of challengeMap.entries()) {
                if (value > 0) challengeProgress[idx] = value;
            }
            if (Object.keys(challengeProgress).length > 0)
                result.challengeProgress = challengeProgress;
        }

        return Object.keys(result).length > 0 ? result : undefined;
    }

    override deserializePlayerState(player: PlayerState, data: Record<string, unknown>): void {
        const raw = (data.progress ?? data.leagueTaskProgress) as
            | Record<string, number>
            | undefined;
        if (raw) {
            for (const [key, value] of Object.entries(raw)) {
                const taskId = parseInt(key, 10);
                if (!Number.isNaN(taskId)) {
                    setTaskProgress(player, taskId, value);
                }
            }
        }

        const challengeRaw = data.challengeProgress as Record<string, number> | undefined;
        if (challengeRaw) {
            for (const [key, value] of Object.entries(challengeRaw)) {
                const idx = parseInt(key, 10);
                if (!Number.isNaN(idx)) {
                    setChallengeProgress(player, idx, value);
                }
            }
        }
    }

    override onNpcKill(_playerId: number, _npcTypeId: number, _combatLevel?: number): void {
        // Handled by event bus subscription (npc:death)
    }

    onItemCraft(_playerId: number, _itemId: number, _count: number): void {
        // Handled by event bus subscription (item:craft)
    }

    // === Login / Handshake ===

    override isTutorialActive(player: PlayerState): boolean {
        if (!player?.account) return true;
        if (player.account.preferredMode === "vanilla") {
            return false;
        }
        const tutorialStep = player.varps.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
        return tutorialStep < getTutorialCompleteStep(player);
    }

    isTutorialPreStart(player: PlayerState): boolean {
        const tutorialStep = player.varps.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
        return tutorialStep === LEAGUE_TUTORIAL_STEP_WELCOME;
    }

    override getSpawnLocation(player?: PlayerState): { x: number; y: number; level: number } {
        // Handshake creates the player after this call, so player may be undefined.
        if (!player?.account) {
            return TUTORIAL_SPAWN;
        }
        if (player.account.preferredMode === "vanilla" || !this.isTutorialActive(player)) {
            return LUMBRIDGE_SPAWN;
        }
        return TUTORIAL_SPAWN;
    }

    override onPlayerHandshake(player: PlayerState, bridge: HandshakeBridge): void {
        // Set map_flags_cached to indicate league world (bit 30 set)
        player.varps.setVarpValue(VARP_MAP_FLAGS_CACHED, MAP_FLAGS_LEAGUE_WORLD);
        bridge.sendVarp(VARP_MAP_FLAGS_CACHED, MAP_FLAGS_LEAGUE_WORLD);

        // Set feature_flags_cached (varp 4920) with bit 1 (leagues) so
        // CS2 proc feature_flag(1) returns true. Required by
        // league_combat_mastery_active, league_combat_mastery_passive_active, etc.
        player.varps.setVarpValue(VARP_FEATURE_FLAGS_CACHED, FEATURE_FLAG_LEAGUES);
        bridge.sendVarp(VARP_FEATURE_FLAGS_CACHED, FEATURE_FLAG_LEAGUES);

        // Set league type and packed league general state
        const leagueType = 5;
        player.varps.setVarbitValue(VARBIT_LEAGUE_TYPE, leagueType);
        const { value: leagueGeneral } = syncLeagueGeneralVarp(player);
        bridge.sendVarp(VARP_LEAGUE_GENERAL, leagueGeneral);
        bridge.sendVarbit(VARBIT_LEAGUE_TYPE, leagueType);

        syncLeagueTutorialHandshakeState(player, bridge);

        // Send league points varps from saved state
        bridge.sendVarp(
            VARP_LEAGUE_POINTS_CLAIMED,
            player.varps.getVarpValue(VARP_LEAGUE_POINTS_CLAIMED),
        );
        bridge.sendVarp(
            VARP_LEAGUE_POINTS_COMPLETED,
            player.varps.getVarpValue(VARP_LEAGUE_POINTS_COMPLETED),
        );
        bridge.sendVarp(
            VARP_LEAGUE_POINTS_CURRENCY,
            player.varps.getVarpValue(VARP_LEAGUE_POINTS_CURRENCY),
        );

        // Send packed league varps (relic/mastery varbits)
        for (const [rawVarpId, rawValue] of Object.entries(getLeaguePackedVarpsForPlayer(player))) {
            const varpId = parseInt(rawVarpId, 10);
            bridge.sendVarp(varpId, rawValue);
        }

        // Send varp backing league_total_tasks_completed varbit
        const taskCountVarpValue = player.varps.getVarpValue(VARP_LEAGUE_TASK_COUNT);
        if (taskCountVarpValue !== 0) {
            bridge.sendVarp(VARP_LEAGUE_TASK_COUNT, taskCountVarpValue);
        }

        // Send league task completion bitfield varps
        for (const varpId of LEAGUE_TASK_COMPLETION_VARPS) {
            const value = player.varps.getVarpValue(varpId);
            if (value !== 0) {
                bridge.sendVarp(varpId, value);
            }
        }
    }

    onPostDesignComplete(player: PlayerState): void {
        if (this.isTutorialActive(player)) {
            player.teleport(TUTORIAL_SPAWN.x, TUTORIAL_SPAWN.y, TUTORIAL_SPAWN.level);
        }
    }

    resolveAccountStage(player: PlayerState): void {
        const tutorial = player.varps.getVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED);
        const completeStep = getTutorialCompleteStep(player);
        if (tutorial >= completeStep && player.account.accountStage < 2) {
            player.account.accountStage = 2;
        }
    }

    // === Varp / Widget Events ===

    onVarpTransmit(
        player: PlayerState,
        varpId: number,
        value: number,
        previousValue: number,
    ): void {
        if (varpId !== VARP_SIDE_JOURNAL_STATE) return;

        const previousTab = decodeSideJournalTabFromStateVarp(previousValue);
        const currentTab = decodeSideJournalTabFromStateVarp(value);
        const tabChanged = previousTab !== currentTab;

        if (!tabChanged) return;

        // Complete "Open the Leagues Menu" task when player opens Leagues tab
        if (currentTab === 4) {
            try {
                const result = LeagueTaskService.completeTask(player, 189);
                if (result.changed && this.initBridge) {
                    for (const v of result.varpUpdates) {
                        this.initBridge.queueVarp(player.id, v.id, v.value);
                    }
                    for (const v of result.varbitUpdates) {
                        this.initBridge.queueVarbit(player.id, v.id, v.value);
                    }
                    const notifications =
                        result.notifications ?? (result.notification ? [result.notification] : []);
                    for (const notification of notifications) {
                        this.initBridge.queueNotification(player.id, notification);
                    }
                }
            } catch {}
        }

        // Tutorial progression: opening Leagues tab advances step 3/4 → 5
        const tutorial = player.varps.getVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED);
        if (currentTab === 4 && (tutorial === 3 || tutorial === 4)) {
            if (this.uiBridge) {
                advanceLeagueTutorialToLeaguesPanel(player, this.uiBridge);
            } else {
                player.varps.setVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED, 5);
                this.initBridge?.queueVarbit(player.id, VARBIT_LEAGUE_TUTORIAL_COMPLETED, 5);
                const res = syncLeagueGeneralVarp(player);
                if (res.changed) {
                    this.initBridge?.queueVarp(player.id, VARP_LEAGUE_GENERAL, res.value);
                }
            }
        }
    }

    // === Tick / Widget ===

    onPlayerTick(player: PlayerState, nowMs: number): void {
        this.leagueSummary?.syncPlayer(player, nowMs);
    }

    override onPlayerDisconnect(playerId: number): void {
        super.onPlayerDisconnect(playerId);
        this.leagueSummary?.clearPlayer(playerId);
    }

    onWidgetOpen(player: PlayerState, groupId: number): void {
        if (groupId === LEAGUE_SUMMARY_GROUP_ID) {
            this.leagueSummary?.syncPlayer(player, Date.now(), true);
        }
    }

    override onResumePauseButton(
        player: PlayerState,
        widgetId: number,
        childIndex: number,
    ): boolean {
        if (
            this.uiBridge &&
            handleLeagueTutorialHintResume(
                player,
                {
                    queueWidgetEvent: (playerId, action) =>
                        this.uiBridge?.queueWidgetEvent(playerId, action as any),
                },
                widgetId,
            )
        ) {
            return true;
        }
        return super.onResumePauseButton(player, widgetId, childIndex);
    }

    // === Display ===

    override getPlayerTypes(player: PlayerState, isAdmin: boolean): PlayerType[] {
        const types: PlayerType[] = [];
        if (isAdmin) types.push(PlayerType.JagexModerator);
        if (isLeagueWorld(player)) {
            types.push(PlayerType.LeagueWorld);
        }
        if (types.length === 0) types.push(PlayerType.Normal);
        return types;
    }

    // === Scripts ===

    override getGamemodeServices(): Record<string, unknown> {
        return {
            ...super.getGamemodeServices(),
            completeLeagueTask: (player: PlayerState, taskId: number) =>
                LeagueTaskService.completeTask(player, taskId),
            syncLeagueGeneralVarp: (player: PlayerState) => syncLeagueGeneralVarp(player),
            getLeaguePackedVarpsForPlayer: (player: PlayerState) =>
                getLeaguePackedVarpsForPlayer(player),
            getTaskCompletionVarps: () => LEAGUE_TASK_COMPLETION_VARPS,
        };
    }

    override createUiController(bridge: GamemodeUiBridge): GamemodeUiController {
        this.uiBridge = bridge;
        this.leagueSummary = new LeagueSummaryTracker({
            queueWidgetEvent: (playerId, action) => bridge.queueWidgetEvent(playerId, action),
            isWidgetGroupOpenInLedger: (playerId, groupId) =>
                bridge.isWidgetGroupOpenInLedger(playerId, groupId),
        });
        return new LeaguesVUiController(bridge);
    }

    override registerHandlers(registry: IScriptRegistry, services: ScriptServices): void {
        super.registerHandlers(registry, services);
        registerLeagueTutorHandlers(registry, services);
        registerLeagueWidgetHandlers(registry, services);
        registerLeagueTutorialWidgetHandlers(registry, services);
    }

    // === Content Data ===

    getContentDataPacket(): Uint8Array | null {
        return this.contentProvider.getPacket();
    }

    // === Server Lifecycle ===

    override initialize(context: GamemodeInitContext): void {
        super.initialize(context);
        this.initBridge = context.bridge;
        this.contentProvider.build();
        try {
            this.taskManager = LeagueTaskManager.create(
                context.npcTypeLoader,
                context.objTypeLoader,
                {
                    getPlayer: (playerId) => {
                        const p = context.bridge.getPlayer(playerId);
                        if (!p) return undefined;
                        return Object.assign(p, {
                            getChallengeProgress: (idx: number) => getChallengeProgress(p, idx),
                            setChallengeProgress: (idx: number, val: number) =>
                                setChallengeProgress(p, idx, val),
                            // Skill state for level-reach tasks ("Achieve Your First Level 5",
                            // "Reach Total Level 500", "Reach Combat Level 50", ...).
                            getSkillLevels: () =>
                                SKILL_IDS.map((id) => p.skillSystem.getSkill(id).baseLevel),
                            getTotalLevel: () => p.skillSystem.skillTotal,
                            getCombatLevel: () => p.skillSystem.combatLevel,
                        });
                    },
                    queueVarp: (playerId, varpId, value) =>
                        context.bridge.queueVarp(playerId, varpId, value),
                    queueVarbit: (playerId, varbitId, value) =>
                        context.bridge.queueVarbit(playerId, varbitId, value),
                    queueNotification: (playerId, notification) =>
                        context.bridge.queueNotification(playerId, notification),
                },
            );
        } catch (err) {
            console.log("[leagues-v] failed to initialize task manager", err);
        }

        const eventBus = context.serverServices.eventBus;

        this.eventSubscriptions.push(
            eventBus.on("npc:death", (e) => {
                if (e.killerPlayerId != null) {
                    this.taskManager?.onNpcKill(e.killerPlayerId, e.npcTypeId, e.combatLevel);
                }
            }),
        );

        this.eventSubscriptions.push(
            eventBus.on("equipment:equip", (e) => {
                this.taskManager?.onItemEquip(e.player.id, e.itemId);
            }),
        );

        this.eventSubscriptions.push(
            eventBus.on("item:craft", (e) => {
                this.taskManager?.onItemCraft(e.playerId, e.itemId, e.count);
            }),
        );

        // Level milestones ("Achieve Your First Level 5", "Reach Total Level 500", ...).
        // These tasks are stateful, so the manager re-reads the player's skills.
        this.eventSubscriptions.push(
            eventBus.on("skill:levelUp", (e) => {
                this.taskManager?.onSkillLevelUp(e.player.id, e.skillId, e.newLevel);
            }),
        );

        // Catch up on level tasks already satisfied when the player logs in, so
        // milestones reached before this tracking existed still register.
        this.eventSubscriptions.push(
            eventBus.on("player:login", (e) => {
                this.taskManager?.recheckLevelReachTasks(e.player.id, "login");
            }),
        );
    }

    override dispose(): void {
        for (const sub of this.eventSubscriptions) {
            sub.unsubscribe();
        }
        this.eventSubscriptions = [];
        this.taskManager = undefined;
        this.initBridge = undefined;
        super.dispose();
    }
}

export function createGamemode(): LeaguesVGamemode {
    return new LeaguesVGamemode();
}
