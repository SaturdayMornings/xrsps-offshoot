/**
 * Message handler registration.
 * The only remaining function — all service factory functions have been
 * migrated to use ServerServices directly.
 */
import { EquipmentSlot } from "../../../client/rs/config/player/Equipment";
import {
    SIDE_JOURNAL_CONTENT_GROUP_BY_TAB,
    SIDE_JOURNAL_TAB_CONTAINER_UID,
} from "../../../client/common/ui/sideJournal";
import {
    VARBIT_SIDE_JOURNAL_TAB,
    VARP_ATTACK_STYLE,
    VARP_AUTO_RETALIATE,
    VARP_MAP_FLAGS_CACHED,
    VARP_OPTION_RUN,
    VARP_SIDE_JOURNAL_STATE,
    VARP_SPECIAL_ATTACK,
} from "../../../client/common/vars";
import type { ServerServices } from "../game/ServerServices";
import { interruptForPlayerInput } from "../game/actions/playerInputInterrupt";
import type { NpcSpawnConfig } from "../game/npc";
import type { PlayerState } from "../game/player";
import { logger } from "../utils/logger";
import type { WidgetAction } from "../widgets/WidgetManager";
import type { MessageRouter } from "./MessageRouter";
import { type BinaryHandlerExtServices, registerAllHandlers } from "./handlers";
import {
    resolveGroundItemOptionByOpNum,
    resolveLocActionByOpNum,
    resolveNpcOptionByOpNum,
} from "./handlers/examineHandler";
import { encodeMessage } from "./messages";

