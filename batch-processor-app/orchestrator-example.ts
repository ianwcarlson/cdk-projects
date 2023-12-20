import { orchestrator } from "./orchestrator";

async function fetchInputData() {
  return [1, 2, 3];
}

console.log("orchestrator-example: starting");

orchestrator({
  handleGenerateInputData: fetchInputData,
  workerRunCommand: ["node worker-example.js"],
}).then();
