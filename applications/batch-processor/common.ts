import path from "path";
import fs from "fs";

import { promisify } from "util";
const writeFilePromise = promisify(fs.writeFile);

export async function writeToHeartbeatFile() {
  const heartbeatFile = path.join(path.join(__dirname), "heartbeat.json");
  await writeFilePromise(
    heartbeatFile,
    JSON.stringify({ heartBeat: Date.now() }),
  );
}
