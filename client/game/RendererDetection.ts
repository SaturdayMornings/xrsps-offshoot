import type { OsrsRendererType } from "./GameRenderers";

/** Boot-time detection budget: three probes, half a second apart. */
export const RENDERER_DETECTION_ATTEMPTS = 3;
export const RENDERER_DETECTION_DELAY_MS = 500;

export interface RendererDetectionOptions {
    attempts?: number;
    delayMs?: number;
}

/**
 * Detect the renderers the browser can actually run, retrying before giving up.
 *
 * A cold browser start can legitimately report no WebGL2 for the first few
 * hundred milliseconds (GPU process still coming up, driver reset), so a single
 * failed probe must not be treated as "this browser can never run the client".
 * Only the caller decides what to do when the list stays empty.
 *
 * The probe is injected so the retry behaviour can be covered without pulling in
 * the renderer/WebGL module graph.
 */
export async function detectAvailableRenderers(
    probe: () => OsrsRendererType[],
    options: RendererDetectionOptions = {},
): Promise<OsrsRendererType[]> {
    const attempts = Math.max(1, Math.floor(options.attempts ?? RENDERER_DETECTION_ATTEMPTS));
    const delayMs = Math.max(0, options.delayMs ?? RENDERER_DETECTION_DELAY_MS);

    let available = probe();
    for (let attempt = 1; attempt < attempts && available.length === 0; attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        available = probe();
    }
    return available;
}
