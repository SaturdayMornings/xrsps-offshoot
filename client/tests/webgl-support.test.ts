/**
 * Regression coverage for the client's boot-time WebGL feature detection.
 *
 * The client used to evaluate `getContext("webgl2")` exactly once, at module
 * load, and treat a single failure as permanent: a browser whose GPU process was
 * not up yet (or that had temporarily blocked WebGL) rendered a black screen
 * reading "No renderers available" until the tab was fully reloaded.
 *
 * Covers:
 *  - probeWebGL2Support() success / null / throwing paths
 *  - the probe releases its context (leaked probe contexts push the real
 *    renderer towards the browser's per-page WebGL context cap)
 *  - refreshWebGL2Support() upgrades the shared flag once support appears and
 *    never downgrades an already-supported flag
 *  - detectAvailableRenderers() retries a failing probe before giving up
 *
 * Run with: npx tsx tests/webgl-support.test.ts
 */
import assert from "node:assert/strict";

import type { OsrsRendererType } from "../game/GameRenderers";

type ProbeResult = "ok" | "null" | "throw";

let webgl2Result: ProbeResult = "null";
let webgl1Result: "ok" | "null" = "null";
let lostContexts = 0;

function makeContext() {
    return {
        getExtension(name: string) {
            if (name !== "WEBGL_lose_context") return null;
            return {
                loseContext() {
                    lostContexts++;
                },
            };
        },
    };
}

function installFakeDocument() {
    (globalThis as any).document = {
        documentElement: undefined,
        createElement() {
            return {
                getContext(id: string) {
                    if (id === "webgl2") {
                        if (webgl2Result === "throw") throw new Error("context creation threw");
                        return webgl2Result === "ok" ? makeContext() : null;
                    }
                    if (id === "webgl") {
                        return webgl1Result === "ok" ? makeContext() : null;
                    }
                    return null;
                },
            };
        },
    };
}

async function main(): Promise<void> {
    installFakeDocument();
    const device = await import("../common/utils/DeviceUtil");
    const { detectAvailableRenderers } = await import("../game/RendererDetection");

    // The import-time probe ran without WebGL2, so the shared flag starts false.
    assert.equal(device.isWebGL2Supported, false, "boot without WebGL2 must start unsupported");

    // 1. Probe paths: null context, throwing getContext, usable context.
    assert.equal(device.probeWebGL2Support(), false, "null context means unsupported");
    webgl2Result = "throw";
    assert.equal(device.probeWebGL2Support(), false, "a throwing getContext must not bubble");
    webgl2Result = "ok";
    assert.equal(device.probeWebGL2Support(), true, "a WebGL2 context means supported");
    assert.equal(lostContexts, 1, "the probe context must be released after probing");

    // 2. Diagnostics shown on the error screen.
    assert.match(
        device.describeWebGL2Support(),
        /available now/i,
        "an available context must be reported as such",
    );
    webgl2Result = "null";
    webgl1Result = "ok";
    assert.match(
        device.describeWebGL2Support(),
        /WebGL1 but not WebGL2/,
        "a WebGL1-only browser must be called out explicitly",
    );
    webgl1Result = "null";
    assert.match(
        device.describeWebGL2Support(),
        /no WebGL context at all/,
        "a browser without any context must be called out explicitly",
    );

    // 3. Refreshing recovers a boot-time failure and never downgrades support.
    assert.equal(device.refreshWebGL2Support(), false, "still unsupported while no context exists");
    webgl2Result = "ok";
    assert.equal(device.refreshWebGL2Support(), true, "a later probe must upgrade support");
    assert.equal(
        device.isWebGL2Supported,
        true,
        "importers must observe the refreshed (live) flag",
    );
    webgl2Result = "null";
    assert.equal(device.refreshWebGL2Support(), true, "support must never downgrade");
    assert.equal(device.isWebGL2Supported, true, "flag must stay upgraded once seen");

    // 4. Boot detection retries instead of failing on the first empty probe.
    let retryingCalls = 0;
    const recovered = await detectAvailableRenderers(
        () => {
            retryingCalls++;
            return retryingCalls < 2 ? [] : (["webgl"] as OsrsRendererType[]);
        },
        { attempts: 3, delayMs: 1 },
    );
    assert.deepEqual(recovered, ["webgl"], "a later successful probe must be used");
    assert.equal(retryingCalls, 2, "detection must stop retrying once a renderer is found");

    let givingUpCalls = 0;
    const none = await detectAvailableRenderers(
        () => {
            givingUpCalls++;
            return [] as OsrsRendererType[];
        },
        { attempts: 3, delayMs: 1 },
    );
    assert.deepEqual(none, [], "no renderers when every probe fails");
    assert.equal(givingUpCalls, 3, "detection must retry the configured number of times");

    let immediateCalls = 0;
    const immediate = await detectAvailableRenderers(
        () => {
            immediateCalls++;
            return ["webgl"] as OsrsRendererType[];
        },
        { attempts: 3, delayMs: 1 },
    );
    assert.deepEqual(immediate, ["webgl"], "a working probe must be returned as-is");
    assert.equal(immediateCalls, 1, "a first-attempt success must not retry");

    // 5. Outside a browser document the probe must not throw.
    const savedDocument = (globalThis as any).document;
    delete (globalThis as any).document;
    assert.equal(device.probeWebGL2Support(), false, "no document means unsupported");
    assert.match(
        device.describeWebGL2Support(),
        /browser document/,
        "a missing document must be reported",
    );
    (globalThis as any).document = savedDocument;

    console.log("WebGL support detection regression test passed");
}

void main();
