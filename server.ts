interface ScoreEntry {
    name: string;
    score: number;
}

var scores: ScoreEntry[] = [
    {
        name: "Placeholder",
        score: 0,
    }
];

const clients = new Map();

function broadcast(msg) {
    clients.forEach(websocket => {
        if (websocket.isClosed) return;
        websocket.send(msg);
    });
}

function broadcastScores() {
    broadcast(JSON.stringify(scores));
}

Deno.serve((req) => {
    if (req.headers.get("upgrade") != "websocket") {
        return new Response(null, { status: 501 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req);

    const clientId = crypto.randomUUID();
    clients.set(clientId, socket);

    // Send current scores to newly connected client
    socket.addEventListener("open", () => {
        console.log(`client ${clientId} connected!`);
        socket.send(JSON.stringify(scores));
        broadcast(`@nclients:${clients.size}`)
    });

    socket.addEventListener("message", (event) => {
        console.log(`received from ${clientId}`)
        if (event.data == "refresh-all") {
            scores.sort((a, b) => b.score - a.score);
            broadcastScores();
            return;
        }
        if (event.data == "refresh") {
            socket.send(JSON.stringify(scores));
            return;
        }
        if (event.data == "clear") {
            scores = [];
            broadcastScores();
            return;
        }
        const obj = JSON.parse(event.data);
        if (obj.type === "update") { // new api
            scores = obj.leaderboard;
            scores.sort((a, b) => b.score - a.score);
            broadcastScores();
        } else if (obj.type === "add") { // old api
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
