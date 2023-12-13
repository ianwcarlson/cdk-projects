import { orchestrator } from "./orchestrator";

async function fetchInputData() {
  return [1, 2, 3];
}

orchestrator({
  handleGenerateInputData: fetchInputData,
  workerRunCommand: ["node", "--enable-source-maps", "dist/worker-example.js"],
}).then();
