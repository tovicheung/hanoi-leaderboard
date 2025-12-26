export type Auth = { type: "none" }
    | { type: "admin" }
    | { type: "token", token: string, expireIn: number }
    | { type: "elevated", timestamp: number };

export interface Client {
    socket: WebSocket;
    connectTimestamp: number;
    role: string; // not strict, purely informative
    auth: Auth;
    userAgent: string | null;
}

export interface Config {
    inputAccess: "everyone" | "restricted" | "none";
    outputAccess: "everyone" | "restricted";
    backupUrl: string | null;
    parentUrl: string | null; // unused for now
}

// if inputAccess is everyone, outputAccess must be veryone

export interface TimeLimits {
    lb4: number;
    lb5: number;
}

export interface InstanceMeta {
    timeLimits: TimeLimits;
    theme: string;
    naming: string;
}

export interface LbRecord {
    name: string;
    score: number;
}

export type Leaderboard = LbRecord[];

export type HanoiData = {
    lb4: Leaderboard;
    lb5: Leaderboard;
}

export type TokensData = Record<string, number>;
