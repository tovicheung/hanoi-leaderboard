import { Config, HanoiData, InstanceMeta, TimeLimits, TokensData } from "./types.ts";
import { DEFAULT_CONFIG, isValidConfig } from "./config.ts";
import { broadcast } from "./socket.ts";

export const kv = await Deno.openKv();

export let config: Config = DEFAULT_CONFIG;

export async function setupKv() {
    // Base structure
    // * config
    // * instances/_default
    // * instanceName = "_default"

    const conf = (await kv.get(["config"])).value;
    if (conf === null || !isValidConfig(conf)) {
        await kv.set(["config"], structuredClone(DEFAULT_CONFIG));
        config = structuredClone(DEFAULT_CONFIG);
    } else {
        config = conf;
    }

    if ((await getAllInstanceNames()).length == 0) {
        await createInstance("_default");
    }

    if ((await kv.get(["instanceName"])).value === null) {
        await kv.set(["instanceName"], "_default");
    }
}

export async function updateConfig(newConfig: Config) {
    config = newConfig;
    await kv.set(["config"], config);
}

function getNewMeta(): InstanceMeta {
    return {
        timeLimits: {
            lb4: 3 * 60 * 1000,
            lb5: 4 * 60 * 1000,
        },
        theme: "demonslayer",
        naming: "free",
    };
}

// instance helpers

export async function createInstance(name: string) {
    if (await instanceExists(name)) return;

    await kv.atomic()
        .set(["instances", name, "data"], {
            lb4: [],
            lb5: [],
        })
        .set(["instances", name, "meta"], getNewMeta())
        .commit();
}

export async function getAllInstanceNames() {
    const entries = kv.list({ prefix: ["instances"] });
    const names: string[] = [];
    for await (const entry of entries) {
        if (entry.key.length == 3 && entry.key[2] == "meta") {
            const name = entry.key[1];
            if (typeof name === "string") {
                names.push(name);
            }
        }
    }
    return names;
}

export async function switchInstance(newInstance: string) {
    if (!await instanceExists(newInstance)) return;
    
    broadcast("!reload-all");
    const oldConfig = { ...config };
    const newConfig = { ...config };
    newConfig.inputAccess = "none";
    updateConfig(newConfig);

    await kv.set(["instanceName"], newInstance);
    updateConfig(oldConfig);
    broadcast("!reload-all");
}

export async function instanceExists(name: string) {
    const test = await kv.get(["instances", name, "meta"]);
    return test.value !== null;
}

export async function getActiveName(): Promise<string> {
    return (await kv.get<string>(["instanceName"])).value!;
}

export async function getMeta(): Promise<InstanceMeta> {
    const name = await getActiveName();
    return <InstanceMeta>(await kv.get(["instances", name, "meta"])).value;
}

export async function setMeta(meta: InstanceMeta) {
    const name = await getActiveName();
    await kv.set(["instances", name, "meta"], meta);
}

export async function getTimeLimits(): Promise<TimeLimits> {
    return (await getMeta()).timeLimits;
}

export async function getData(): Promise<HanoiData> {
    const name = await getActiveName();
    return <HanoiData>(await kv.get(["instances", name, "data"])).value;
}

export async function setData(leaderboards: HanoiData) {
    const name = await getActiveName();
    await kv.set(["instances", name, "data"], leaderboards);
}

// TOKEN HELPERS

export async function getTokensData(): Promise<TokensData> {
    const entries = kv.list({ prefix: ["tokens"] });
    const result: TokensData = {};
    for await (const entry of entries) {
        const token = entry.key[1];
        if (typeof token !== "string") continue;
        const expireIn = <number>entry.value;
        result[token] = expireIn;
    }
    return result;
}

export function adminCreateToken(token: string, expireIn: number) {
    const timedelta = expireIn - Date.now();
    kv.set(["tokens", token], expireIn, { expireIn: timedelta });
}

export async function authCheckToken(token: string): Promise<number | false> {
    const tok = await kv.get(["tokens", token]);
    if (tok.value === null) return false;
    if (typeof tok.value !== "number") return false; // invalid token
    if (Date.now() >= tok.value) return false; // expired
    return tok.value;
}
