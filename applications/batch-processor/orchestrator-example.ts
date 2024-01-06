import { orchestrator } from "./orchestrator";

async function fetchInputData() {
  return Array.from(new Array(21)).map((_, i) => i);
}

console.log("orchestrator-example: starting");

orchestrator({
  handleGenerateInputData: fetchInputData,
  workerRunCommand: ["node worker-example.js"],
}).then();
