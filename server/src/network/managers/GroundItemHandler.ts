/**
 * GroundItemHandler - Handles ground item operations.
 *
 * Extracted from wsServer.ts for better organization and testability.
 * Uses a service interface pattern to avoid circular dependencies.
 */
import type { WebSocket } from "ws";

import { ObjStackability } from "../../../../client/rs/config/objtype/ObjStackability";
import { getItemDefinition } from "../../data/items";
import type { ServerServices } from "../../game/ServerServices";
import { isInWilderness } from "../../game/combat/MultiCombatZones";
import type { GroundItemInteractionState } from "../../game/interactions/types";
import type { GroundItemStack } from "../../game/items/GroundItemManager";
import type { PlayerState } from "../../game/player";
import type { ScriptGroundItem } from "../../game/scripts/types";
import { logger } from "../../utils/logger";
import { encodeMessage } from "../messages";

/** Pickup radius in tiles */
const GROUND_ITEM_PICKUP_RADIUS_TILES = 2;
const GROUND_ITEM_PICKUP_FLOOR_SEQ = 827;
const GROUND_ITEM_PICKUP_TABLE_SEQ = 832;

/** Stream radius for ground items */
const GROUND_ITEM_STREAM_RADIUS_TILES = 20;
const TILE_ITEM_OWNERSHIP_NONE = 0;
const TILE_ITEM_OWNERSHIP_SELF = 1;
const TILE_ITEM_OWNERSHIP_OTHER = 2;

/** Ground item action payload from client */
export interface GroundItemActionPayload {
    option?: string;
    opNum?: number;
    itemId?: number;
    stackId?: number;
    modifierFlags?: number;
    tile?: { x?: number; y?: number; level?: number };
}

/** Ground items server payload */
type GroundItemStackPayload = {
    id: number;
    itemId: number;
    quantity: number;
    tile: { x: number; y: number; level: number };
    createdTick?: number;
    privateUntilTick?: number;
    expiresTick?: number;
    ownerId?: number;
    isPrivate?: boolean;
    ownership?: 0 | 1 | 2 | 3;
};

export type GroundItemsServerPayload =
    | {
          kind: "snapshot";
          serial: number;
          stacks: GroundItemStackPayload[];
      }
    | {
          kind: "delta";
          serial: number;
          upserts: GroundItemStackPayload[];
          removes: number[];
      };

/**
 * Handler for ground item operations.
 */
export class GroundItemHandler {
    private readonly lastVisibleStacksByPlayer = new Map<
        number,
        Map<number, GroundItemStackPayload>
    >();

    constructor(private readonly svc: ServerServices) {}

    static getGroundChunkKey(player: PlayerState): number {
        const mapX = player.tileX >> 6;
        const mapY = player.tileY >> 6;
        return (mapX << 16) | (mapY & 0xffff);
    }

    private static getGroundStreamKey(player: PlayerState): number {
        const chunkKey = GroundItemHandler.getGroundChunkKey(player) >>> 0;
        const worldViewId = (player.worldViewId ?? 0) & 0xffff;
        const level = player.level & 0x3;
        return (worldViewId * 4 + level) * 0x100000000 + chunkKey;
    }

    clearPlayerState(playerIdRaw: number): void {
        const playerId = playerIdRaw;
        if (playerId < 0) return;
        this.lastVisibleStacksByPlayer.delete(playerId);
        this.svc.playerGroundSerial.delete(playerId);
        this.svc.playerGroundChunk.delete(playerId);
    }

    private toPayloadStack(
        stack: {
            id: number;
            itemId: number;
            quantity: number;
            tile: { x: number; y: number; level: number };
            createdTick?: number;
            privateUntilTick?: number;
            expiresTick?: number;
            ownerId?: number;
        },
        currentTick: number,
        playerId: number,
    ): GroundItemStackPayload {
        return {
            id: stack.id,
            itemId: stack.itemId,
            quantity: Math.max(1, stack.quantity),
            tile: {
                x: stack.tile.x,
                y: stack.tile.y,
                level: stack.tile.level,
            },
            createdTick: Number.isFinite(stack.createdTick) ? (stack.createdTick as number) : 0,
            privateUntilTick:
                stack.privateUntilTick && stack.privateUntilTick > 0
                    ? stack.privateUntilTick
                    : undefined,
            expiresTick: stack.expiresTick && stack.expiresTick > 0 ? stack.expiresTick : undefined,
            ownerId:
                stack.ownerId !== undefined && Number.isFinite(stack.ownerId)
                    ? (stack.ownerId as number)
                    : undefined,
            isPrivate:
                !!stack.privateUntilTick &&
                stack.privateUntilTick > currentTick &&
                stack.ownerId !== undefined &&
                stack.ownerId === playerId,
            ownership:
                stack.ownerId === undefined
                    ? TILE_ITEM_OWNERSHIP_NONE
                    : stack.ownerId === playerId
                      ? TILE_ITEM_OWNERSHIP_SELF
                      : TILE_ITEM_OWNERSHIP_OTHER,
        };
    }

