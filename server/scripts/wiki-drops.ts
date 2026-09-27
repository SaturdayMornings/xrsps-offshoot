/**
 * OSRS Wiki drop-table inspector.
 *
 * Pulls an NPC's live drop table from the OSRS Wiki's structured "Bucket" API
 * (`api.php?action=bucket`, see https://oldschool.runescape.wiki/w/RuneScape:Bucket).
 * That returns one row per wiki `{{DropsLine}}` with the exact rarity string,
 * quantity, roll count, drop version and the wiki's own notes — no HTML
 * scraping, and much fresher than the osrsbox-db snapshot
 * (`references/monsters-complete.json`) that `src/game/drops/monstersCompleteSource.ts`
 * reads on startup.
 *
 * Every row is resolved through the same helpers the drop system uses
 * (`resolveItemId` / `parseProbability` from `src/game/drops/helpers`), so rows
 * the server cannot actually reward (unknown item, unparsable rarity, "Varies"
 * quantity) are flagged instead of silently vanishing at load time.
 *
 * Usage (from `server/`):
 *   yarn wiki-drops Goblin
 *   yarn wiki-drops "Moss giant"
 *   yarn wiki-drops "King Black Dragon" --ts
 *   yarn wiki-drops --npc 2245          # resolve a cache npc id to its wiki page first
 *   yarn wiki-drops Goblin --json > /tmp/goblin.json
 *
 * Flags:
 *   --npc N resolve cache npc type id N to its wiki monster page (and its
 *           version anchor / combat level) before printing the drop table
 *   --ts    also emit paste-ready `drop("Name", qty, "rarity")` entries for
 *           `src/game/drops/manualTables.ts` (`MANUAL_NPC_DROP_OVERRIDES`)
 *   --json  emit the parsed rows/sections as JSON instead of a table
 *   --raw   emit the raw bucket rows exactly as the wiki returned them
 */
import { getItemDefinition, loadItemDefinitions } from "../src/data/items";
import { parseProbability, resolveItemId } from "../src/game/drops/helpers";
import type { NpcDropEntryDefinition } from "../src/game/drops/types";

const WIKI_API = "https://oldschool.runescape.wiki/api.php";
const WIKI_PAGE = "https://oldschool.runescape.wiki/w/";
const USER_AGENT = "xrsps-typescript-wiki-drops/0.1 (server drop-table maintenance)";

type BucketRow = {
    page_name?: string;
    page_name_sub?: string;
    item_name?: string;
    drop_json?: string;
    rare_drop_table?: boolean;
};

type BucketResponse = {
    bucketQuery?: string;
    bucket?: BucketRow[] | null;
    error?: string | { code?: string; info?: string };
};

/** The bucket action reports failures either as a bare string or an object. */
function bucketError(payload: BucketResponse): string | undefined {
    const error = payload.error;
    if (!error) return undefined;
    if (typeof error === "string") return error;
    return error.info ?? error.code ?? "unknown bucket error";
}

type DropJson = Record<string, unknown>;

type ResolvedDrop = {
    itemName: string;
    quantity: string;
    rarity: string;
    rolls: number;
    itemId?: number;
    resolvedName?: string;
    /** Probability of a single roll, i.e. the parsed rarity. */
    probability?: number;
    /** Probability weighted by the wiki's roll count (mirrors monstersCompleteSource). */
    effectiveProbability?: number;
    membersOnly: boolean;
    rareDropTable: boolean;
    dropType: string;
    dropLevel: string;
    rarityNotes: string;
    problems: string[];
};

type Section = {
    /** e.g. `Goblin#Drop table 1` — the wiki's `dropversion`. */
    key: string;
    rows: ResolvedDrop[];
};

