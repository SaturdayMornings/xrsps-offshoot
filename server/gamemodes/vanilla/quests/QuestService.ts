import type { PlayerState } from "../../../src/game/player";
import type { IScriptRegistry, ScriptServices } from "../../../src/game/scripts/types";
import { queuePlayerQuestListUi } from "../widgets/questListUi";
import type { QuestDefinition, QuestItemRequirement } from "./types";

// ============================================================================
// Quest state, reward and completion handling
// ============================================================================

/** Varp: current quest points */
export const VARP_QUEST_POINTS = 101;

/** Quest completed scroll interface */
const QUEST_COMPLETED_GROUP_ID = 153;
/** Headline: "Congratulations!" */
const QC_TITLE_CHILD = 3;
/** Quest name line: "You have completed ..." */
const QC_NAME_CHILD = 4;
/** Reward item model */
const QC_REWARD_MODEL_CHILD = 5;
/** "Quest points: N" footer */
const QC_QUEST_POINTS_CHILD = 6;
/** First of eight reward list lines */
const QC_FIRST_REWARD_LINE_CHILD = 8;
const QC_REWARD_LINE_COUNT = 8;
/** Close button layer (cache op1 "Close"; the graphic child 17 stays click-through) */
const QC_CLOSE_LAYER_CHILD = 16;

/** quest_complete_1 */
const QUEST_COMPLETE_JINGLE_ID = 152;

// ============================================================================
// Quest stage state (varp-backed)
// ============================================================================

export function getQuestStage(player: PlayerState, quest: QuestDefinition): number {
    const value = player.varps.getVarpValue(quest.varpId);
    if (!quest.stageBits) return value;
    const width = quest.stageBits.end - quest.stageBits.start + 1;
    const mask = 2 ** width - 1;
    return (value >>> quest.stageBits.start) & mask;
}

export function setQuestStage(
    player: PlayerState,
    quest: QuestDefinition,
    services: ScriptServices,
    value: number,
): void {
    let nextValue = value;
    if (quest.stageBits) {
        const width = quest.stageBits.end - quest.stageBits.start + 1;
        const valueMask = 2 ** width - 1;
        const rangeMask = valueMask << quest.stageBits.start;
        const current = player.varps.getVarpValue(quest.varpId);
        nextValue = (current & ~rangeMask) | ((value & valueMask) << quest.stageBits.start);
    }
    player.varps.setVarpValue(quest.varpId, nextValue);
    services.variables.sendVarp(player, quest.varpId, nextValue);
    queuePlayerQuestListUi(player, services.dialog);
}

export function isQuestStarted(player: PlayerState, quest: QuestDefinition): boolean {
    return getQuestStage(player, quest) >= quest.startedValue;
}

export function isQuestComplete(player: PlayerState, quest: QuestDefinition): boolean {
    return getQuestStage(player, quest) >= quest.completionValue;
}

export function getUnmetQuestRequirements(
    player: PlayerState,
    services: ScriptServices,
    quest: QuestDefinition,
): string[] {
    const requirements = quest.requirements;
    if (!requirements) return [];
    const unmet: string[] = [];
    if (
        requirements.questPoints !== undefined &&
        player.varps.getVarpValue(VARP_QUEST_POINTS) < requirements.questPoints
    ) {
        unmet.push(`${requirements.questPoints} Quest Points`);
    }
    for (const requirement of requirements.skills ?? []) {
        if (services.skills.getSkill(player, requirement.skillId).baseLevel < requirement.level) {
            unmet.push(`Level ${requirement.level} ${requirement.label}`);
        }
    }
    for (const requirement of requirements.quests ?? []) {
        if (player.varps.getVarpValue(requirement.varpId) < requirement.minValue) {
            unmet.push(requirement.label);
        }
    }
    return unmet;
}

export function meetsQuestRequirements(
    player: PlayerState,
    services: ScriptServices,
    quest: QuestDefinition,
): boolean {
    return getUnmetQuestRequirements(player, services, quest).length === 0;
}

// ============================================================================
// Quest item requirements
// ============================================================================

export function countCarriedItem(
    player: PlayerState,
    services: ScriptServices,
    itemId: number,
): number {
    let total = 0;
    for (const entry of services.inventory.getInventoryItems(player)) {
        if (entry.itemId === itemId) total += entry.quantity;
    }
    return total;
}

