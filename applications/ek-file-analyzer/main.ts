import fs from "fs";
import path from "path";

import sax from "sax";

import { DocumentSubmitter } from "./document-submitter";

const PATH_DELIMITER = "/";

async function main() {
  const saxStream = sax.createStream(true, {});
  let currentPath = `root${PATH_DELIMITER}0`;
  const keyValueMap = new Map<string, string>();
  const keyCountMap = new Map<string, number>();
  const attributesMap = new Map<string, Map<string, string>>();
  const documentSubmitter = new DocumentSubmitter();
  await documentSubmitter.initialize();

  saxStream.on("error", function (e) {
    // unhandled errors will throw, since this is a proper node
    // event emitter.
    // console.error("error!", e);
    // clear the error
    // @ts-ignore
    this._parser.error = null
    this._parser.resume()
  });

  saxStream.on("opentag", async function (node) {
    const pathForCounts = currentPath + PATH_DELIMITER + node.name;
    const currentKeyCount = keyCountMap.get(pathForCounts) || 1;

    keyCountMap.set(pathForCounts, currentKeyCount + 1);

    currentPath =
      pathForCounts + PATH_DELIMITER + (currentKeyCount - 1).toString();

    const previousText = keyValueMap.get(currentPath);
    if (previousText) {
      currentPath = incrementCurrentPath(currentPath);
    }

    if (Object.keys(node.attributes).length > 0) {
      // console.log("currentPath: ", currentPath);
      attributesMap.set(currentPath, new Map(Object.entries(node.attributes)));
      await documentSubmitter.addAttributeDocument({ attributesMap });
    }
    attributesMap.clear();
  });

  saxStream.on("text", async function (text) {
    // Remove uncessary formatting
    const filteredText = text.replace(/(\r\n|\n|\r)/gm, "");
    const removeDoubleSpaces = filteredText.replace(/\s+/g, " ").trim();
    if (removeDoubleSpaces.length > 0) {
      // Only persist if the information is useful
      keyValueMap.set(currentPath, removeDoubleSpaces);
      // console.log("keyValueMap: ", JSON.stringify([...keyValueMap.entries()], null, 2));
      // console.log("currentPath: ", currentPath, "removeDoubleSpaces: ", removeDoubleSpaces);
      await documentSubmitter.addDocument({ keyValueMap });
    }
    keyValueMap.clear();
  });

  saxStream.on("closetag", function (node) {
    // same object as above
    const splitPath = currentPath.split(PATH_DELIMITER);
    const removeLastTwoElements = splitPath.slice(0, splitPath.length - 2);
    currentPath = removeLastTwoElements.join(PATH_DELIMITER);
  });
  // pipe is supported, and it's readable/writable
  // same chunks coming in also go out.
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(path.resolve(__dirname, "sample6.html"))
      .pipe(saxStream)
      .on("end", () => {
        console.log("!!!!!!!XML file successfully processed!!!!!!!!!!");
        resolve();
      })
      .on("finish", () => {
        console.log("!!!!DONE!!!!");
        resolve();
      })
      .on("error", () => {
        console.error("Error processing XML file");
        // reject();
      });
  });
  // console.log("keyValueMap: ",[...keyValueMap.entries()]);
  // console.log("attributesMap: ",[...attributesMap.entries()]);
  console.log("Flushing documents")
  await documentSubmitter.flush();
  console.log("Finished processing file");
}

function incrementCurrentPath(currentPath: string) {
  const countString = currentPath.substring(
    currentPath.lastIndexOf(PATH_DELIMITER) + 1,
  );
  const count = parseInt(countString);

  const newCount = count + 1;

  return (
    currentPath.substring(0, currentPath.lastIndexOf(PATH_DELIMITER) + 1) +
    newCount.toString()
  );
}

main().then();
