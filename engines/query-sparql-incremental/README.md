# Incremunica SPARQL

[![npm version](https://badge.fury.io/js/@incremunica%2Fquery-sparql-incremental.svg)](https://badge.fury.io/js/@incremunica%2Fquery-sparql-incremental)

Incremunica is an incremental SPARQL query engine build on top of [comunica](https://github.com/comunica/comunica).

## Install

```bash
$ npm install -g @incremunica/query-sparql-incremental
```

or

```bash
$ yarn add @incremunica/query-sparql-incremental
```

## Usage

Incremunica can be used in JavaScript/TypeScript applications and from the command line.

### Usage within application

This engine can be used in JavaScript/TypeScript applications as follows:

```javascript
const QueryEngine = require('@incremunica/query-sparql-incremental').QueryEngine;
const isAddition = require('@incremunica/user-tools').isAddition;
const myEngine = new QueryEngine();

async function main() {
    const bindingsStream = await myEngine.queryBindings(`
    SELECT ?interest
    WHERE {
      <https://ruben.verborgh.org/profile/#me> foaf:topic_interest ?interest.
      <https://www.rubensworks.net/#me> foaf:topic_interest ?interest.
    }`, {
        sources: [
            "https://ruben.verborgh.org/profile/",
            "https://www.rubensworks.net/"
        ],
        pollingPeriod: 1, // Poll every second
    });

    // Consume results as a stream
    bindingsStream.on('data', (bindings) => {
        console.log("Is addition:", isAddition(bindings));

        console.log(bindings.toString()); // Quick way to print bindings for testing

        console.log("Has variable 'interest':", bindings.has('interest')); // Will be true

        // Obtaining values
        console.log(bindings.get('interest').value);
        console.log(bindings.get('interest').termType);
    });

    bindingsStream.on('end', () => {
        // The data-listener will not be called anymore once we get here.
    });
    bindingsStream.on('error', (error) => {
        console.error(error);
    });

    // As this is an incremental query engine, you need to end the query yourself otherwise it will keep checking for changes.
    setTimeout(() => bindingsStream.close(), 3000);
}

main();
```

To help develop with Incremunica we provide a collection of helper functions/classes in the [@incremunica/user-tools](https://www.npmjs.com/package/@incremunica/user-tools) package.
The polling period is the time interval in seconds that the engine will check for changes in the data sources.
The `data` event will be emitted whenever a new result is available, this result will be annotated as an addition or deletion.
The `end` event will be emitted when the query is manually closed.
Finally, the `error` event will be emitted when an error occurs during the query.
This interface is similar to the one provided by the [Comunica query-sparql](https://www.npmjs.com/package/@comunica/query-sparql) package.

You can also use an [incremental triple store](https://www.npmjs.com/package/@incremunica/streaming-store).
This store allows you to change the dataset (additions and deletions) and show you the changes in the query results.
```javascript
const QueryEngine = require('@incremunica/query-sparql-incremental').QueryEngine;
const StreamingStore = require("@incremunica/streaming-store").StreamingStore;
const myEngine = new QueryEngine();
const streamingStore = new StreamingStore();

async function main() {
    streamingStore.import(quadStream);

    const bindingsStream = await myEngine.queryBindings(`
    SELECT *
    WHERE {
        ?s ?p ?o.
    }`, {
        sources: [ streamingStore ],
    });

    streamingStore.addQuad(quad);
    streamingStore.removeQuad(otherQuad);

    streamingStore.end();
}

main();
```

### Usage from the command line

Show the help with all options:

```bash
$ comunica-sparql-incremental --help
```

_[**Read more** about querying from the command line](https://comunica.dev/docs/query/getting_started/query_cli/)._
