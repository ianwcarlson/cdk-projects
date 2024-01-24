import elasticClient from "../../lib/sdk-drivers/elasticsearch/elastic-client";
import { ESDocument } from "./common-types";

const BATCH_SIZE = 1000;
const INDEX_NAME = "ek-file-analyzer";

interface AddDocumentInput {
  keyValueMap: Map<string, string>;
}

interface AddAttributeDocumentInput {
  attributesMap: Map<string, Map<string, string>>;
}

export class DocumentSubmitter {
  documents: ESDocument[] = [];
  documentCount: number = 0;
  constructor() {}

  public async initialize() {
    this.documentCount = 0;
    const indexExists = await elasticClient.indices.exists({
      index: INDEX_NAME,
    });
    console.log("indexExists: ", indexExists);
    if (!indexExists) {
      await elasticClient.indices.create({
        index: INDEX_NAME,
        mappings: {
          properties: {
            path: { type: "keyword" },
            text: { type: "keyword" },
            attributes: {
              type: "nested",
              properties: {
                ak: { type: "keyword" },
                av: { type: "keyword" },
              },
            },
          },
        },
      });
    }
  }

  public async flush() {
    this.batchSubmitDocuments([], true);
    console.log("Total documents submitted: ", this.documentCount);
  }

  public async addDocument({ keyValueMap }: AddDocumentInput) {

    const newDocuments = this.buildDocumentsToSubmit(
      keyValueMap,
    );

    // Purposely not awaiting this because we don't want to block the main thread,
    // but still log errors
    await this.batchSubmitDocuments(newDocuments).catch((err) => {
      console.error("Error submitting documents: ", err);
    });
  }

  public async addAttributeDocument({ attributesMap }: AddAttributeDocumentInput) {
    const newDocuments = this.buildAttributeDocumentsToSubmit(
      attributesMap,
    );

    // Purposely not awaiting this because we don't want to block the main thread,
    // but still log errors
    await this.batchSubmitDocuments(newDocuments).catch((err) => {
      console.error("Error submitting documents: ", err);
    });
  }

  private buildAttributeDocumentsToSubmit(
    attributesMap: Map<string, Map<string, string>>,
  ) {
    const attributeDocuments: ESDocument[] = [...attributesMap.entries()].map(
      ([path, attributes]) => {
        return {
          path,
          attributes: this.formatAttributes(attributes),
        };
      },
    );

    return attributeDocuments;
  }

  private buildDocumentsToSubmit(
    keyValueMap: Map<string, string>,
  ) {
    // Optimize spread operator later
    const documents: ESDocument[] = [...keyValueMap.entries()].map(
      ([path, text]) => {
        return {
          path,
          text,
          attributes: [],
        };
      },
    );

    return documents;
  }

  private async batchSubmitDocuments(
    newDocuments: ESDocument[],
    flush = false,
  ) {
    this.documents = this.documents.concat(newDocuments);

    if (this.documents.length >= BATCH_SIZE || flush) {
      const body = this.documents.flatMap((doc) => {
        // console.log("doc: ", JSON.stringify(doc, null, 2));
        return [{ index: { _index: INDEX_NAME, _id: doc.path } }, doc];
      });
      console.log("Submitting documents: ", this.documents.length);
      // console.log("First document: ", JSON.stringify(this.documents[0]));
      this.documentCount += this.documents.length;
      this.documents = [];

      await elasticClient.bulk({
        body,
      }).catch((err) => {
        console.error("Error submitting documents: ", err);
      });

    }
  }

  private formatAttributes(attributes?: Map<string, string>) {
    if (attributes) {
      const attributesObj = Object.fromEntries(attributes);
      return Object.keys(attributesObj).map((key) => {
        const value = attributesObj[key];
        return {
          ak: key,
          av: value,
        };
      });
    }
    return;
  }
}