    private stackEquals(a: GroundItemStackPayload, b: GroundItemStackPayload): boolean {
        return (
            a.id === b.id &&
            a.itemId === b.itemId &&
            a.quantity === b.quantity &&
            a.tile.x === b.tile.x &&
            a.tile.y === b.tile.y &&
            a.tile.level === b.tile.level &&
            (a.createdTick ?? -1) === (b.createdTick ?? -1) &&
            (a.privateUntilTick ?? 0) === (b.privateUntilTick ?? 0) &&
            (a.expiresTick ?? 0) === (b.expiresTick ?? 0) &&
            (a.ownerId ?? -1) === (b.ownerId ?? -1) &&
            (a.isPrivate === true) === (b.isPrivate === true) &&
            (a.ownership ?? 0) === (b.ownership ?? 0)
        );
    }

    private getInventoryInsertCapacity(player: PlayerState, itemId: number): number {
        const inventory = player.getInventoryEntries();
        const objType = this.svc.dataLoaderService.getObjType(itemId);
        const stackable = objType
            ? objType.stackability === ObjStackability.ALWAYS || objType.noteTemplate !== -1
            : getItemDefinition(itemId)?.stackable === true;

        if (stackable) {
            for (const entry of inventory) {
                const entryItemId = entry.itemId;
                const quantity = entry.quantity;
                if (entryItemId === itemId && quantity > 0) {
                    if (!Number.isFinite(quantity)) return 0;
                    return Math.max(0, Number.MAX_SAFE_INTEGER - Math.max(0, quantity));
                }
            }
            const hasEmptySlot = inventory.some(
                (entry) => entry.itemId <= 0 || entry.quantity <= 0,
            );
            return hasEmptySlot ? Number.MAX_SAFE_INTEGER : 0;
        }

        let freeSlots = 0;
        for (const entry of inventory) {
            if (entry.itemId <= 0 || entry.quantity <= 0) {
                freeSlots++;
            }
        }
        return freeSlots;
    }

    private isTablePickupTile(tile: { x: number; y: number; level: number }): boolean {
        return this.svc.mapService?.hasItemLayerSupportAt(tile.x, tile.y, tile.level) === true;
    }

    private getPickupSequence(tile: { x: number; y: number; level: number }): number {
        return this.isTablePickupTile(tile)
            ? GROUND_ITEM_PICKUP_TABLE_SEQ
            : GROUND_ITEM_PICKUP_FLOOR_SEQ;
    }

