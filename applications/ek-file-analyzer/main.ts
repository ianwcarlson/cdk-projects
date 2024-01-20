import fs from "fs";
import path from "path";
import { pipeline } from "stream";
import { promisify } from "util";

import sax from "sax";

const LOG_THRESHOLD = 500;

const saxStream = sax.createStream(true, {});

const DEEPER = "DEEPER";
const SHALLOWER = "SHALLOWER";
const traverseDirectionHistory = [];

async function main() {
  let currentPath = "root.0";
  const keyValueMap = new Map<string, string>();
  const keyCountMap = new Map<string, number>();

  saxStream.on("error", function (e) {
    // unhandled errors will throw, since this is a proper node
    // event emitter.
    console.error("error!", e);
    // clear the error
    // this._parser.error = null
    // this._parser.resume()
  });
  saxStream.on("opentag", function (node) {
    const pathForCounts = currentPath + "." + node.name;
    const currentKeyCount = keyCountMap.get(pathForCounts) || 1;

    keyCountMap.set(pathForCounts, currentKeyCount + 1);

    currentPath = pathForCounts + "." + (currentKeyCount - 1).toString();

    const previousText = keyValueMap.get(currentPath);
    if (previousText) {
      currentPath = incrementCurrentPath(currentPath);
    }
  });
  saxStream.on("text", function (text) {
    // Remove uncessary formatting
    const filteredText = text.replace(/(\r\n|\n|\r)/gm, "");
    const removeDoubleSpaces = filteredText.replace(/\s+/g, " ").trim();
    if (removeDoubleSpaces.length > 0) {
      keyValueMap.set(currentPath, removeDoubleSpaces);
    }
  });
  saxStream.on("closetag", function (node) {
    // same object as above
    const splitPath = currentPath.split(".");
    const removeLastTwoElements = splitPath.slice(0, splitPath.length - 2);
    currentPath = removeLastTwoElements.join(".");

    if (currentPath.length < LOG_THRESHOLD) {
      console.log("closetag: ", currentPath); 
    }
  });
  // pipe is supported, and it's readable/writable
  // same chunks coming in also go out.
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(path.resolve(__dirname, "sample.xml"))
    .pipe(saxStream)
    .on('end', () => {
      console.log('CSV file successfully processed');
      resolve();
    })
    .on('error', reject); 
  });
  console.log("keyValueMap: ",[...keyValueMap.entries()]);

}

function incrementCurrentPath(currentPath: string) {
  const countString = currentPath.substring(currentPath.lastIndexOf(".") + 1);
  const count = parseInt(countString);

  const newCount = count + 1;

  return currentPath.substring(0, currentPath.lastIndexOf(".") + 1) + (newCount).toString();
}

main().then();
