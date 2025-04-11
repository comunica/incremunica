# Incremunica Streaming Store

[![npm version](https://badge.fury.io/js/@incremunica%2Fstreaming-store.svg)](https://badge.fury.io/js/@incremunica%2Fstreaming-store)

A read-only [RDF/JS store](https://rdf.js.org/stream-spec/#store-interface) that allows parallel data lookup and insertion.
It works in both JavaScript and TypeScript.

Concretely, this means that `match()` calls happening before `import()` calls, will still consider those triples that
are inserted later, which is done by keeping the response streams of `match()` open.
Only when the `end()` method is invoked, all response streams will close, and the StreamingStore will be considered
immutable.

**WARNING**: `end()` MUST be called at some point, otherwise all `match` streams will remain unended.

If using TypeScript, it is recommended to use this in conjunction with [`@rdfjs/types`](https://www.npmjs.com/package/@rdfjs/types).

## Installation

```bash
$ npm install @incremunica/streaming-store
```
or
```bash
$ yarn add @incremunica/streaming-store
```

This package also works out-of-the-box in browsers via tools such as [webpack](https://webpack.js.org/) and [browserify](http://browserify.org/).

## Usage

A new `StreamingStore` can be created as follows:

```typescript
import { StreamingStore } from '@incremunica/streaming-store';

const store = new StreamingStore();
```

### Inserting/removing quads

Following the [RDF/JS Sink](https://rdf.js.org/stream-spec/#sink-interface) interface,
new quads can be added using the `import` method, which accepts a stream of quads:

```typescript
const quad = require('rdf-quad');
const streamifyArray = require('streamify-array');

// Somehow create a quad stream
const quadStream = streamifyArray([
  quad('s3', 'p3', 'o3'),
  quad('s4', 'p4', 'o4'),
]);
store.import(quadStream); // Import it into the store

store.addQuad(quad('s5', 'p5', 'o5')); // Singular quad insertions

// Somehow create a quad stream
const otherQuadStream = streamifyArray([
  quad('s3', 'p3', 'o3'),
]);
store.remove(otherQuadStream); // Remove it from the store

store.removeQuad(quad('s4', 'p4', 'o4')); // singular quad deletions

const IncrementalQuad = require("@incremunica/types").Quad;
let deletionQuad = <IncrementalQuad> quad('s5', 'p5', 'o5'); // Make an incremental quad
deletionQuad.diff = false; // Set diff as false (marks the quad as deleted)
store.addQuad(deletionQuad); // Will remove the quad from the store
```

After inserting your quads, you MUST call `end()` to make sure that `match` calls will end their response streams:

```typescript
store.end();
```

After calling `end()`, importing new quads is not allowed.

### Finding quads

Following the [RDF/JS Source](https://rdf.js.org/stream-spec/#source-interface) interface,
quads can be found using the `match` method, which returns a stream of quads:
```typescript
import type * as RDF from '@rdfjs/types';
import { DataFactory } from 'rdf-data-factory';

const DF = new DataFactory();
const returnStream = store.match(undefined, DF.namedNode('p3'), DF.namedNode('o3'), undefined);

returnStream.on('data', (quad: RDF.Quad) => {
  console.log(quad);
});
returnStream.on('error', (error) => {
  console.log(error);
});
returnStream.on('end', () => {
  console.log('Done!');
});
```

Note that the `returnStream` will not end until the `store.end()` has been invoked.

### `match()` can be called before `import()`

Since `match()` calls will only end after calling `end()`,
quads that are imported _after_ initiating the `match()` call,
can still be emitted in the created `match()` stream.

```typescript
const store = new StreamingStore();
const returnStream = store.match(undefined, DF.namedNode('p3'), DF.namedNode('o3'), undefined);

returnStream.on('data', (quad: RDF.Quad) => {
  console.log(quad);
});
returnStream.on('end', () => {
  console.log('Done!');
});

// At this stage, the store is empty, so no quads will be printed yet

// After importing some quads into the store, the s3-p3-o3 triple will be printed
store.import(streamifyArray([
  quad('s3', 'p3', 'o3'),
  quad('s4', 'p4', 'o4'),
]));

// After importing some more triples, another triple will be printed
store.import(streamifyArray([
  quad('sOther', 'p3', 'o3'),
]));

// Since we mark the store as ended, the returnStream will print `Done!`
store.end();
```
