/**
 * Regression coverage for the failed-pickpocket stun.
 *
 * A failed pickpocket resolves over several ticks (fail message -> stun
 * animation -> stun damage). Player input that cancels interruptible actions
 * (clicking scenery, a ground item, another NPC, a teleport, ...) drops the
 * remaining ticks, so anything that only a later tick would release - such as
 * `player.lock` - must never be held across ticks: that left the player locked
 * forever (unable to move, attack, teleport or interact), which reads as being
 * permanently stunned.
 *
 * Run with: npx tsx tests/pickpocket-stun.test.ts
 */
import assert from "node:assert/strict";

import { ActionScheduler } from "../src/game/actions/ActionScheduler";
import type { ActionEffect, ScheduledAction } from "../src/game/actions/types";
import { registerSkillConfiguration } from "../src/game/combat/SkillConfigurationProvider";
import type { GamemodeDefinition } from "../src/game/gamemodes/GamemodeDefinition";
import { LockState } from "../src/game/model/LockState";
import { STUN_TIMER } from "../src/game/model/timer/Timers";
import { NpcState } from "../src/game/npc";
import { PlayerState } from "../src/game/player";
import type {
    IScriptRegistry,
    NpcInteractionEvent,
    ScriptActionHandler,
    ScriptServices,
} from "../src/game/scripts/types";
import { register as registerPickpocket } from "../gamemodes/vanilla/skills/thieving/pickpocket";

// "Man" - level 1 thieving, 8 tick stun on failure.
const MAN_TYPE_ID = 3014;
const START_TICK = 100;

registerSkillConfiguration({
    computeCombatLevel: () => 3,
    skillRestoreIntervalTicks: 100,
    skillBoostDecayIntervalTicks: 100,
    hitpointRegenIntervalTicks: 100,
    hitpointOverhealDecayIntervalTicks: 100,
    preserveDecayMultiplier: 1.5,
});

const TEST_GAMEMODE = {
    id: "pickpocket-stun-test",
    name: "Pickpocket stun test",
    initializePlayer: () => undefined,
    canInteract: () => true,
} as GamemodeDefinition;

interface Harness {
    player: PlayerState;
    scheduler: ActionScheduler;
    npcHandler: (event: NpcInteractionEvent) => void;
    messages: string[];
    varbitWrites: Array<[number, number]>;
    /** Mirrors the engine's per-tick order: movement/timers then actions. */
    tick(currentTick: number): void;
    startPickpocket(): void;
}

function createHarness(): Harness {
    const messages: string[] = [];
    const varbitWrites: Array<[number, number]> = [];
    const npc = new NpcState(1, MAN_TYPE_ID, 1, -1, -1, 32, { x: 3201, y: 3200, level: 0 }, {
        maxHitpoints: 100,
        combatLevel: 2,
    });

    let schedulerRef: ActionScheduler | undefined;
    const services = {
        skills: {
            getSkill: () => ({ baseLevel: 1, boost: 0 }),
            addSkillXp: () => undefined,
        },
        equipment: {
            getEquipArray: () => [],
        },
        combat: {
            getNpc: (id: number) => (id === npc.id ? npc : undefined),
            isPlayerStunned: (player: PlayerState) => player.timers.has(STUN_TIMER),
            isPlayerInCombat: () => false,
            applyPlayerHitsplat: (_player: PlayerState, style: number, damage: number) => ({
                amount: damage,
                style,
                hpCurrent: 10,
                hpMax: 10,
            }),
            stunPlayer: (player: PlayerState, ticks: number) =>
                player.timers.set(STUN_TIMER, ticks),
            scheduleAction: (
                playerId: number,
                request: Parameters<ActionScheduler["requestAction"]>[1],
                tick: number,
            ) => schedulerRef!.requestAction(playerId, request, tick),
            requestAction: (
                player: PlayerState,
                request: Parameters<ActionScheduler["requestAction"]>[1],
                tick: number,
            ) => schedulerRef!.requestAction(player.id, request, tick),
            clearPlayerFaceTarget: () => undefined,
        },
        inventory: {
            hasInventorySlot: () => true,
            getInventoryItems: () => [],
            addItemToInventory: () => undefined,
        },
        variables: {
            sendVarbit: (_player: PlayerState, id: number, value: number) => {
                varbitWrites.push([id, value]);
            },
        },
        npc: {
            stopNpcMovement: () => undefined,
            queueNpcForcedChat: () => undefined,
            faceNpcToPlayer: () => undefined,
            queueNpcSeq: () => undefined,
        },
        animation: {
            playPlayerSeq: () => undefined,
            broadcastPlayerSpot: () => undefined,
        },
        sound: {
            sendSound: () => undefined,
        },
    } as unknown as ScriptServices;

    const actionHandlers = new Map<string, ScriptActionHandler>();
    const npcHandlers = new Map<number, (event: NpcInteractionEvent) => void>();
    const registry = new Proxy(
        {
            registerActionHandler: (kind: string, handler: ScriptActionHandler) => {
                actionHandlers.set(kind, handler);
                return { ok: true };
            },
            registerNpcInteraction: (
                npcId: number,
                handler: (event: NpcInteractionEvent) => void,
            ) => {
                npcHandlers.set(npcId, handler);
                return { ok: true };
            },
        },
        {
            get(target: Record<string, unknown>, prop: string) {
                if (prop in target) return target[prop];
                return () => ({ ok: true });
            },
        },
    ) as unknown as IScriptRegistry;

    registerPickpocket(registry, services);

    const handler = actionHandlers.get("skill.pickpocket");
    if (!handler) throw new Error("pickpocket action handler was not registered");
    const npcHandler = npcHandlers.get(MAN_TYPE_ID);
    if (!npcHandler) throw new Error("pickpocket npc interaction was not registered");

    const player = new PlayerState(1, 3200, 3200, 0, TEST_GAMEMODE);
    player.status.hitpointsCurrent = 10;

    const scheduler = new ActionScheduler(
        (p: PlayerState, action: ScheduledAction, tick: number) => {
            if (action.kind !== "skill.pickpocket") {
                throw new Error(`unexpected action kind: ${action.kind}`);
            }
            return handler({ player: p, data: action.data, tick, services });
        },
    );
    schedulerRef = scheduler;
    scheduler.registerPlayer(player);

    return {
        player,
        scheduler,
        npcHandler,
        messages,
        varbitWrites,
        tick(currentTick: number) {
            player.processTimersAndQueue();
            const effects: ActionEffect[] = scheduler.processTick(currentTick);
            for (const effect of effects) {
                if (effect.type === "message") messages.push(effect.message);
                if (effect.type === "log" && effect.level === "error") {
                    throw new Error(`action failed: ${effect.message}`);
                }
            }
        },
        startPickpocket() {
            npcHandler({
                tick: START_TICK,
                player,
                npc,
                services,
                option: "pickpocket",
            } as unknown as NpcInteractionEvent);
        },
    };
}