function resolveRow(row: BucketRow): ResolvedDrop | undefined {
    const itemName = text(row.item_name);
    if (!itemName) return undefined;

    const json = parseDropJson(row.drop_json);
    const rarityRaw = text(json["Rarity"]);
    const rarity = normalizeRarity(rarityRaw);
    const quantity = normalizeQuantity(text(json["Drop Quantity"])) || "1";
    const rolls = Math.max(1, Math.trunc(Number(json["Rolls"] ?? 1)) || 1);
    const nameNotes = stripHtml(text(json["Name Notes"]));
    const rarityNotes = stripHtml(text(json["Rarity Notes"]));
    const problems: string[] = [];

    const definition: NpcDropEntryDefinition = { itemName, quantity, rarity };
    const itemId = resolveItemId(definition);
    if (!itemId) {
        const closest = describeClosestItemName(itemName);
        problems.push(
            "no name match in data/items.json (row would be dropped at load)" +
                (closest ? ` — ${closest}` : ""),
        );
    }

    const probability = parseProbability(rarity);
    if (probability === undefined) {
        problems.push(`rarity "${rarityRaw}" is not parsable by parseProbability()`);
    }

    const quantityLow = Number(json["Quantity Low"]);
    const quantityHigh = Number(json["Quantity High"]);
    if (
        Number.isFinite(quantityLow) &&
        Number.isFinite(quantityHigh) &&
        quantityLow > 0 &&
        quantityHigh > quantityLow &&
        !/^\d+\s*-\s*\d+$/.test(quantity)
    ) {
        problems.push(`quantity is a range (${quantityLow}-${quantityHigh}); write "${quantityLow}-${quantityHigh}"`);
    }
    if (!/^\d+$/.test(quantity) && !/^\d+\s*-\s*\d+$/.test(quantity)) {
        problems.push(`quantity "${quantity}" is not numeric (parses to 1)`);
    }

    return {
        itemName,
        quantity,
        rarity,
        rolls,
        itemId,
        resolvedName: itemId ? getItemDefinition(itemId)?.name : undefined,
        probability,
        effectiveProbability: probability === undefined ? undefined : probability * rolls,
        membersOnly: /\(m\)/.test(nameNotes),
        rareDropTable: row.rare_drop_table === true,
        dropType: text(json["Drop type"]),
        dropLevel: text(json["Drop level"]),
        rarityNotes,
        problems,
    };
}

function buildSections(page: string, rows: readonly BucketRow[]): Section[] {
    const sections: Section[] = [];
    const byKey = new Map<string, Section>();
    for (const row of rows) {
        const resolved = resolveRow(row);
        if (!resolved) continue;
        const key = text(row.page_name_sub) || page;
        let section = byKey.get(key);
        if (!section) {
            section = { key, rows: [] };
            byKey.set(key, section);
            sections.push(section);
        }
        section.rows.push(resolved);
    }
    // Always-drops first inside a drop table, then rarest-first.
    for (const section of sections) {
        section.rows.sort((a, b) => {
            const aAlways = a.rarity.toLowerCase() === "always" ? 0 : 1;
            const bAlways = b.rarity.toLowerCase() === "always" ? 0 : 1;
            if (aAlways !== bAlways) return aAlways - bAlways;
            return (b.probability ?? -1) - (a.probability ?? -1);
        });
    }
    return sections;
}

function isAlways(row: ResolvedDrop): boolean {
    return row.rarity.toLowerCase() === "always";
}

type Options = {
    page: string;
    npcId?: number;
    emitTs: boolean;
    json: boolean;
    raw: boolean;
};

function text(value: unknown): string {
    if (value === undefined || value === null) return "";
    return String(value).trim();
}

