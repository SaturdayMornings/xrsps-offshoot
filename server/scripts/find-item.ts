/**
 * Item ID lookup helper.
 *
 * Searches the cache-derived item dump that ships with the server
 * (`server/data/items.json` — the exact file `src/data/items.ts` loads at
 * runtime) by name or by id. Handy when you need a numeric `itemId` for a
 * manual database edit, a drop table, a shop or a spawner.
 *
 * Usage (from the `server/` directory):
 *   yarn find-item whip
 *   yarn find-item "rune platebody" --equip
 *   yarn find-item 4151
 *   yarn find-item rune --stackable --limit 20
 *
 * Flags:
 *   --equip      only items that occupy an equipment slot (equipmentType !== "NONE")
 *   --stackable  only stackable items (rune/arrow/coin style items)
 *   --tradeable  only tradeable items
 *   --limit N    max rows to print (default 25)
 */
import fs from "fs";
import path from "path";

const ITEMS_PATH = path.resolve(__dirname, "../data/items.json");
const DEFAULT_LIMIT = 25;

type RawItem = {
    id: number;
    name?: string;
    stackable?: boolean;
    tradeable?: boolean;
    noted?: boolean;
    noteId?: number;
    equipmentType?: string;
    value?: number;
};

type Options = {
    query: string;
    onlyEquip: boolean;
    onlyStackable: boolean;
    onlyTradeable: boolean;
    limit: number;
};

function loadItems(): RawItem[] {
    const parsed: unknown = JSON.parse(fs.readFileSync(ITEMS_PATH, "utf8"));
    if (!Array.isArray(parsed)) {
        throw new Error(`${ITEMS_PATH} must contain a JSON array`);
    }
    return parsed as RawItem[];
}

function parseArgs(argv: readonly string[]): Options | undefined {
    const options: Options = {
        query: "",
        onlyEquip: false,
        onlyStackable: false,
        onlyTradeable: false,
        limit: DEFAULT_LIMIT,
    };
    const terms: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i] ?? "";
        if (arg === "--help" || arg === "-h") return undefined;
        if (arg === "--equip") {
            options.onlyEquip = true;
            continue;
        }
        if (arg === "--stackable") {
            options.onlyStackable = true;
            continue;
        }
        if (arg === "--tradeable") {
            options.onlyTradeable = true;
            continue;
        }
        if (arg === "--limit") {
            const value = Number.parseInt(argv[++i] ?? "", 10);
            options.limit = Number.isFinite(value) && value > 0 ? value : DEFAULT_LIMIT;
            continue;
        }
        terms.push(arg);
    }
    options.query = terms.join(" ").trim();
    return options.query.length === 0 ? undefined : options;
}

function matchesQuery(item: RawItem, options: Options): boolean {
    const name = (item.name ?? "").toLowerCase();
    if (options.onlyEquip && (item.equipmentType ?? "NONE") === "NONE") return false;
    if (options.onlyStackable && !item.stackable) return false;
    if (options.onlyTradeable && !item.tradeable) return false;

    // Numeric queries are exact id lookups; anything else is a name search.
    if (/^\d+$/.test(options.query)) {
        return item.id === Number.parseInt(options.query, 10);
    }
    return name.includes(options.query.toLowerCase());
}

function describe(item: RawItem): string {
    const flags: string[] = [];
    const equipmentType = item.equipmentType ?? "NONE";
    if (equipmentType !== "NONE") flags.push(`equip=${equipmentType}`);
    if (item.stackable) flags.push("stackable");
    if (!item.tradeable) flags.push("untradeable");
    if (item.noted && item.noteId !== undefined && item.noteId >= 0) {
        flags.push(`noteId=${item.noteId}`);
    }
    return flags.join(" ");
}

function printUsage(): void {
    console.log(
        "Usage: yarn find-item <name|itemId> [--equip] [--stackable] [--tradeable] [--limit N]",
    );
    console.log("");
    console.log("Examples:");
    console.log('  yarn find-item whip');
    console.log('  yarn find-item "rune platebody" --equip');
    console.log("  yarn find-item 4151");
}

function main(): void {
    const options = parseArgs(process.argv.slice(2));
    if (!options) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    const items = loadItems();
    const hits = items.filter((item) => matchesQuery(item, options));
    if (hits.length === 0) {
        console.log(
            `No item matched "${options.query}" in ${path.relative(process.cwd(), ITEMS_PATH)}.`,
        );
        console.log(
            "This dump only holds cache items; custom items live in client/custom/items/*.",
        );
        return;
    }

    const shown = hits.slice(0, options.limit);
    for (const item of shown) {
        const id = String(item.id).padStart(6);
        const name = (item.name ?? "<unnamed>").padEnd(34);
        console.log(`${id}  ${name}  ${describe(item)}`);
    }

    if (hits.length > shown.length) {
        console.log(`... ${hits.length - shown.length} more match(es); raise --limit to see them.`);
    }

    console.log("");
    console.log(`${hits.length} match(es). Inventory entry shape (pick a free slot 0-27):`);
    console.log(`  {"slot":0,"itemId":${shown[0]?.id ?? 0},"quantity":1}`);
}

main();