    /**
     * Maybe send ground item snapshot to player if changed.
     */
    maybeSendGroundItemSnapshot(ws: WebSocket, player: PlayerState): void {
        if (!ws || ws.readyState !== 1) return; // WebSocket.OPEN = 1

        const playerId = player.id;
        const groundItems = this.svc.groundItems;
        const currentSerial = groundItems.getSerial();
        const currentTick = this.svc.ticker.currentTick();
        const playerGroundSerial = this.svc.playerGroundSerial;
        const playerGroundChunk = this.svc.playerGroundChunk;

        const lastSerial = playerGroundSerial.get(playerId);
        const streamKey = GroundItemHandler.getGroundStreamKey(player);
        const lastChunk = playerGroundChunk.get(playerId);

        if (lastSerial === currentSerial && lastChunk === streamKey) return;

        const stacks = groundItems
            .queryArea(
                player.tileX,
                player.tileY,
                player.level,
                GROUND_ITEM_STREAM_RADIUS_TILES,
                currentTick,
                player.id,
                player.worldViewId,
            )
            .map((stack) => this.toPayloadStack(stack, currentTick, playerId));

        const currentById = new Map<number, GroundItemStackPayload>();
        for (const stack of stacks) {
            currentById.set(stack.id, stack);
        }

        const previousById = this.lastVisibleStacksByPlayer.get(playerId);
        const shouldSendSnapshot =
            lastSerial === undefined || lastChunk !== streamKey || previousById === undefined;

        if (shouldSendSnapshot) {
            const payload: GroundItemsServerPayload = {
                kind: "snapshot",
                serial: currentSerial,
                stacks,
            };
            this.svc.networkLayer.sendWithGuard(
                ws,
                encodeMessage({ type: "ground_items", payload }),
                "ground_items",
            );
        } else {
            const upserts: GroundItemStackPayload[] = [];
            const removes: number[] = [];

            for (const [stackId, stack] of currentById.entries()) {
                const prev = previousById.get(stackId);
                if (!prev || !this.stackEquals(prev, stack)) {
                    upserts.push(stack);
                }
            }
            for (const stackId of previousById.keys()) {
                if (!currentById.has(stackId)) {
                    removes.push(stackId);
                }
            }

            if (upserts.length > 0 || removes.length > 0) {
                const payload: GroundItemsServerPayload = {
                    kind: "delta",
                    serial: currentSerial,
                    upserts,
                    removes,
                };
                this.svc.networkLayer.sendWithGuard(
                    ws,
                    encodeMessage({ type: "ground_items", payload }),
                    "ground_items",
                );
            }
        }

        playerGroundSerial.set(playerId, currentSerial);
        playerGroundChunk.set(playerId, streamKey);
        this.lastVisibleStacksByPlayer.set(playerId, currentById);
    }

    /**
     * Handle ground item action from client.
     */
    handleGroundItemAction(ws: WebSocket, payload: GroundItemActionPayload | undefined): void {
        if (!payload) return;

        const players = this.svc.players!;
        const player = players.get(ws);
        if (!player) return;

        const itemId = payload.itemId ?? -1;
        if (!(itemId > 0)) return;
        const tileX = payload.tile?.x;
        const tileY = payload.tile?.y;
        if (tileX === undefined || tileY === undefined) return;

        const tile = {
            x: tileX,
            y: tileY,
            level:
                payload.tile?.level !== undefined
                    ? Math.max(0, Math.min(3, payload.tile.level))
                    : player.level,
        };

        const opNum = payload.opNum ?? -1;
        const itemDef =
            (this.svc.dataLoaderService.getObjType(itemId) as any) ?? getItemDefinition(itemId);
        let option = payload.option?.trim().toLowerCase() ?? "";
        if (!option && opNum > 0) {
            const idx = opNum - 1;
            const raw =
                idx >= 0 && idx <= 4 && Array.isArray(itemDef?.groundActions)
                    ? itemDef.groundActions[idx]
                    : undefined;
            const normalizedRaw = raw?.trim();
            if (normalizedRaw) {
                option = normalizedRaw.toLowerCase();
            } else if (opNum === 3) {
                // OSRS default fallback: slot 3 is "Take" when no explicit action exists.
                option = "take";
            }
        }
        if (!option) option = "take";

        if (option === "examine") {
            if (itemDef?.examine) {
                this.svc.messagingService.queueChatMessage({
                    messageType: "game",
                    text: itemDef.examine,
                    targetPlayerIds: [player.id],
                });
            }
            return;
        }

        let stackId = payload.stackId ?? -1;
        if (!(stackId > 0)) {
            const visibleStacks = this.svc.groundItems.queryArea(
                tile.x,
                tile.y,
                tile.level,
                0,
                this.svc.ticker.currentTick(),
                player.id,
                player.worldViewId,
            );
            const matchingStack = visibleStacks.find((stack) => stack.itemId === itemId);
            if (matchingStack) {
                stackId = matchingStack.id;
            }
        }
        if (!(stackId > 0)) return;

        players.startGroundItemInteraction(ws, {
            itemId,
            stackId,
            tileX: tile.x,
            tileY: tile.y,
            tileLevel: tile.level,
            option,
            opNum: opNum > 0 ? opNum : undefined,
            modifierFlags: payload.modifierFlags,
            pickupFromTable: this.isTablePickupTile(tile),
        });
    }