/** `(m)` and note refs arrive as HTML (`<sub title="Members-only">(m)</sub>`). */
function stripHtml(value: string): string {
    return value
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * The wiki writes large odds with thousands separators (`1/5,000`) and can use
 * words ("Always", "Varies", "Common"). The drop helpers only parse `a/b`,
 * `1 in b`, `Always` and plain numbers, so normalise the separators here and
 * let `parseProbability` flag anything else.
 */
function normalizeRarity(value: string): string {
    return value.replace(/,/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Quantities arrive as "1", "1-16" or "1–16" (the wiki uses an en dash for
 * ranges). `parseQuantity()` only understands the ASCII hyphen, so a range that
 * keeps its en dash would silently collapse to a single item.
 */
function normalizeQuantity(value: string): string {
    return value
        .replace(/[\u2010-\u2015\u2212]/g, "-")
        .replace(/,/g, "")
        .replace(/\s*-\s*/g, "-")
        .replace(/\s+/g, " ")
        .trim();
}

let cachedItemNames: Map<string, number[]> | undefined;

function getItemNamesByIds(): Map<string, number[]> {
    if (!cachedItemNames) {
        cachedItemNames = new Map<string, number[]>();
        for (const item of loadItemDefinitions()) {
            const key = item.name.trim().toLowerCase();
            if (!key) continue;
            const ids = cachedItemNames.get(key) ?? [];
            ids.push(item.id);
            cachedItemNames.set(key, ids);
        }
    }
    return cachedItemNames;
}

/**
 * A wiki row can name an item the cache names differently ("Goblin champion
 * scroll" vs "Champion scroll"), so suggest the closest cache name instead of
 * leaving the caller with a bare "not found". Only whole-word matches count, and
 * the longest one wins ("champion scroll" beats the generic "scroll").
 */
function describeClosestItemName(wikiName: string): string | undefined {
    const padded = ` ${wikiName.trim().toLowerCase().replace(/\s+/g, " ")} `;
    let best: { name: string; ids: number[] } | undefined;
    for (const [name, ids] of getItemNamesByIds()) {
        if (name.length < 4 || !padded.includes(` ${name} `)) continue;
        if (!best || name.length > best.name.length) best = { name, ids };
    }
    if (!best) return undefined;
    return best.ids.length === 1
        ? `closest cache name "${best.name}" (id ${best.ids[0]})`
        : `closest cache name "${best.name}" is shared by ${best.ids.length} ids (${best.ids
              .slice(0, 4)
              .join(", ")}, ...) — set itemId explicitly`;
}

function parseDropJson(raw: string | undefined): DropJson {
    if (!raw) return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? (parsed as DropJson) : {};
    } catch {
        return {};
    }
}

function luaString(value: string): string {
    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** MediaWiki titles are case-insensitive on the first character only. */
function normalizePageTitle(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    return `${trimmed[0]?.toUpperCase() ?? ""}${trimmed.slice(1)}`;
}

async function wikiGet<T>(params: Record<string, string>): Promise<T> {
    const url = `${WIKI_API}?${new URLSearchParams(params).toString()}`;
    const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!response.ok) {
        throw new Error(`wiki API responded ${response.status} ${response.statusText} for ${url}`);
    }
    return (await response.json()) as T;
}

async function fetchDropRows(page: string): Promise<BucketRow[]> {
    const query =
        "bucket('dropsline')" +
        ".select('page_name','page_name_sub','item_name','drop_json','rare_drop_table')" +
        `.where('page_name', ${luaString(page)})` +
        ".run()";
    const payload = await wikiGet<BucketResponse>({
        action: "bucket",
        format: "json",
        formatversion: "2",
        query,
    });
    const error = bucketError(payload);
    if (error) throw new Error(`wiki bucket error: ${error}`);
    return payload.bucket ?? [];
}

type MonsterRow = {
    page_name?: string;
    page_name_sub?: string;
    id?: string[];
    combat_level?: number;
    version_anchor?: string;
    default_version?: boolean;
};

/**
 * Maps a cache npc type id onto the wiki monster page that lists it. The wiki
 * stores one row per infobox version, so a single id can return several rows
 * (often the same page with different anchors).
 */
async function resolveMonsterRows(npcId: number): Promise<MonsterRow[]> {
    const query =
        "bucket('infobox_monster')" +
        ".select('page_name','page_name_sub','id','combat_level','version_anchor','default_version')" +
        `.where('id', ${luaString(String(npcId))})` +
        ".run()";
    const payload = await wikiGet<BucketResponse & { bucket?: MonsterRow[] | null }>({
        action: "bucket",
        format: "json",
        formatversion: "2",
        query,
    });
    const error = bucketError(payload);
    if (error) throw new Error(`wiki bucket error: ${error}`);
    return payload.bucket ?? [];
}

/** Used when a name does not match a page title exactly (disambiguation). */
async function searchPages(term: string): Promise<string[]> {
    const payload = await wikiGet<{ query?: { search?: Array<{ title?: string }> } }>({
        action: "query",
        list: "search",
        srsearch: term,
        srlimit: "8",
        format: "json",
        formatversion: "2",
    });
    return (payload.query?.search ?? [])
        .map((hit) => text(hit.title))
        .filter((title) => title.length > 0);
}

function formatId(row: ResolvedDrop): string {
    return row.itemId === undefined ? "?" : String(row.itemId);
}

function rowNotes(row: ResolvedDrop): string[] {
    const notes = [...row.problems];
    if (row.resolvedName && row.resolvedName !== row.itemName) {
        notes.push(`resolves to "${row.resolvedName}"`);
    }
    return notes;
}

function printSection(section: Section): void {
    const always = section.rows.filter(isAlways);
    const random = section.rows.filter((row) => !isAlways(row));
    const total = random.reduce((sum, row) => sum + (row.probability ?? 0), 0);
    console.log("");
    console.log(
        `== ${section.key} ==  ${section.rows.length} row(s): always ${always.length}, random ${random.length}` +
            (random.length > 0
                ? `, probability sum ${total.toFixed(4)} (nothing ${(100 * (1 - Math.min(1, total))).toFixed(2)}%)`
                : ""),
    );
    console.log("      id  qty         rarity      prob       rolls  item");
    for (const row of section.rows) {
        const id = formatId(row).padStart(8);
        const quantity = row.quantity.padEnd(11);
        const rarity = row.rarity.padEnd(11);
        const probability = (row.probability === undefined ? "n/a" : row.probability.toFixed(5)).padStart(9);
        const rolls = String(row.rolls).padStart(5);
        const flags: string[] = [];
        if (row.membersOnly) flags.push("(m)");
        if (row.rareDropTable) flags.push("RDT");
        if (row.dropLevel) flags.push(`lvl ${row.dropLevel}`);
        const notes = rowNotes(row);
        const suffix = [flags.join(" "), notes.join("; ")].filter((part) => part.length > 0).join(" | ");
        console.log(
            `    ${id}  ${quantity} ${rarity} ${probability} ${rolls}  ${row.itemName}${suffix ? `  [${suffix}]` : ""}`,
        );
    }
}

function printTable(page: string, sections: readonly Section[], rowCount: number): void {
    console.log("");
    console.log(`${page} → ${WIKI_PAGE}${encodeURIComponent(page.replace(/ /g, "_"))}`);
    console.log(`${sections.length} drop table(s), ${rowCount} wiki row(s)`);
    for (const section of sections) printSection(section);

    const flagged = sections
        .flatMap((section) => section.rows.map((row) => ({ section: section.key, row })))
        .filter((entry) => entry.row.problems.length > 0);
    console.log("");
    if (flagged.length === 0) {
        console.log("All rows map cleanly onto data/items.json and the drop helpers.");
        return;
    }
    console.log(`${flagged.length} row(s) need attention before they can be used verbatim:`);
    for (const entry of flagged) {
        console.log(`  - ${entry.row.itemName} (${entry.section}): ${entry.row.problems.join("; ")}`);
    }
}

function dropLiteral(row: ResolvedDrop): string {
    const quantity = /^\d+$/.test(row.quantity) ? Number(row.quantity) : row.quantity;
    return `drop(${JSON.stringify(row.itemName)}, ${JSON.stringify(quantity)}, ${JSON.stringify(row.rarity)})`;
}

function dropComment(row: ResolvedDrop): string {
    const notes: string[] = [];
    if (row.membersOnly) notes.push("(m) members-only");
    if (row.rareDropTable) notes.push("rare drop table");
    if (row.rarityNotes) notes.push(`wiki: ${row.rarityNotes}`);
    if (row.resolvedName && row.resolvedName !== row.itemName) notes.push(`resolves to "${row.resolvedName}"`);
    for (const problem of row.problems) notes.push(problem);
    return notes.length > 0 ? ` // ${notes.join("; ")}` : "";
}

function printTypeScript(page: string, sections: readonly Section[]): void {
    console.log("");
    console.log("// Paste into src/game/drops/manualTables.ts (MANUAL_NPC_DROP_OVERRIDES).");
    console.log(
        `// Source: ${WIKI_PAGE}${encodeURIComponent(page.replace(/ /g, "_"))} (fetched ${new Date().toISOString()})`,
    );
    for (const section of sections) {
        const always = section.rows.filter(isAlways);
        const random = section.rows.filter((row) => !isAlways(row));
        console.log("{");
        console.log(`    // ${section.key}`);
        console.log("    npcTypeIds: [/* TODO: npc type ids that share this drop table */],");
        console.log("    table: {");
        if (always.length > 0) {
            console.log("        always: [");
            for (const row of always) console.log(`            ${dropLiteral(row)},${dropComment(row)}`);
            console.log("        ],");
        }
        if (random.length > 0) {
            console.log("        pools: [");
            console.log("            {");
            console.log('                kind: "weighted",');
            console.log('                category: "main",');
            console.log("                entries: [");
            for (const row of random) console.log(`                    ${dropLiteral(row)},${dropComment(row)}`);
            console.log("                ],");
            console.log("            },");
            console.log("        ],");
        }
        console.log("    },");
        console.log("},");
    }
}

function parseArgs(argv: readonly string[]): Options | undefined {
    const options: Options = { page: "", emitTs: false, json: false, raw: false };
    const terms: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i] ?? "";
        if (arg === "--help" || arg === "-h") return undefined;
        if (arg === "--ts") {
            options.emitTs = true;
            continue;
        }
        if (arg === "--json") {
            options.json = true;
            continue;
        }
        if (arg === "--raw") {
            options.raw = true;
            continue;
        }
        if (arg === "--npc") {
            const value = Number.parseInt(argv[i + 1] ?? "", 10);
            if (Number.isFinite(value) && value > 0) {
                options.npcId = value;
                i++;
            }
            continue;
        }
        terms.push(arg);
    }
    options.page = terms.join(" ").trim();
    if (options.page.length === 0 && options.npcId === undefined) return undefined;
    return options;
}