export function hasQuestItems(
    player: PlayerState,
    services: ScriptServices,
    requirements: QuestItemRequirement[],
): boolean {
    const totals = new Map<number, number>();
    for (const req of requirements) {
        totals.set(req.itemId, (totals.get(req.itemId) ?? 0) + req.quantity);
    }
    return [...totals].every(
        ([itemId, quantity]) => countCarriedItem(player, services, itemId) >= quantity,
    );
}

/** Remove all required items from the inventory. All-or-nothing. */
export function takeQuestItems(
    player: PlayerState,
    services: ScriptServices,
    requirements: QuestItemRequirement[],
): boolean {
    if (!hasQuestItems(player, services, requirements)) return false;
    const totals = new Map<number, number>();
    for (const req of requirements) {
        totals.set(req.itemId, (totals.get(req.itemId) ?? 0) + req.quantity);
    }
    for (const [itemId, quantity] of totals) {
        let remaining = quantity;
        const entries = services.inventory
            .getInventoryItems(player)
            .filter((entry) => entry.itemId === itemId && entry.quantity > 0);
        for (const entry of entries) {
            if (remaining <= 0) break;
            const amount = Math.min(remaining, entry.quantity);
            const nextQuantity = entry.quantity - amount;
            services.inventory.setInventorySlot(
                player,
                entry.slot,
                nextQuantity > 0 ? entry.itemId : -1,
                nextQuantity,
            );
            remaining -= amount;
        }
    }
    services.inventory.snapshotInventory(player);
    return true;
}

// ============================================================================
// Quest completion
// ============================================================================

export function completeQuest(
    player: PlayerState,
    services: ScriptServices,
    quest: QuestDefinition,
): boolean {
    if (isQuestComplete(player, quest)) return false;

    const itemRewards = quest.rewards.items ?? [];
    if (!canReceiveQuestItemRewards(player, services, itemRewards)) {
        services.messaging.sendGameMessage(
            player,
            "You need more free inventory space to receive your quest reward.",
        );
        return false;
    }

    for (const item of itemRewards) {
        const result = services.inventory.addItemToInventory(player, item.itemId, item.quantity);
        if (result.added !== item.quantity) {
            services.system.logger.error?.(
                `[quests] Failed to grant full reward player=${player.id} quest="${quest.name}" item=${item.itemId} expected=${item.quantity} added=${result.added}`,
            );
            return false;
        }
    }
    if (itemRewards.length > 0) services.inventory.snapshotInventory(player);

    setQuestStage(player, quest, services, quest.completionValue);

    // Leagues "Complete <quest>" tasks listen for this; the event carries the
    // stable quest key so league task triggers never depend on display names.
    services.system.eventBus?.emit("quest:complete", {
        player,
        questKey: quest.key,
        questName: quest.name,
    });

    const questPointTotal =
        player.varps.getVarpValue(VARP_QUEST_POINTS) + quest.rewards.questPoints;
    player.varps.setVarpValue(VARP_QUEST_POINTS, questPointTotal);
    services.variables.sendVarp(player, VARP_QUEST_POINTS, questPointTotal);

    for (const xp of quest.rewards.xp ?? []) {
        services.skills.addSkillXp(player, xp.skillId, xp.amount);
    }
    services.sound.sendJingle(player, QUEST_COMPLETE_JINGLE_ID);
    services.messaging.sendGameMessage(
        player,
        `Congratulations, you've completed a quest: ${quest.name}`,
    );
    openQuestCompletedScroll(player, services, quest, questPointTotal);

    services.system.logger.info?.(
        `[quests] Quest completed player=${player.id} quest="${quest.name}" qp=${questPointTotal}`,
    );
    return true;
}

