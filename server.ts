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

function broadcastScores() {
    const message = JSON.stringify(scores);
    clients.forEach(websocket => {
        if (websocket.isClosed) return;
        websocket.send(message);
    });
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
        if (obj.type === "add") {
            const name = obj.name;
            const score = obj.score;
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
    })
  return response;
});
