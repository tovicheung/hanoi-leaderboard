import { Config } from "./types.ts";

export const DEFAULT_CONFIG: Config = {
    inputAccess: "restricted",
    outputAccess: "everyone", // unused
    backupUrl: null,
    parentUrl: null,
}

// none: function is only accessible by admin
// restricted: function is only accessible by admin and admin-approved sessions
// everyone: function is accessible by all sessions

export function isValidConfig(obj: unknown): obj is Config {
    return (
        typeof obj === "object" &&
        obj !== null &&
        "inputAccess" in obj &&
        typeof obj.inputAccess === "string" &&
        "outputAccess" in obj &&
        typeof obj.outputAccess === "string" &&
        "backupUrl" in obj &&
        (typeof obj.backupUrl === "string" || obj.backupUrl === null) &&
        "parentUrl" in obj &&
        (typeof obj.parentUrl === "string" || obj.parentUrl === null)
    );
}
