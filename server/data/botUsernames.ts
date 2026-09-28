/**
 * Static pool of realistic RuneScape-style account names.
 *
 * Used by `WSServer.initTestBots()` to give the headless dev/test bots plausible
 * display names instead of the default blank name (which renders as an unbranded
 * player model in the client).
 *
 * Style notes — these mirror how real OSRS accounts are actually named:
 *  - RuneScape flavour nouns first (Zamorak, Saradomin, Varrock, Dharok...),
 *  - skill / activity mashups ("AfkWoodcut", "HerbRunGuy", "SlayerTaskz"),
 *  - account-type markers ("IronmanBTW", "HardcoreHC", "UltimateUIM"),
 *  - heavy numeric suffixes and casual casing quirks ("Zammy4Life", "NoobSlayer9").
 *
 * Constraints kept to match the live login rules:
 *  - no spaces (usernames are a single token),
 *  - 1-12 characters (OSRS display-name limit),
 *  - all entries unique.
 */
export const BOT_USERNAMES: readonly string[] = [
    "Zezima2",
    "IronSquid",
    "Zammy4Life",
    "AfkWoodcut",
    "PureStrPure",
    "LumbridgeLad",
    "VarrockVaga",
    "DharoksWrath",
    "GmaulGoblin",
    "NoobSlayer9",
    "RuneScimitar",
    "BonesToPeach",
    "WildyBait",
    "GreenDragons",
    "RcRunner",
    "LobsterCage",
    "MageBankAlt",
    "BarrowsBro",
    "SlayerTaskz",
    "HerbRunGuy",
    "BlastFurnace",
    "Wintertodt99",
    "TemporossFin",
    "GOTRSweat",
    "Salmonslap",
    "ChickenKillr",
    "CowhideCo",
    "LumbDungLad",
    "EdgevillePk",
    "VarrockGuard",
    "FaladorPwny",
    "DraynorDan",
    "KaramjaKev",
    "ArdougneAl",
    "CatherbyCid",
    "SeersVillage",
    "YanilleYan",
    "AlKharidAsh",
    "CanifisCaz",
    "ZulrahSlayr",
    "VorkathVic",
    "CorpBeastly",
    "NexKiller",
    "TOBAttempt",
    "WhipPlease",
    "GracefulKat",
    "DragonClaws",
    "ArmadylGod",
    "BandosBrawl",
    "SaraStrike",
    "GuthixGus",
    "AncientMag3",
    "IceBarrageX",
    "TeleBlocked",
    "RuniteOre",
    "MithrilMike",
    "AdamantAnn",
    "BronzeBruce",
    "IronIngot",
    "CoalMiner42",
    "SuperheatSam",
    "SmitherSue",
    "FletchFletch",
    "FishLevel99",
    "CookedShark",
    "BrewMaster",
    "PotsAndPans",
    "ThievingTom",
    "Pickpocketz",
    "AgilityAce",
    "FarmingFred",
    "HerbloreHal",
    "ConstrBob",
    "HunterHill",
    "CraftingCara",
    "RunecraftRo",
    "PrayerPete",
    "MagicMikey",
    "RangedRick",
    "DefNoobDef",
    "HpCapeOnly",
    "QuestCaper",
    "DiaryDone",
    "ClueScrolls",
    "PetsAndPvm",
    "IronmanBTW",
    "HardcoreHC",
    "UltimateUIM",
    "GroupIronGi",
    "DeadmanMode",
    "LeaguesLad",
    "TrailblazerT",
    "TwistedTwig",
    "ShatteredRel",
    "RaidsReady",
    "CoXRunner",
    "SkillingPet",
    "AchievementD",
    "TradeStandin",
    "SplashCast",
];

/**
 * Pick `count` distinct names from {@link BOT_USERNAMES}.
 *
 * Selection is random (Fisher-Yates on a copy, so the exported pool is never
 * mutated) and therefore differs between server restarts — which is what makes a
 * handful of bots read as a genuine crowd of players rather than a fixture.
 *
 * The result is deterministic per call given the same shuffling randomness, so
 * callers that want a fixed roster can log/persist the returned array, or pass a
 * shuffled slice in directly.
 *
 * @param count Number of names requested. Values above the pool size are clamped.
 * @returns A new array of unique names, in the order they should be handed out.
 */
export function pickBotNames(count: number): string[] {
    const wanted = Math.max(0, Math.min(Math.trunc(count), BOT_USERNAMES.length));
    const pool = BOT_USERNAMES.slice();
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, wanted);
}