    startItemOnGroundInteraction(
        player: PlayerState,
        data: {
            source: { slot: number; itemId: number };
            targetItemId: number;
            tile: { x: number; y: number; level: number };
            option?: string;
            modifierFlags?: number;
        },
    ): boolean {
        const option = data.option?.trim().toLowerCase();
        if (
            !this.svc.scriptRegistry.findItemOnGround(
                data.source.itemId,
                data.targetItemId,
                option,
            )
        ) {
            return false;
        }

        const stack = this.svc.groundItems
            .queryArea(
                data.tile.x,
                data.tile.y,
                data.tile.level,
                0,
                this.svc.ticker.currentTick(),
                player.id,
                player.worldViewId,
            )
            .find((entry) => entry.itemId === data.targetItemId);
        if (!stack) return false;

        const players = this.svc.players;
        if (!players) return false;
        const ws = players.getSocketByPlayerId(player.id);
        if (!ws) return false;
        players.startGroundItemInteraction(ws, {
            itemId: stack.itemId,
            stackId: stack.id,
            tileX: stack.tile.x,
            tileY: stack.tile.y,
            tileLevel: stack.tile.level,
            option: option ?? "",
            source: data.source,
            modifierFlags: data.modifierFlags,
            pickupFromTable: this.isTablePickupTile(stack.tile),
        });
        return true;
    }

    handleArrivedGroundItemInteraction(
        player: PlayerState,
        interaction: GroundItemInteractionState,
    ): void {
        const target = this.findValidatedInteractionStack(player, interaction);
        if (!target) {
            this.sendNothingInteresting(player);
            return;
        }

        const scriptTarget = this.toScriptGroundItem(target);
        const tick = this.svc.ticker.currentTick();
        if (interaction.source) {
            const inventoryEntry = this.svc.inventoryService.getInventory(player)[
                interaction.source.slot
            ];
            if (
                !inventoryEntry ||
                inventoryEntry.itemId !== interaction.source.itemId ||
                inventoryEntry.quantity <= 0
            ) {
                return;
            }
            const handled = this.svc.scriptRuntime.queueItemOnGround({
                tick,
                player,
                source: interaction.source,
                target: scriptTarget,
                option: interaction.option || undefined,
            });
            if (!handled) this.sendNothingInteresting(player);
            return;
        }

        const handled = this.svc.scriptRuntime.queueGroundItemInteraction({
            tick,
            player,
            target: scriptTarget,
            option: interaction.option,
            opNum: interaction.opNum,
        });
        if (!handled && this.isTakeOption(interaction.option)) {
            this.attemptTakeGroundItem(
                player,
                target.tile,
                target.itemId,
                target.id,
            );
        }
    }

    private findValidatedInteractionStack(
        player: PlayerState,
        interaction: GroundItemInteractionState,
    ): GroundItemStack | undefined {
        if (player.level !== interaction.tileLevel) return undefined;
        const distance = Math.max(
            Math.abs(player.tileX - interaction.tileX),
            Math.abs(player.tileY - interaction.tileY),
        );
        if (interaction.pickupFromTable ? distance > 1 : distance !== 0) return undefined;

        return this.svc.groundItems
            .queryArea(
                interaction.tileX,
                interaction.tileY,
                interaction.tileLevel,
                0,
                this.svc.ticker.currentTick(),
                player.id,
                player.worldViewId,
            )
            .find(
                (stack) =>
                    stack.id === interaction.stackId && stack.itemId === interaction.itemId,
            );
    }

    private toScriptGroundItem(stack: GroundItemStack): ScriptGroundItem {
        return {
            stackId: stack.id,
            itemId: stack.itemId,
            quantity: stack.quantity,
            tile: { ...stack.tile },
            worldViewId: stack.worldViewId,
            ownerId: stack.ownerId,
        };
    }

    private isTakeOption(option: string): boolean {
        return option === "take" || option === "pick-up" || option === "pickup";
    }

    private sendNothingInteresting(player: PlayerState): void {
        this.svc.messagingService.queueChatMessage({
            messageType: "game",
            text: "There is nothing interesting there.",
            targetPlayerIds: [player.id],
        });
    }

