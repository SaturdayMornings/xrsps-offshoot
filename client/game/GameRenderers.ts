import { refreshWebGL2Support } from "../common/utils/DeviceUtil";
import { GameRenderer } from "./GameRenderer";
import { OsrsClient } from "./OsrsClient";
import { WebGLOsrsRenderer } from "../render/WebGLOsrsRenderer";

export type OsrsRendererType = "webgl";
export const WEBGL: OsrsRendererType = "webgl";

export function getRendererName(type: OsrsRendererType): string {
    switch (type) {
        case WEBGL:
            return "WebGL";
        default:
            throw new Error("Unknown renderer type");
    }
}

export function createRenderer(type: OsrsRendererType, osrsClient: OsrsClient): GameRenderer {
    switch (type) {
        case WEBGL:
            return new WebGLOsrsRenderer(osrsClient);
        default:
            throw new Error("Unknown renderer type");
    }
}

export function getAvailableRenderers(): OsrsRendererType[] {
    // Re-probe before answering: the very first probe runs while the bundle is
    // being evaluated, and a GPU process that is not up yet makes the browser
    // refuse the context. Without this refresh that transient failure wedged the
    // client on "No renderers available" until the tab was reloaded. Once support
    // has been seen the refresh is a no-op, so normal play pays nothing.
    refreshWebGL2Support();

    const renderers: OsrsRendererType[] = [];

    if (WebGLOsrsRenderer.isSupported()) {
        renderers.push(WEBGL);
    }

    return renderers;
}