function canReceiveQuestItemRewards(
    player: PlayerState,
    services: ScriptServices,
    rewards: readonly { itemId: number; quantity: number }[],
): boolean {
    if (rewards.length === 0) return true;
    const inventory = services.inventory.getInventoryItems(player);
    let freeSlots = inventory.filter((entry) => entry.itemId <= 0 || entry.quantity <= 0).length;
    const presentStacks = new Set(
        inventory
            .filter((entry) => entry.itemId > 0 && entry.quantity > 0)
            .map((entry) => entry.itemId),
    );
    for (const reward of rewards) {
        const definition = services.data.getObjType(reward.itemId);
        const stackable =
            Number(definition?.stackability ?? 0) === 1 ||
            Number(definition?.stackable ?? 0) === 1;
        const requiredSlots = stackable && presentStacks.has(reward.itemId) ? 0 : stackable ? 1 : reward.quantity;
        if (requiredSlots > freeSlots) return false;
        freeSlots -= requiredSlots;
        if (stackable) presentStacks.add(reward.itemId);
    }
    return true;
}

/**
 * Developer helper: mark every implemented quest complete without granting
 * XP, items, jingles, or opening a stack of completion scrolls.
 *
 * Quest points are recomputed from the definitions so repeated use is
 * idempotent and cannot duplicate points.
 */
export function completeAllQuests(
    player: PlayerState,
    services: ScriptServices,
    quests: readonly QuestDefinition[],
): number {
    let questPoints = 0;
    for (const quest of quests) {
        setQuestStage(player, quest, services, quest.completionValue);
        questPoints += quest.rewards.questPoints;
    }
    player.varps.setVarpValue(VARP_QUEST_POINTS, questPoints);
    services.variables.sendVarp(player, VARP_QUEST_POINTS, questPoints);
    return questPoints;
}

function buildRewardLines(quest: QuestDefinition): string[] {
    const lines = ["You are awarded:"];
    const qp = quest.rewards.questPoints;
    lines.push(`${qp} Quest Point${qp === 1 ? "" : "s"}`);
    for (const xp of quest.rewards.xp ?? []) {
        lines.push(`${xp.amount.toLocaleString("en-US")} ${xp.label} XP`);
    }
    for (const item of quest.rewards.items ?? []) {
        lines.push(item.label);
    }
    lines.push(...(quest.rewards.other ?? []));
    return lines.slice(0, QC_REWARD_LINE_COUNT);
}

function openQuestCompletedScroll(
    player: PlayerState,
    services: ScriptServices,
    quest: QuestDefinition,
    questPointTotal: number,
): void {
    services.dialog.closeDialog(player);

    const mainmodalUid = services.viewport.getMainmodalUid(player.displayMode ?? 1);
    services.dialog.openSubInterface(player, mainmodalUid, QUEST_COMPLETED_GROUP_ID, 0);

    const OP1_TRANSMIT = 1 << 1;
    services.dialog.queueWidgetEvent(player.id, {
        action: "set_flags_range",
        uid: (QUEST_COMPLETED_GROUP_ID << 16) | QC_CLOSE_LAYER_CHILD,
        fromSlot: -1,
        toSlot: -1,
        flags: OP1_TRANSMIT,
    });

    const setText = (childId: number, text: string) => {
        services.dialog.queueWidgetEvent(player.id, {
            action: "set_text",
            uid: (QUEST_COMPLETED_GROUP_ID << 16) | childId,
            text,
        });
    };

    setText(QC_TITLE_CHILD, "Congratulations!");
    setText(QC_NAME_CHILD, `You have completed ${quest.name}!`);

    if (quest.rewardItemId !== undefined) {
        services.dialog.queueWidgetEvent(player.id, {
            action: "set_item",
            uid: (QUEST_COMPLETED_GROUP_ID << 16) | QC_REWARD_MODEL_CHILD,
            itemId: quest.rewardItemId,
            quantity: 1,
        });
    }

    const rewardLines = buildRewardLines(quest);
    for (let i = 0; i < QC_REWARD_LINE_COUNT; i++) {
        setText(QC_FIRST_REWARD_LINE_CHILD + i, rewardLines[i] ?? "");
    }

    setText(QC_QUEST_POINTS_CHILD, `Quest points: ${questPointTotal}`);
}

export function registerQuestCompletedWidgetHandlers(
    registry: IScriptRegistry,
    services: ScriptServices,
): void {
    const close = (event: { player: PlayerState }) => {
        services.dialog.closeModal(event.player);
    };
    registry.onButton(QUEST_COMPLETED_GROUP_ID, QC_CLOSE_LAYER_CHILD, close);
}
