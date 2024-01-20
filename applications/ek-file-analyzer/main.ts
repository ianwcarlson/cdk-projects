import fs from "fs";
import { at } from "lodash";
import path from "path";

import sax from "sax";

const saxStream = sax.createStream(true, {});

async function main() {
  let currentPath = "root.0";
  const keyValueMap = new Map<string, string>();
  const keyCountMap = new Map<string, number>();
  const attributesMap = new Map<string, Map<string, string>>();

  saxStream.on("error", function (e) {
    // unhandled errors will throw, since this is a proper node
    // event emitter.
    console.error("error!", e);
    // clear the error
    // this._parser.error = null
    // this._parser.resume()
  });
  saxStream.on("opentag", function (node) {
    // console.log("node: ", node);
    const pathForCounts = currentPath + "." + node.name;
    const currentKeyCount = keyCountMap.get(pathForCounts) || 1;

    keyCountMap.set(pathForCounts, currentKeyCount + 1);

    currentPath = pathForCounts + "." + (currentKeyCount - 1).toString();

    const previousText = keyValueMap.get(currentPath);
    if (previousText) {
      currentPath = incrementCurrentPath(currentPath);
    }

    if (Object.keys(node.attributes).length > 0) {
      attributesMap.set(currentPath, new Map(Object.entries(node.attributes)));
    }
  });
  saxStream.on("text", function (text) {
    // Remove uncessary formatting
    const filteredText = text.replace(/(\r\n|\n|\r)/gm, "");
    const removeDoubleSpaces = filteredText.replace(/\s+/g, " ").trim();
    if (removeDoubleSpaces.length > 0) {
      // Only persist if the information is useful
      keyValueMap.set(currentPath, removeDoubleSpaces);
    }
  });
  saxStream.on("closetag", function (node) {
    // same object as above
    const splitPath = currentPath.split(".");
    const removeLastTwoElements = splitPath.slice(0, splitPath.length - 2);
    currentPath = removeLastTwoElements.join(".");
  });
  // pipe is supported, and it's readable/writable
  // same chunks coming in also go out.
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(path.resolve(__dirname, "sample.xml"))
      .pipe(saxStream)
      .on("end", () => {
        console.log("CSV file successfully processed");
        resolve();
      })
      .on("error", reject);
  });
  // console.log("keyValueMap: ",[...keyValueMap.entries()]);
  // console.log("attributesMap: ",[...attributesMap.entries()]);
  const documents = buildDocumentstoSubmit(keyValueMap, attributesMap);
  console.log("documents: ", JSON.stringify(documents, null, 2));
}

interface Document {
  path: string;
  text?: string;
  attributes?: { attrKey: string; attrValue: string }[];
}

function buildDocumentstoSubmit(
  keyValueMap: Map<string, string>,
  attributesMap: Map<string, Map<string, string>>,
) {
  const documents: Document[] = [...keyValueMap.entries()].map(
    ([path, text]) => {
      const attributes = attributesMap.get(path);
      return {
        path,
        text,
        attributes: formatAttributes(attributes),
      };
    },
  );
  const attributeDocuments: Document[] = [...attributesMap.entries()].map(
    ([path, attributes]) => {
      return {
        path,
        attributes: formatAttributes(attributes),
      };
    },
  );

  return documents.concat(attributeDocuments);
}

function formatAttributes(attributes?: Map<string, string>) {
  if (attributes) {
    const attributesObj = Object.fromEntries(attributes);
    return Object.keys(attributesObj).map((key) => {
      const value = attributesObj[key];
      return {
        attrKey: key,
        attrValue: value,
      };
    });
  }
  return [];
}

function incrementCurrentPath(currentPath: string) {
  const countString = currentPath.substring(currentPath.lastIndexOf(".") + 1);
  const count = parseInt(countString);

  const newCount = count + 1;

  return (
    currentPath.substring(0, currentPath.lastIndexOf(".") + 1) +
    newCount.toString()
  );
}

main().then();