export function registerMessageHandlers(svc: ServerServices, router: MessageRouter): void {
    // Register extracted handlers from MessageHandlers.ts
    const extendedServices: BinaryHandlerExtServices = {
        // Player management
        getPlayer: (ws) => svc.players?.get(ws),
        getPlayerById: (id) => svc.players?.getById(id),
        getConnectedPlayerByName: (name) => svc.players?.getConnectedPlayerByName(name),
        startFollowing: (ws, targetId, mode, modifierFlags) =>
            svc.players?.startFollowing(ws, targetId, mode, modifierFlags),
        startLocInteract: (ws, opts, currentTick) =>
            svc.players?.startLocInteract?.(ws, opts, currentTick),
        clearAllInteractions: (ws) => svc.players?.clearAllInteractions(ws),
        startPlayerCombat: (ws, targetId) => svc.players?.startPlayerCombat(ws, targetId),

        // Trade
        handleTradeAction: (player, payload, tick) => {
            svc.tradeManager?.handleAction(player, payload, tick);
        },
        handleTradeWidgetClose: (player, groupId) =>
            svc.tradeManager?.handleWidgetClosed(player, groupId) ?? false,

        // Movement
        setPendingWalkCommand: (ws, command) =>
            svc.movementService.getPendingWalkCommands().set(ws, command),
        clearPendingWalkCommand: (ws) => svc.movementService.getPendingWalkCommands().delete(ws),
        clearActionsInGroup: (playerId, group) =>
            svc.actionScheduler.clearActionsInGroup(playerId, group),
        interruptPlayerInput: (player) => interruptForPlayerInput(player, svc.actionScheduler),
        canUseAdminTeleport: (player) => svc.authService.isAdminPlayer(player),
        getPlayerPermission: (player) => svc.authService.getPlayerPermission(player),
        teleportPlayer: (player, x, y, level, forceRebuild = false) =>
            svc.movementService.teleportPlayer(player, x, y, level, forceRebuild),
        teleportToInstance: (player, x, y, level, templateChunks, extraLocs) =>
            svc.movementService.teleportToInstance(player, x, y, level, templateChunks, extraLocs),
        teleportToWorldEntity: (
            player,
            x,
            y,
            level,
            entityIndex,
            configId,
            sizeX,
            sizeZ,
            templateChunks,
            buildAreas,
            extraLocs,
        ) =>
            svc.worldEntityService.teleportToWorldEntity(
                player,
                x,
                y,
                level,
                entityIndex,
                configId,
                sizeX,
                sizeZ,
                templateChunks,
                buildAreas,
                extraLocs,
            ),
        sendWorldEntity: (
            player,
            entityIndex,
            configId,
            sizeX,
            sizeZ,
            templateChunks,
            buildAreas,
            extraLocs,
            extraNpcs,
            drawMode,
        ) =>
            svc.worldEntityService.sendWorldEntity(
                player,
                entityIndex,
                configId,
                sizeX,
                sizeZ,
                templateChunks,
                buildAreas,
                extraLocs,
                extraNpcs,
                drawMode,
            ),
        spawnLocForPlayer: (player, locId, tile, level, shape, rotation) =>
            svc.locationService.spawnLocForPlayer(player, locId, tile, level, shape, rotation),
        spawnNpc: (config: NpcSpawnConfig) => svc.npcManager?.spawnTransientNpc(config),
        initSailingInstance: (player) => svc.sailingInstanceManager?.initInstance(player),
        disposeSailingInstance: (player) => svc.sailingInstanceManager?.disposeInstance(player),
        removeWorldEntity: (playerId, entityIndex) =>
            svc.worldEntityInfoEncoder.removeEntity(playerId, entityIndex),
        queueWorldEntityPosition: (playerId, entityIndex, position) =>
            svc.worldEntityInfoEncoder.queuePosition(playerId, entityIndex, position),
        setWorldEntityPosition: (playerId, entityIndex, position) =>
            svc.worldEntityInfoEncoder.setPosition(playerId, entityIndex, position),
        queueWorldEntityMask: (playerId, entityIndex, mask) =>
            svc.worldEntityInfoEncoder.queueMaskUpdate(playerId, entityIndex, mask),
        buildSailingDockedCollision: () => svc.sailingInstanceManager?.buildDockedCollision(),
        applySailingDeckCollision: () => svc.sailingInstanceManager?.buildDockedCollision(),
        clearSailingDeckCollision: () => svc.sailingInstanceManager?.clearDockedCollision(),
        requestTeleportAction: (player, request) =>
            svc.movementService.requestTeleportAction(player, request),

        // Combat/NPC
        getNpcById: (npcId) => svc.npcManager?.getById(npcId),
        startNpcAttack: (ws, npc, tick, attackSpeed, modifierFlags) =>
            svc.players!.startNpcAttack(ws, npc, tick, attackSpeed, modifierFlags),
        startNpcInteraction: (ws, npc, option, modifierFlags) => {
            const result = svc.players?.startNpcInteraction(ws, npc, option, modifierFlags);
            const player = svc.players?.get(ws);
            if (result?.ok && player && npc) {
                // Leagues "Talk to X" / "Pet X" style tasks. Attacks are routed
                // through startNpcAttack above, so this only sees other options.
                svc.eventBus.emit("npc:interact", {
                    player,
                    npcTypeId: npc.typeId,
                    option: String(option ?? "")
                        .trim()
                        .toLowerCase(),
                });
            }
            return result;
        },
        pickAttackSpeed: (player) => svc.playerCombatService!.pickAttackSpeed(player),
        hasNpcOption: (npc, option) => svc.npcManager?.hasNpcOption(npc, option) ?? false,
        resolveNpcOption: (npc, opNum) =>
            resolveNpcOptionByOpNum((n) => svc.npcTypeLoader?.load(n?.typeId ?? n), npc, opNum),
        resolveLocAction: (player, locId, opNum) =>
            resolveLocActionByOpNum(svc.locTypeLoader, locId, opNum, player),
        routePlayer: (ws, to, run, tick) => svc.players?.routePlayer(ws, to, run, tick),
        findPath: (opts) =>
            svc.pathService?.findPath(opts) ?? {
                ok: false,
                message: "path service unavailable",
            },
        edgeHasWallBetween: (x1, y1, x2, y2, level) =>
            svc.pathService?.edgeHasWallBetween(x1, y1, x2, y2, level) ?? false,

        // Spells
        handleSpellCast: (ws, player, payload, targetType, tick) => {
            if (
                targetType !== "npc" &&
                targetType !== "player" &&
                targetType !== "loc" &&
                targetType !== "obj"
            ) {
                return;
            }
            svc.spellActionHandler!.handleSpellCastMessage(ws, player, payload, targetType, tick);
        },
        handleSpellCastOnItem: (ws, payload) =>
            svc.spellCastingService!.handleSpellCastOnItem(ws, payload),

        // Widget/Interface
        handleIfButtonD: () => {},
        handleWidgetAction: (player, payload) => {},
        handleWidgetCloseState: (player, groupId) => {
            svc.cs2ModalManager!.handleWidgetCloseState(player, groupId);
            svc.widgetDialogHandler!.handleWidgetCloseState(player, groupId);
        },
        openModal: (player, interfaceId, data) =>
            svc.interfaceService?.openModal(player, interfaceId, data),
        openIndexedMenu: (player, request) => svc.cs2ModalManager!.openIndexedMenu(player, request),
        openSubInterface: (player, targetUid, groupId, type = 0, opts) => {
            if (type === 0 || type === 1) {
                const modal = opts?.modal ?? type === 0;
                if (modal) {
                    svc.interfaceService?.closeModalInterfaces(player, {
                        exceptGroupId: groupId,
                    });
                }
                player.widgets.open(groupId, {
                    targetUid,
                    type,
                    modal,
                    varps: opts?.varps,
                    varbits: opts?.varbits,
                    hiddenUids: opts?.hiddenUids,
                    preScripts: opts?.preScripts,
                    postScripts: opts?.postScripts,
                });
                return;
            }
            svc.queueWidgetEvent(player.id, {
                action: "open_sub",
                targetUid,
                groupId,
                type,
                varps: opts?.varps,
                varbits: opts?.varbits,
                hiddenUids: opts?.hiddenUids,
                preScripts: opts?.preScripts,
                postScripts: opts?.postScripts,
            });
        },
        openDialog: (player, request) =>
            svc.widgetDialogHandler!.openDialog(
                player,
                request as import("../game/actions/handlers/WidgetDialogHandler").ScriptDialogRequest,
            ),
        queueWidgetEvent: (playerId, event) =>
            svc.queueWidgetEvent(playerId, event as WidgetAction),
        queueClientScript: (playerId, scriptId, ...args) =>
            svc.broadcastService.queueClientScript(playerId, scriptId, ...args),
        queueVarp: (playerId, varpId, value) =>
            svc.variableService.queueVarp(playerId, varpId, value),
        queueVarbit: (playerId, varbitId, value) =>
            svc.variableService.queueVarbit(playerId, varbitId, value),
        queueNotification: (playerId, notification) =>
            svc.messagingService.queueNotification(playerId, notification),
        sendGameMessage: (player, text) => {
            svc.messagingService.queueChatMessage({
                messageType: "game",
                text,
                targetPlayerIds: [player.id],
            });
        },
        sendSound: (player, soundId, opts) => svc.soundService.sendSound(player, soundId, opts),
        sendVarp: (player, varpId, value) =>
            svc.variableService.queueVarp(player.id, varpId, value),
        sendVarbit: (player, varbitId, value) =>
            svc.variableService.queueVarbit(player.id, varbitId, value),
        trackCollectionLogItem: (player, itemId) =>
            svc.collectionLogService.trackCollectionLogItem(player, itemId),
        sendRunEnergyState: (ws, player) => svc.movementService.sendRunEnergyState(ws, player),
        getWeaponSpecialCostPercent: (weaponId) =>
            svc.combatDataService.getWeaponSpecialCostPercent(weaponId),
        queueCombatState: (player) => svc.queueCombatState(player),
        ensureEquipArray: (player) => svc.equipmentService.ensureEquipArray(player),
        gamemodeServices: svc.gamemode.getGamemodeServices?.() ?? {},
        getGamemodeServices: () => svc.gamemode.getGamemodeServices?.() ?? {},

        // Chat
        handleFriendsChatAction: (player, action) =>
            svc.friendsChatService.handleAction(player, action),
        handleFriendsChatWidgetAction: (player, groupId, componentId, option, opId) =>
            svc.friendsChatService.handleWidgetAction(
                player,
                groupId,
                componentId,
                option,
                opId,
            ),
        handleFriendsChatNameInput: (player, value, allowJoinFallback) =>
            svc.friendsChatService.handleNameInput(player, value, allowJoinFallback),
        handleFriendsChatMessage: (player, text) =>
            svc.friendsChatService.handleChat(player, text),
        queueChatMessage: (msg) => svc.messagingService.queueChatMessage(msg),
        getPublicChatPlayerType: (player) => svc.authService.getPublicChatPlayerType(player),
        eventBus: svc.eventBus,
        findScriptCommand: (name) =>
            svc.scriptRegistry.findCommand(name) as
                | ((event: {
                      player: PlayerState;
                      command: string;
                      args: string[];
                      tick: number;
                      services: Record<string, unknown>;
                  }) => string | void | Promise<string | void>)
                | undefined,
        getCurrentTick: () => svc.ticker.currentTick(),
        getTickerStats: () => svc.ticker.stats(),

        // Debug
        broadcast: (message, context) => svc.broadcastService.broadcast(message, context),
        sendWithGuard: (ws, message, context) =>
            svc.networkLayer.sendWithGuard(ws, message, context),
        sendAdminResponse: (ws, message, context) =>
            svc.networkLayer.sendAdminResponse(ws, message, context),
        withDirectSendBypass: (context, fn) => svc.networkLayer.withDirectSendBypass(context, fn),
        encodeMessage: encodeMessage,
        setPendingDebugRequest: (requestId, ws) => svc.pendingDebugRequests!.set(requestId, ws),
        getPendingDebugRequest: (requestId) => svc.pendingDebugRequests!.get(requestId),

        // Tick
        currentTick: () => svc.ticker.currentTick(),

        // Constants/Config
        getEquipmentSlotWeapon: () => EquipmentSlot.WEAPON,
        getVarpConstants: () => ({
            VARP_SIDE_JOURNAL_STATE,
            VARP_OPTION_RUN,
            VARP_SPECIAL_ATTACK,
            VARP_ATTACK_STYLE,
            VARP_AUTO_RETALIATE,
            VARP_MAP_FLAGS_CACHED,
        }),
        getVarbitConstants: () => ({
            VARBIT_SIDE_JOURNAL_TAB,
        }),
        getSideJournalConstants: () => ({
            SIDE_JOURNAL_CONTENT_GROUP_BY_TAB: Object.values(SIDE_JOURNAL_CONTENT_GROUP_BY_TAB),
            SIDE_JOURNAL_TAB_CONTAINER_UID,
        }),

        // --- Services for extracted handlers (logout, widget, varp_transmit, if_close) ---
        completeLogout: (ws, player, source) =>
            svc.loginHandshakeService.completeLogout(ws, player, source),
        closeInterruptibleInterfaces: (player) =>
            svc.interfaceManager.closeInterruptibleInterfaces(player),
        noteWidgetEventForLedger: (playerId, event) =>
            svc.interfaceManager.noteWidgetEventForLedger(playerId, event),
        normalizeSideJournalState: (player, value?) =>
            svc.gamemodeUi.normalizeSideJournalState(player, value),
        queueSideJournalGamemodeUi: (player) => svc.gamemodeUi.applySideJournalUi(player),
        syncMusicInterface: (player) => svc.soundManager!.syncMusicInterfaceForPlayer(player),
        handleMusicModeChange: (player, previousMode, nextMode) =>
            svc.soundManager!.handleMusicModeChange(player, previousMode, nextMode),
        handleMusicVolumeChange: (player, previousVolume, nextVolume) =>
            svc.soundManager!.handleMusicVolumeChange(player, previousVolume, nextVolume),
        getWidgetOpenHandler: (groupId) =>
            svc.scriptRuntime.getServices().widgetOpenHandlers?.get(groupId),
        handleCs2ModalCloseState: (player, groupId) =>
            svc.cs2ModalManager!.handleWidgetCloseState(player, groupId),
        handleDialogCloseState: (player, groupId) =>
            svc.widgetDialogHandler!.handleWidgetCloseState(player, groupId),
        getInterfaceService: () => svc.interfaceService,
        getGamemodeUi: () => svc.gamemodeUi,
        getGamemode: () => svc.gamemode,

        // --- Services for binary message handlers ---
        resolveGroundItemOptionByOpNum: (itemId, opNum) =>
            resolveGroundItemOptionByOpNum((id) => svc.objTypeLoader?.load(id), itemId, opNum),
        handleGroundItemAction: (ws, payload) =>
            svc.inventoryMessageService!.handleGroundItemAction(ws, payload),
        getScriptRegistry: () => svc.scriptRegistry,
        getScriptRuntime: () => svc.scriptRuntime,
        getCs2ModalManager: () => svc.cs2ModalManager!,
        getWidgetDialogHandler: () => svc.widgetDialogHandler!,
        getObjType: (itemId) => svc.dataLoaderService.getObjType(itemId),
        handleInventoryUseOnMessage: (ws, payload) =>
            svc.inventoryMessageService!.handleInventoryUseOnMessage(ws, payload as any),
    };
    registerAllHandlers(router, extendedServices);

    // Simple handlers
    router.register("hello", (ctx) => {
        logger.info(`Hello from ${ctx.payload.client} ${ctx.payload.version ?? ""}`.trim());
    });

    router.register("inventory_use", (ctx) => {
        svc.inventoryMessageService!.handleInventoryUseMessage(ctx.ws, ctx.payload);
    });

    // inventory_use_on and ground_item_action are registered by binaryMessageHandlers

    router.register("inventory_move", (ctx) => {
        svc.inventoryMessageService!.handleInventoryMoveMessage(ctx.ws, ctx.payload);
    });

    router.register("interact_stop", (ctx) => {
        try {
            // RSMod parity: Use player.resetInteractions() to clear all interactions
            if (ctx.player) {
                ctx.player.resetInteractions();
            }
            // Also clear the interaction system's internal state map
            svc.players?.clearAllInteractions(ctx.ws);
        } catch (err) {
            logger.warn("Failed to handle interact_stop message", err);
        }
    });

    // More handlers will be added incrementally...
}
