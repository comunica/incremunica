# Incremunica user tools

[![npm version](https://badge.fury.io/js/@incremunica%2Fuser-tools.svg)](https://badge.fury.io/js/@incremunica%2Fuser-tools)

A collection of functions to help use incremunica.

## Install

```bash
$ yarn add @incremunica/user-tools
```

## Usage

### BindingsTools
The `isAddition` function checks if a binding is an addition. It returns `true` if the passed bindings are an addition, `false` otherwise.
```typescript
import { isAddition } from '@incremunica/user-tools';
import { KeysBindings } from '@incremunica/context-entries';
import { BindingsFactory } from '@comunica/utils-bindings-factory';

export const BF = new BindingsFactory();

const bindings1 = BF.fromRecord({
  s: DF.namedNode('http://ex.org/s'),
});
const bindings2 = BF.fromRecord({
  s: DF.namedNode('http://ex.org/s'),
}).setContextEntry(KeysBindings.isAddition, true);
const bindings3 = BF.fromRecord({
  s: DF.namedNode('http://ex.org/s'),
}).setContextEntry(KeysBindings.isAddition, false);

console.log(isAddition(bindings1)); // true
console.log(isAddition(bindings2)); // true
console.log(isAddition(bindings3)); // false
```

The `getBindingsIndex` function can be used in case the query uses an ORDER BY clause.
The function returns the index of the bindings in the result set and `-1` if there is no index.

```typescript
import { getBindingsIndex } from '@incremunica/user-tools';
import { KeysBindings } from '@incremunica/context-entries';
import { BindingsFactory } from '@comunica/utils-bindings-factory';

export const BF = new BindingsFactory();

const bindings1 = BF.fromRecord({
  s: DF.namedNode('http://ex.org/s'),
});
const bindings2 = BF.fromRecord({
  s: DF.namedNode('http://ex.org/s'),
}).setContextEntry(KeysBindings.order, {index: 0});

console.log(getBindingsIndex(bindings1)); // -1
console.log(getBindingsIndex(bindings2)); // 0
```

### DeferredEvaluationTools
The `DeferredEvaluation` class can be used to trigger a deferred evaluation of a query engine.
```typescript
import {DeferredEvaluation} from '@incremunica/user-tools';
import {QueryEngine} from "@incremunica/query-sparql-incremental";

const deferredEvaluation = new DeferredEvaluation();
const queryEngine = new QueryEngine();
const bindingsStream = queryEngine.queryBindings("SELECT * WHERE { ?s ?p ?o }", {
    sources: [ "https://www.rubensworks.net/" ],
    deferredEvaluationTrigger: deferredEvaluation.events
});

// Trigger the deferred evaluation
deferredEvaluation.triggerUpdate();
```

### SourcesTools
`createSourcesStreamFromBindingsStream` can be used to create a sources stream from a bindings stream.
```typescript
import {createSourcesStreamFromBindingsStream} from '@incremunica/user-tools';
import {QueryEngine} from "@incremunica/query-sparql-incremental";

const queryEngine = new QueryEngine();
const bindingsStream1 = queryEngine.queryBindings("SELECT * WHERE { ?s ?p ?o }", {
    sources: [ "https://www.rubensworks.net/" ],
});
const bindingsStream2 = queryEngine.queryBindings("SELECT * WHERE { ?s ?p ?o }", {
  sources: [ createSourcesStreamFromBindingsStream(bindingsStream1, ["s"]) ],
});
```
`QuerySourceIterator` is a helper class to help build a query sources stream from different locations to pass to the query engine.
```typescript
import {QuerySourceIterator} from '@incremunica/user-tools';
import {QueryEngine} from "@incremunica/query-sparql-incremental";

const querySourceIterator = new QuerySourceIterator({
  seedSources: ["https://www.rubensworks.net/"],
  distinct: true
});
const queryEngine = new QueryEngine();
const bindingsStream = queryEngine.queryBindings("SELECT * WHERE { ?s ?p ?o }", {
  sources: [querySourceIterator],
});

querySourceIterator.addSource("https://ruben.verborgh.org/profile/"); // Add a source
querySourceIterator.removeSource("https://www.rubensworks.net/"); // Remove a source
querySourceIterator.addBindingsStream(anotherBindingsStream); // Add a bindings stream
querySourceIterator.addBindingsStream(bindingsStream, ["s"]); // Add results from the same bindingsStream
```
