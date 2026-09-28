/**
 * Cosmetic outfits for the ambient test bots.
 *
 * Bots are not real accounts: they never run the login handshake and never equip
 * anything through the inventory, so a bot's look is nothing but the appearance
 * `equip` array handed to the client. This module owns that data so the outfit a
 * bot spawns in lives in one place instead of being rebuilt inline at every spawn
 * site, and so the item ids can be validated in one shot by
 * tests/bot-outfits.test.ts.
 *
 * The ids are classic OSRS ids resolved against `server/data/items.json`, so a
 * typo shows up as a missing item definition in the test suite rather than as a
 * naked bot in the world.
 */
import { EquipmentSlot } from "../../../client/rs/config/player/Equipment";

import { DEFAULT_EQUIP_SLOT_COUNT } from "./equipment";

export interface BotOutfit {
    /** Stable identifier; used by tests and logs. */
    readonly id: string;
    /**
     * Item id per equipment slot. Slots that are not listed stay empty (-1), so
     * an outfit only has to name the pieces it actually wears.
     */
    readonly equip: Readonly<Partial<Record<EquipmentSlot, number>>>;
}

/** The melee look the bots originally shipped with, and the default outfit. */
export const BOT_OUTFIT_RUNE_MELEE: BotOutfit = {
    id: "rune-melee",
    equip: {
        [EquipmentSlot.HEAD]: 1163, // rune full helm
        [EquipmentSlot.WEAPON]: 1333, // rune scimitar
        [EquipmentSlot.BODY]: 1127, // rune platebody
        [EquipmentSlot.SHIELD]: 1201, // rune kiteshield
        [EquipmentSlot.LEGS]: 1079, // rune platelegs
        [EquipmentSlot.BOOTS]: 4131, // rune boots
    },
};

/**
 * Black dragonhide ranger: body, chaps and vambraces with a magic shortbow.
 *
 * The shortbow is two-handed, so nothing goes in the off-hand. There is no black
 * d'hide coif in the item data (the plain "Coif" is leather-coloured), so the head
 * slot is deliberately left bare rather than breaking the black set.
 */
export const BOT_OUTFIT_BLACK_DHIDE_RANGER: BotOutfit = {
    id: "black-dhide-ranger",
    equip: {
        [EquipmentSlot.WEAPON]: 861, // magic shortbow (two-handed)
        [EquipmentSlot.BODY]: 2503, // black d'hide body
        [EquipmentSlot.LEGS]: 2497, // black d'hide chaps
        [EquipmentSlot.GLOVES]: 2491, // black d'hide vambraces
    },
};

/**
 * Full black ("dark") mystic set — hat, robe top, robe bottom, gloves and boots —
 * with a lava battlestaff. Every slot of the set is worn, so this is the complete
 * black mystic armour look.
 */
export const BOT_OUTFIT_BLACK_MYSTIC_MAGE: BotOutfit = {
    id: "black-mystic-mage",
    equip: {
        [EquipmentSlot.HEAD]: 4099, // mystic hat (dark)
        [EquipmentSlot.WEAPON]: 3053, // lava battlestaff
        [EquipmentSlot.BODY]: 4101, // mystic robe top (dark)
        [EquipmentSlot.LEGS]: 4103, // mystic robe bottom (dark)
        [EquipmentSlot.GLOVES]: 4105, // mystic gloves (dark)
        [EquipmentSlot.BOOTS]: 4107, // mystic boots (dark)
    },
};

/**
 * Looks the ambient crowd cycles through, in spawn order.
 *
 * The mage comes first so that the bot which actually casts (spawn index 0, the
 * autocaster) is the one holding the battlestaff.
 */
export const BOT_OUTFIT_ROTATION: readonly BotOutfit[] = [
    BOT_OUTFIT_BLACK_MYSTIC_MAGE,
    BOT_OUTFIT_BLACK_DHIDE_RANGER,
];

/**
 * Outfit for the nth bot of a crowd. Wraps, and tolerates negative/non-integer
 * input, so any spawn index is safe.
 */
export function pickBotOutfit(index: number): BotOutfit {
    const count = BOT_OUTFIT_ROTATION.length;
    const slot = ((Math.trunc(index) % count) + count) % count;
    return BOT_OUTFIT_ROTATION[slot];
}

/**
 * Build the fixed-length appearance `equip` array that PlayerState expects.
 * Unmentioned slots are -1 (empty), and out-of-range or non-positive ids are
 * ignored rather than written into a slot they cannot occupy.
 */
export function buildBotEquip(
    outfit: BotOutfit,
    slotCount: number = DEFAULT_EQUIP_SLOT_COUNT,
): number[] {
    const equip = new Array<number>(slotCount).fill(-1);
    for (const [slot, itemId] of Object.entries(outfit.equip)) {
        const index = Number(slot);
        if (!Number.isInteger(index) || index < 0 || index >= slotCount) continue;
        if (typeof itemId !== "number" || itemId <= 0) continue;
        equip[index] = itemId;
    }
    return equip;
}
