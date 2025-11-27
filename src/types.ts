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

export type AccessType = "everyone" | "restricted" | "none";

export interface Config {
    inputAccess: AccessType;
    outputAccess: AccessType;
    backupUrl: string | null;
    parentUrl: string | null; // unused for now
}

export interface TimeLimits {
    lb4: number;
    lb5: number;
}

export interface InstanceMeta {
    timeLimits: TimeLimits;
    theme: string;
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