function printUsage(): void {
    console.log('Usage: yarn wiki-drops "<npc page title>" [--ts] [--json] [--raw]');
    console.log("       yarn wiki-drops --npc <npcTypeId> [--ts] [--json] [--raw]");
    console.log("");
    console.log("Examples:");
    console.log("  yarn wiki-drops Goblin");
    console.log('  yarn wiki-drops "Moss giant" --ts');
    console.log("  yarn wiki-drops --npc 2245");
    console.log('  yarn wiki-drops "King Black Dragon" --json > /tmp/kbd.json');
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (!options) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    let page = normalizePageTitle(options.page);
    if (options.npcId !== undefined) {
        const monsters = await resolveMonsterRows(options.npcId);
        if (monsters.length === 0) {
            console.log(`No OSRS wiki monster page lists npc id ${options.npcId}.`);
            process.exitCode = 1;
            return;
        }
        for (const monster of monsters) {
            const anchor = monster.version_anchor ? ` (${monster.version_anchor})` : "";
            const level = monster.combat_level !== undefined ? ` combat ${monster.combat_level}` : "";
            console.log(`npc ${options.npcId} → ${monster.page_name ?? "?"}${anchor}${level}`);
        }
        page = normalizePageTitle(text(monsters[0]?.page_name).split("#")[0] ?? "");
    }
    if (page.length === 0) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    const rows = await fetchDropRows(page);
    if (rows.length === 0) {
        console.log(`No drop rows found for wiki page "${page}".`);
        const suggestions = await searchPages(options.page.length > 0 ? options.page : page);
        if (suggestions.length > 0) {
            console.log("The wiki search API suggests these pages:");
            for (const suggestion of suggestions) console.log(`  ${suggestion}`);
        }
        process.exitCode = 1;
        return;
    }

    if (options.raw) {
        console.log(JSON.stringify(rows, null, 2));
        return;
    }

    const sections = buildSections(page, rows);
    if (options.json) {
        console.log(JSON.stringify({ page, sections }, null, 2));
        return;
    }

    printTable(page, sections, rows.length);
    if (options.emitTs) printTypeScript(page, sections);
}

main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
});

