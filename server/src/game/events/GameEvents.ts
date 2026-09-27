import type { SkillId } from "../../../../client/rs/skill/skills";
import type { NpcState } from "../npc";
import type { PlayerState } from "../player";

/**
 * Map of all game event names to their payload types.
 * Gamemodes and plugins subscribe to these events to react to game state changes
 * without tight coupling to the systems that produce them.
 */
export interface GameEventMap {
    // ── Player lifecycle ──────────────────────────────────────────────
    "player:login": {
        player: PlayerState;
    };
    "player:logout": {
        playerId: number;
        username: string;
    };

    // ── Skills ────────────────────────────────────────────────────────
    "skill:xpGain": {
        player: PlayerState;
        skillId: SkillId;
        xpGained: number;
        totalXp: number;
        source: "skill" | "combat" | "quest" | "other";
    };
    "skill:levelUp": {
        player: PlayerState;
        skillId: SkillId;
        oldLevel: number;
        newLevel: number;
    };
    "combat:levelUp": {
        player: PlayerState;
        oldLevel: number;
        newLevel: number;
    };

    // ── Equipment ─────────────────────────────────────────────────────
    "equipment:equip": {
        player: PlayerState;
        itemId: number;
        slot: number;
    };
    "equipment:unequip": {
        player: PlayerState;
        itemId: number;
        slot: number;
    };

    // ── Death ─────────────────────────────────────────────────────────
    "npc:death": {
        npc: NpcState;
        npcTypeId: number;
        combatLevel?: number;
        killerPlayerId: number | undefined;
        tile: { x: number; y: number; level: number };
    };
    // ── NPCs ──────────────────────────────────────────────────────────
    /**
     * Emitted when a player uses a non-attack option on an NPC ("Talk-to",
     * "Pet", ...). Leagues "Talk to X" / "Pet X" tasks listen for it.
     */
    "npc:interact": {
        player: PlayerState;
        npcTypeId: number;
        /** Normalised, lower-cased option the player used. */
        option: string;
    };

    // ── Interfaces ────────────────────────────────────────────────────
    "interfaces:closeInterruptible": {
        player: PlayerState;
    };

    // ── Quests ────────────────────────────────────────────────────────
    /** Emitted when a quest is completed (see QuestService.completeQuest). */
    "quest:complete": {
        player: PlayerState;
        /** Stable content key of the completed quest (see QuestRegistry). */
        questKey: string;
        /** Display name of the completed quest. */
        questName: string;
    };

    // ── Items ─────────────────────────────────────────────────────────
    "item:craft": {
        playerId: number;
        itemId: number;
        count: number;
    };
    /**
     * Emitted when a player earns an item from world content: ground item
     * pickups (including loot), gathering skills (woodcutting, mining, fishing),
     * thieving, ... Leagues "Obtain X" / "Chop X" / "Catch X" tasks listen for it.
     *
     * Deliberately *not* emitted for bank withdrawals, trades or shop purchases,
     * which are not "obtaining" for league task purposes.
     */
    "item:obtain": {
        playerId: number;
        itemId: number;
        count: number;
    };
    /** Emitted when a player buries bones (leagues "Bury Some Bones" tasks). */
    "item:bury": {
        playerId: number;
        itemId: number;
        count: number;
    };
}

export type GameEventName = keyof GameEventMap;