/** Forces the failure branch of the pickpocket success roll. */
function withForcedFailure<T>(fn: () => T): T {
    const originalRandom = Math.random;
    Math.random = () => 0.999;
    try {
        return fn();
    } finally {
        Math.random = originalRandom;
    }
}

// ---------------------------------------------------------------------------
// A failed attempt stuns the player and the stun always expires.
// ---------------------------------------------------------------------------
withForcedFailure(() => {
    const harness = createHarness();
    const { player } = harness;

    harness.startPickpocket();

    // Tick T: the interaction queues the attempt and phase 0 plays the attempt
    // animation. Nothing may hold the player in place yet: the attempt ticks are
    // cancellable, so a lock taken here could be stranded.
    harness.tick(START_TICK);
    assert.equal(player.lock, LockState.NONE, "the attempt must not lock the player");
    assert.equal(player.timers.has(STUN_TIMER), false, "the attempt must not stun the player");

    // Tick T+1: the failure resolves, so the stun starts immediately. The
    // remaining phases only add the visuals and the damage.
    harness.tick(START_TICK + 1);
    assert.equal(player.lock, LockState.NONE, "the fail branch must not leave a lock");
    assert.equal(player.timers.has(STUN_TIMER), true, "the fail must stun immediately");
    assert.equal(player.canMove(), false, "a stunned player cannot move");

    // The stun runs out on its own: the player is never permanently stunned.
    for (let tick = START_TICK + 2; tick <= START_TICK + 10; tick++) {
        harness.tick(tick);
        assert.equal(
            player.canMove(),
            false,
            `player must stay stunned on tick ${tick - START_TICK}`,
        );
    }
    harness.tick(START_TICK + 11);
    assert.equal(player.timers.has(STUN_TIMER), false, "the stun must expire");
    assert.equal(player.canMove(), true, "the player must be free after the stun");
    assert.equal(player.lock, LockState.NONE);

    assert.deepEqual(harness.messages, [
        "You fail to pick the npc's pocket.",
        "You've been stunned!",
    ]);
    assert.deepEqual(harness.varbitWrites, [
        [12393, 1],
        [12393, 0],
    ]);
});

// ---------------------------------------------------------------------------
// The reported bug: player input cancels the follow-up ticks *after* the
// failure resolved (e.g. clicking scenery, a ground item or another NPC). The
// stun must still run out and the player must never be left locked in place.
// ---------------------------------------------------------------------------
withForcedFailure(() => {
    const harness = createHarness();
    const { player, scheduler } = harness;

    harness.startPickpocket();
    harness.tick(START_TICK);

    // The failure resolves and starts the stun.
    harness.tick(START_TICK + 1);
    assert.equal(player.timers.has(STUN_TIMER), true);

    // Exactly what interruptSkillActions does when the player clicks something.
    assert.equal(
        scheduler.cancelInterruptibleActions(player.id),
        1,
        "the pending follow-up tick is cancellable",
    );

    // The stun still runs to its original end, and the player is never stuck.
    for (let tick = START_TICK + 2; tick <= START_TICK + 10; tick++) {
        harness.tick(tick);
        assert.equal(
            player.canMove(),
            false,
            `cancelled follow-up ticks must not strand the player (tick ${tick - START_TICK})`,
        );
    }
    harness.tick(START_TICK + 11);
    assert.equal(player.timers.has(STUN_TIMER), false, "the stun must still expire");
    assert.equal(
        player.canMove(),
        true,
        "the player must recover after a cancelled stun sequence",
    );
    assert.equal(player.lock, LockState.NONE);
});

// ---------------------------------------------------------------------------
// Cancelling before the outcome is known drops the attempt entirely: no stun,
// no lock, and the player can act immediately.
// ---------------------------------------------------------------------------
withForcedFailure(() => {
    const harness = createHarness();
    const { player, scheduler } = harness;

    harness.startPickpocket();
    harness.tick(START_TICK);

    assert.equal(scheduler.cancelInterruptibleActions(player.id), 1, "the attempt is cancellable");

    for (let tick = START_TICK + 1; tick <= START_TICK + 12; tick++) {
        harness.tick(tick);
        assert.equal(player.canMove(), true, "a cancelled attempt must not stun the player");
    }

    assert.equal(player.lock, LockState.NONE);
    assert.equal(player.timers.has(STUN_TIMER), false);
    assert.deepEqual(harness.messages, []);
});

console.log("pickpocket stun regression tests passed");
