import fs from "fs";
import path from "path";

import { SaxesParser } from "saxes";

import { DocumentSubmitter } from "./document-submitter";

const PATH_DELIMITER = "/";
const READ_BUFFER_SIZE = 4096;
const FileName = "sample3.xml";
const RootPath = `${FileName}${PATH_DELIMITER}0`

const pathsToOmit = [
  /.*\/0\/CATALOG\/0\/CD\/\d+\/TITLE\/0/
];

async function main() {
  const saxStream = new SaxesParser();
  let currentPath = RootPath;
  const keyValueMap = new Map<string, string>();
  const keyCountMap = new Map<string, number>();
  const attributesMap = new Map<string, Map<string, string>>();
  const documentSubmitter = new DocumentSubmitter();
  await documentSubmitter.initialize();

  saxStream.on("error", function (e) {
    console.error("error", e);
  });

  saxStream.on("opentag", async function (node) {
    // console.log("currentPath: ", currentPath);

    const pathForCounts = currentPath + PATH_DELIMITER + node.name;
    const currentKeyCount = keyCountMap.get(pathForCounts) || 1;

    keyCountMap.set(pathForCounts, currentKeyCount + 1);

    currentPath =
      pathForCounts + PATH_DELIMITER + (currentKeyCount - 1).toString();

    const previousText = keyValueMap.get(currentPath);
    if (previousText) {
      currentPath = incrementCurrentPath(currentPath);
    }

    const omitted = pathsToOmit.some((pathToOmit) => pathToOmit.test(currentPath));

    if (Object.keys(node.attributes).length > 0 && !omitted) {
      attributesMap.set(currentPath, new Map(Object.entries(node.attributes)));
      await documentSubmitter.addAttributeDocument({ attributesMap });
    }
    attributesMap.clear();
  });

  saxStream.on("text", async function (text) {
    const omitted = pathsToOmit.some((pathToOmit) => pathToOmit.test(currentPath));
    // Remove uncessary formatting
    const filteredText = text.replace(/(\r\n|\n|\r)/gm, "");
    const removeDoubleSpaces = filteredText.replace(/\s+/g, " ").trim();
    if (removeDoubleSpaces.length > 0 && !omitted) {
      // Only persist if the information is useful
      keyValueMap.set(currentPath, removeDoubleSpaces);
      await documentSubmitter.addDocument({ keyValueMap });
    }
    keyValueMap.clear();
  });

  saxStream.on("closetag", function (node) {
    keyCountMap.delete(currentPath);
    // Not sure how to use string interpolation with path delimiter here
    // Need to not split on escaped path delimiters
    const splitPath = currentPath.match(/(\\.|[^\/])+/g);
    if (splitPath) {
      const removeLastTwoElements = splitPath.slice(0, splitPath.length - 2);
      currentPath = removeLastTwoElements.join(PATH_DELIMITER);
    } else {
      console.error("Error parsing path: ", currentPath);
    }
  });

  const input = fs.createReadStream(path.resolve(__dirname, FileName));
  const start = Date.now();

  await new Promise<void>((resolve, reject) => {
    input.on("readable", () => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const chunk = input.read(READ_BUFFER_SIZE);
        if (chunk === null) {
          return;
        }
  
        saxStream.write(chunk);
      }
    });
  
    input.on("end", () => {
      saxStream.close();

      resolve();
    });
  })

  console.log("Flushing documents");
  await documentSubmitter.flush();
  console.log("Finished processing file");
  console.log(`Parsing time: ${Date.now() - start}`);
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