    /**
     * Attempt to take a ground item.
     */
    attemptTakeGroundItem(
        player: PlayerState,
        tile: { x: number; y: number; level: number },
        itemId: number,
        stackId: number,
        requestedQuantity?: number,
    ): void {
        if (player.level !== tile.level) {
            this.svc.messagingService.queueChatMessage({
                messageType: "game",
                text: "You can't reach that.",
                targetPlayerIds: [player.id],
            });
            return;
        }

        const dx = Math.abs(player.tileX - tile.x);
        const dy = Math.abs(player.tileY - tile.y);

        if (Math.max(dx, dy) > GROUND_ITEM_PICKUP_RADIUS_TILES) {
            this.svc.messagingService.queueChatMessage({
                messageType: "game",
                text: "You are too far away to pick that up.",
                targetPlayerIds: [player.id],
            });
            return;
        }

        const qty = requestedQuantity !== undefined ? Math.max(1, requestedQuantity) : 2147483647;

        const nowTick = this.svc.ticker.currentTick();
        const groundItems = this.svc.groundItems;
        const targetStack = groundItems
            .queryArea(tile.x, tile.y, tile.level, 0, nowTick, player.id, player.worldViewId)
            .find((stack) => stack.id === stackId && stack.itemId === itemId);

        if (!targetStack) {
            this.svc.messagingService.queueChatMessage({
                messageType: "game",
                text: "There is nothing interesting there.",
                targetPlayerIds: [player.id],
            });
            return;
        }

        const inventoryCapacity = this.getInventoryInsertCapacity(player, itemId);
        if (inventoryCapacity <= 0) {
            this.svc.messagingService.queueChatMessage({
                messageType: "game",
                text: "Your inventory is too full to pick that up.",
                targetPlayerIds: [player.id],
            });
            return;
        }

        const quantityToTake = Math.max(
            0,
            Math.min(qty, Math.max(0, targetStack.quantity), inventoryCapacity),
        );
        if (quantityToTake <= 0) {
            this.svc.messagingService.queueChatMessage({
                messageType: "game",
                text: "Your inventory is too full to pick that up.",
                targetPlayerIds: [player.id],
            });
            return;
        }

        const removed = groundItems.removeById(stackId, quantityToTake, nowTick, player.id);

        if (!removed) {
            this.svc.messagingService.queueChatMessage({
                messageType: "game",
                text: "There is nothing interesting there.",
                targetPlayerIds: [player.id],
            });
            return;
        }

        const addResult = this.svc.inventoryService.addItemToInventory(
            player,
            itemId,
            removed.removed,
        );
        const added = Math.max(0, addResult.added);

        if (added <= 0) {
            this.svc.messagingService.queueChatMessage({
                messageType: "game",
                text: "Your inventory is too full to pick that up.",
                targetPlayerIds: [player.id],
            });

            if (removed.staticSpawnKey) {
                groundItems.restoreStaticSpawnNow(removed.staticSpawnKey, nowTick);
            } else {
                const inWilderness = isInWilderness(tile.x, tile.y);
                groundItems.spawn(
                    itemId,
                    removed.removed,
                    tile,
                    nowTick,
                    {
                        privateTicks: inWilderness ? 0 : undefined,
                    },
                    player.worldViewId,
                );
            }
            return;
        }

        if (player.tileX !== tile.x || player.tileY !== tile.y) {
            player.faceTile(tile.x, tile.y);
        }
        player.queueOneShotSeq(this.getPickupSequence(tile), 0);

        this.svc.networkLayer.withDirectSendBypass("pickup_sound", () =>
            this.svc.soundService.sendSound(player, 2582),
        );

        // Track for collection log (sends "new item" notification only for new collection log items)
        this.svc.collectionLogService.trackCollectionLogItem(player, itemId);

        // Leagues "Obtain X" tasks track items picked up from the ground.
        this.svc.eventBus.emit("item:obtain", {
            playerId: player.id,
            itemId,
            count: added,
        });

        // Force ground item update for this player
        this.svc.playerGroundSerial.delete(player.id);

        try {
            logger.info(
                `[ground] pickup player=${player.id} item=${itemId} qty=${added} tile=(${tile.x},${tile.y},${tile.level})`,
            );
        } catch (err) {
            logger.warn("[ground-item] failed to log pickup debug", err);
        }
    }
}
