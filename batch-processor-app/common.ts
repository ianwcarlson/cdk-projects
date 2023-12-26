import path from "path";
import fs from "fs";

export async function writeToHeartbeatFile() {
  const heartbeatFile = path.join(path.join(__dirname), "heartbeat.json");

  // todo, make this async
  fs.writeFileSync(heartbeatFile, JSON.stringify({ heartBeat: Date.now() }));
}
