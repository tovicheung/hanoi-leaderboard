interface ScoreEntry {
    name: string;
    score: number;
}

var scores: ScoreEntry[] = [];

const clients = new Map();

function broadcast(msg) {
    clients.forEach(websocket => {
        if (websocket.isClosed) return;
        websocket.send(msg);
    });
}

async function broadcastScores() {
    const kv = await Deno.openKv();
    broadcast(JSON.stringify(scores));
    kv.set(["scores"], scores);
}

Deno.serve(async (req) => {
    if (req.headers.get("upgrade") != "websocket") {
        return new Response(null, { status: 501 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req);

    const clientId = crypto.randomUUID();
    clients.set(clientId, socket);

    const kv = await Deno.openKv();

    // Send current scores to newly connected client
    socket.addEventListener("open", () => {
        console.log(`client ${clientId} connected!`);
        socket.send(JSON.stringify(scores));
        broadcast(`@nclients:${clients.size}`)
    });

    socket.addEventListener("message", async (event) => {
        console.log(`received from ${clientId}`)
        scores = await kv.get(["scores"]);
        if (event.data == "refresh-all") {
            scores.sort((a, b) => a.score - b.score);
            await broadcastScores();
            return;
        }
        if (event.data == "refresh") {
            socket.send(JSON.stringify(scores));
            return;
        }
        if (event.data == "clear") {
            scores = [];
            await broadcastScores();
            return;
        }
        const obj = JSON.parse(event.data);
        if (obj.type === "update") { // new api
            scores = obj.leaderboard;
            scores.sort((a, b) => a.score - b.score);
            await broadcastScores();
        }
        if (obj.type === "add") { // old api
            const name = obj.name;
            const score = obj.score;
            const current = obj.current;
            if (scores.length != current.length) {
                scores = current;
            }
            scores.push({
                name: name,
                score: score,
            })
            scores.sort((a, b) => b.score - a.score);
            broadcastScores();
        }
    });

    socket.addEventListener("close", () => {
        console.log(`client ${clientId} disconnected!`);
        clients.delete(clientId);
        broadcast(`@nclients:${clients.size}`)
    })
  return response;
});
