import fs from "fs";
import path from "path";

import { Client, ConnectionOptions, UndiciConnection } from '@elastic/elasticsearch';
import { kEmitter } from '@elastic/transport/lib/symbols';

const elasticClient = new Client({
  node: "https://localhost:9200", // Elasticsearch endpoint
  auth: {
    username: "elastic",
    password: "hiHQjL5+hV=YbKaCUyS0",
  },
  tls: {
    ca: fs.readFileSync(path.resolve(__dirname, "./http_ca.crt")),
    rejectUnauthorized: false,
  },
  // This is a workaround for a node warning about too many listeners
  // It seems like this is a known issue
  // https://github.com/elastic/elastic-transport-js/issues/63
  Connection: class extends UndiciConnection {
    constructor(properties: ConnectionOptions) {
      super(properties);
      this[kEmitter].setMaxListeners(50000);
    }
  },
});

export default elasticClient;
