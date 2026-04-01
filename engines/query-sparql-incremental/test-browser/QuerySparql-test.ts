// Needed to undo automock from actor-http-native, cleaner workarounds do not appear to be working.
import 'jest-rdf';
import '@incremunica/jest';
import type { BindingsStream, QueryStringContext } from '@comunica/types';
import type { BindingsFactory } from '@comunica/utils-bindings-factory';
import { KeysBindings } from '@incremunica/context-entries';
import { createTestBindingsFactory, partialArrayifyAsyncIterator } from '@incremunica/dev-tools';
import { StreamingStore } from '@incremunica/streaming-store';
import type { Quad } from '@incremunica/types';
import { DeferredEvaluation } from '@incremunica/user-tools';
import { DataFactory } from 'rdf-data-factory';
import { QueryEngine } from '../lib';

if (!globalThis.window) {
  jest.unmock('follow-redirects');
}

const quad = require('rdf-quad');

const DF = new DataFactory();

async function setServerData(testUuid: string, data: string): Promise<void> {
  await fetch(`http://localhost:3000/reset/${testUuid}`, { method: 'POST', body: data });
}

describe('System test: QuerySparql (without external network)', () => {
  let BF: BindingsFactory;
  let engine: QueryEngine;

  beforeEach(async() => {
    engine = new QueryEngine();
    BF = await createTestBindingsFactory(DF);
  });

  describe('using Streaming Store', () => {
    let streamingStore: StreamingStore<Quad>;

    beforeEach(async() => {
      streamingStore = new StreamingStore<Quad>();
    });

    it('simple query', async() => {
      streamingStore.addQuad(quad('s1', 'p1', 'o1'));
      streamingStore.addQuad(quad('s2', 'p2', 'o2'));

      const bindingStream = await engine.queryBindings(`SELECT * WHERE {
          ?s ?p ?o.
          }`, {
        sources: [ streamingStore ],
      });

      expect(await partialArrayifyAsyncIterator(bindingStream, 2)).toBeIsomorphicBindingsArray([
        BF.bindings([
          [ DF.variable('s'), DF.namedNode('s1') ],
          [ DF.variable('p'), DF.namedNode('p1') ],
          [ DF.variable('o'), DF.namedNode('o1') ],
        ]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([
          [ DF.variable('s'), DF.namedNode('s2') ],
          [ DF.variable('p'), DF.namedNode('p2') ],
          [ DF.variable('o'), DF.namedNode('o2') ],
        ]).setContextEntry(KeysBindings.isAddition, true),
      ]);

      streamingStore.addQuad(quad('s3', 'p3', 'o3'));

      expect(await partialArrayifyAsyncIterator(bindingStream, 1)).toBeIsomorphicBindingsArray([
        BF.bindings([
          [ DF.variable('s'), DF.namedNode('s3') ],
          [ DF.variable('p'), DF.namedNode('p3') ],
          [ DF.variable('o'), DF.namedNode('o3') ],
        ]).setContextEntry(KeysBindings.isAddition, true),
      ]);

      streamingStore.removeQuad(quad('s3', 'p3', 'o3'));

      expect(await partialArrayifyAsyncIterator(bindingStream, 1)).toBeIsomorphicBindingsArray([
        BF.bindings([
          [ DF.variable('s'), DF.namedNode('s3') ],
          [ DF.variable('p'), DF.namedNode('p3') ],
          [ DF.variable('o'), DF.namedNode('o3') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
      ]);

      streamingStore.end();
    });

    it('query with joins', async() => {
      streamingStore.addQuad(quad('s1', 'p1', 'o1'));
      streamingStore.addQuad(quad('o1', 'p2', 'o2'));

      const bindingStream = await engine.queryBindings(`SELECT * WHERE {
          ?s1 ?p1 ?o1.
          ?o1 ?p2 ?o2.
          }`, {
        sources: [ streamingStore ],
      });

      expect(await partialArrayifyAsyncIterator(bindingStream, 1)).toBeIsomorphicBindingsArray([
        BF.bindings([
          [ DF.variable('s1'), DF.namedNode('s1') ],
          [ DF.variable('p1'), DF.namedNode('p1') ],
          [ DF.variable('o1'), DF.namedNode('o1') ],
          [ DF.variable('p2'), DF.namedNode('p2') ],
          [ DF.variable('o2'), DF.namedNode('o2') ],
        ]).setContextEntry(KeysBindings.isAddition, true),
      ]);

      streamingStore.addQuad(quad('o1', 'p3', 'o3'));

      expect(await partialArrayifyAsyncIterator(bindingStream, 1)).toBeIsomorphicBindingsArray([
        BF.bindings([
          [ DF.variable('s1'), DF.namedNode('s1') ],
          [ DF.variable('p1'), DF.namedNode('p1') ],
          [ DF.variable('o1'), DF.namedNode('o1') ],
          [ DF.variable('p2'), DF.namedNode('p3') ],
          [ DF.variable('o2'), DF.namedNode('o3') ],
        ]).setContextEntry(KeysBindings.isAddition, true),
      ]);

      streamingStore.removeQuad(quad('o1', 'p3', 'o3'));

      expect(await partialArrayifyAsyncIterator(bindingStream, 1)).toBeIsomorphicBindingsArray([
        BF.bindings([
          [ DF.variable('s1'), DF.namedNode('s1') ],
          [ DF.variable('p1'), DF.namedNode('p1') ],
          [ DF.variable('o1'), DF.namedNode('o1') ],
          [ DF.variable('p2'), DF.namedNode('p3') ],
          [ DF.variable('o2'), DF.namedNode('o3') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
      ]);

      streamingStore.end();
    });

    it('query with FILTER NOT EXISTS and multiple inner triple patterns', async() => {
      streamingStore.addQuad(quad('s1', 'http://example.org/p', 'o1'));
      streamingStore.addQuad(quad('s2', 'http://example.org/p', 'o2'));
      streamingStore.addQuad(quad('s2', 'http://example.org/q', 'x1'));
      streamingStore.addQuad(quad('x1', 'http://example.org/r', 'x2'));
      streamingStore.addQuad(quad('x2', 'http://example.org/t', 'x3'));

      let bindingStream: BindingsStream | undefined;
      const getSingleBinding = async(): Promise<any> => {
        const timeout = Symbol('timeout');
        const result = await Promise.race([
          new Promise(resolve => bindingStream!.once('data', resolve)),
          new Promise<Error>(resolve => bindingStream!.once('error', resolve)),
          new Promise<symbol>(resolve => setTimeout(() => resolve(timeout), 1_000)),
        ]);
        if (result === timeout) {
          throw new Error('Timed out while waiting for FILTER NOT EXISTS output.');
        }
        if (result instanceof Error) {
          throw result;
        }
        return result;
      };

      try {
        bindingStream = await engine.queryBindings(`
        PREFIX ex: <http://example.org/>
        SELECT ?s WHERE {
          ?s ex:p ?o .
          FILTER NOT EXISTS {
            ?s ex:q ?q .
            ?q ex:r ?r .
            ?r ex:t ?t .
          }
        }`, {
          sources: [ streamingStore ],
        });

        expect(await getSingleBinding()).toEqualBindings(BF.bindings([
          [ DF.variable('s'), DF.namedNode('s1') ],
        ]).setContextEntry(KeysBindings.isAddition, true));

        streamingStore.removeQuad(quad('x2', 'http://example.org/t', 'x3'));

        expect(await getSingleBinding()).toEqualBindings(BF.bindings([
          [ DF.variable('s'), DF.namedNode('s2') ],
        ]).setContextEntry(KeysBindings.isAddition, true));

        streamingStore.addQuad(quad('x2', 'http://example.org/t', 'x3'));

        expect(await getSingleBinding()).toEqualBindings(BF.bindings([
          [ DF.variable('s'), DF.namedNode('s2') ],
        ]).setContextEntry(KeysBindings.isAddition, false));
      } finally {
        bindingStream?.destroy();
        streamingStore.end();
      }
    });
  });

  describe('with localhost', () => {
    let testUuid: string;
    beforeEach(async() => {
      testUuid = `test-${Date.now()}`;
      await setServerData(testUuid, `
@prefix : <http://example.org/> .
@prefix schema: <http://schema.org/> .
:alice a schema:Person ;
  schema:name "Alice" .`);
    });

    it('should do simple queries', async() => {
      const deferredEvaluation = new DeferredEvaluation();
      const bindingsStream = await engine.queryBindings(`SELECT * WHERE { ?s ?p ?o. }`, {
        sources: [ `http://localhost:3000/${testUuid}` ],
        deferredEvaluationTrigger: deferredEvaluation.events,
      });

      expect(await partialArrayifyAsyncIterator(bindingsStream, 2)).toEqualBindingsArray([
        BF.fromRecord({
          s: DF.namedNode('http://example.org/alice'),
          p: DF.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
          o: DF.namedNode('http://schema.org/Person'),
        }),
        BF.fromRecord({
          s: DF.namedNode('http://example.org/alice'),
          p: DF.namedNode('http://schema.org/name'),
          o: DF.literal('Alice'),
        }),
      ]);

      await setServerData(testUuid, `
@prefix : <http://example.org/> .
@prefix schema: <http://schema.org/> .

:alice a schema:Person ;
  schema:name "Alice" ;
  schema:birthDate "1990-01-01" .`);

      const start = performance.now();
      deferredEvaluation.triggerUpdate();
      expect(await partialArrayifyAsyncIterator(bindingsStream, 1)).toEqualBindingsArray([
        BF.fromRecord({
          s: DF.namedNode('http://example.org/alice'),
          p: DF.namedNode('http://schema.org/birthDate'),
          o: DF.literal('1990-01-01'),
        }),
      ]);
      const end = performance.now();
      expect(end - start).toBeLessThan(100);
    });

    it('should do simple queries with websockets', async() => {
      const start = performance.now();
      const bindingsStream = await engine.queryBindings(`SELECT * WHERE { ?s ?p ?o. }`, {
        sources: [ `http://localhost:3000/${testUuid}` ],
      });

      expect(await partialArrayifyAsyncIterator(bindingsStream, 2)).toEqualBindingsArray([
        BF.fromRecord({
          s: DF.namedNode('http://example.org/alice'),
          p: DF.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
          o: DF.namedNode('http://schema.org/Person'),
        }),
        BF.fromRecord({
          s: DF.namedNode('http://example.org/alice'),
          p: DF.namedNode('http://schema.org/name'),
          o: DF.literal('Alice'),
        }),
      ]);

      await new Promise<void>(resolve => setTimeout(() => resolve(), 200));
      await setServerData(testUuid, `
@prefix : <http://example.org/> .
@prefix schema: <http://schema.org/> .

:alice a schema:Person ;
  schema:name "Alice" ;
  schema:birthDate "1990-01-01" .`);

      expect(await partialArrayifyAsyncIterator(bindingsStream, 1)).toEqualBindingsArray([
        BF.fromRecord({
          s: DF.namedNode('http://example.org/alice'),
          p: DF.namedNode('http://schema.org/birthDate'),
          o: DF.literal('1990-01-01'),
        }),
      ]);
      const end = performance.now();
      expect(end - start).toBeGreaterThan(500);
      expect(end - start).toBeLessThan(1000);
    });
  });
});

describe('System test: QuerySparql (with external network)', () => {
  let bindingStream: BindingsStream;
  let engine: QueryEngine;
  beforeEach(async() => {
    engine = new QueryEngine();
    await engine.invalidateHttpCache();
  });

  afterEach(() => {
    bindingStream.destroy();
  });

  describe('simple SPO on a raw RDF document', () => {
    it('with results', async() => {
      bindingStream = await engine.queryBindings(`SELECT * WHERE {
    ?s ?p ?o.
  }`, {
        sources: [ 'https://www.rubensworks.net/' ],
      });

      expect(await partialArrayifyAsyncIterator(bindingStream, 100)).toHaveLength(100);
    });

    it('repeated with the same engine', async() => {
      const query = `SELECT * WHERE {
     ?s ?p ?o.
     }`;
      const context: QueryStringContext = {
        sources: [ 'https://www.rubensworks.net/' ],
      };

      bindingStream = await engine.queryBindings(query, context);
      expect(await partialArrayifyAsyncIterator(bindingStream, 100)).toHaveLength(100);

      bindingStream = await engine.queryBindings(query, context);
      expect(await partialArrayifyAsyncIterator(bindingStream, 100)).toHaveLength(100);

      bindingStream = await engine.queryBindings(query, context);
      expect(await partialArrayifyAsyncIterator(bindingStream, 100)).toHaveLength(100);

      bindingStream = await engine.queryBindings(query, context);
      expect(await partialArrayifyAsyncIterator(bindingStream, 100)).toHaveLength(100);

      bindingStream = await engine.queryBindings(query, context);
      expect(await partialArrayifyAsyncIterator(bindingStream, 100)).toHaveLength(100);

      bindingStream = await engine.queryBindings(query, context);
      expect(await partialArrayifyAsyncIterator(bindingStream, 100)).toHaveLength(100);
    });

    it('repeated with the same engine and wait a bit until the polling is removed', async() => {
      const query = `SELECT * WHERE {
     ?s ?p ?o.
     }`;
      const context: QueryStringContext = {
        sources: [ 'https://www.rubensworks.net/' ],
        pollingPeriod: 1,
      };

      bindingStream = await engine.queryBindings(query, context);
      expect(await partialArrayifyAsyncIterator(bindingStream, 100)).toHaveLength(100);

      await new Promise<void>(resolve => setTimeout(() => resolve(), 2000));

      bindingStream = await engine.queryBindings(query, context);
      expect(await partialArrayifyAsyncIterator(bindingStream, 100)).toHaveLength(100);
    });

    describe('simple SPS', () => {
      it('Raw Source', async() => {
        bindingStream = await engine.queryBindings(`SELECT * WHERE {
        ?s ?p ?s.
        }`, {
          sources: [ 'https://www.rubensworks.net/' ],
        });

        expect(await partialArrayifyAsyncIterator(bindingStream, 1)).toHaveLength(1);
      });
    });

    describe('two-pattern query on a raw RDF document', () => {
      it('with results', async() => {
        bindingStream = await engine.queryBindings(`SELECT ?name WHERE {
        <https://www.rubensworks.net/#me> <http://xmlns.com/foaf/0.1/knows> ?v0.
        ?v0 <http://xmlns.com/foaf/0.1/name> ?name.
        }`, {
          sources: [ 'https://www.rubensworks.net/' ],
        });

        expect(await partialArrayifyAsyncIterator(bindingStream, 20)).toHaveLength(20);
      });

      it('for the single source entry', async() => {
        bindingStream = await engine.queryBindings(`SELECT ?name WHERE {
        <https://www.rubensworks.net/#me> <http://xmlns.com/foaf/0.1/knows> ?v0.
        ?v0 <http://xmlns.com/foaf/0.1/name> ?name.
        }`, {
          sources: [ 'https://www.rubensworks.net/' ],
        });

        expect(await partialArrayifyAsyncIterator(bindingStream, 20)).toHaveLength(20);
      });

      describe('SHACL Compact Syntax Serialisation', () => {
        it('handles the query with SHACL compact syntax as a source', async() => {
          bindingStream = await engine.queryBindings(`SELECT * WHERE {
        ?s a <http://www.w3.org/2002/07/owl#Ontology>.
        }`, {
            sources: [
              'https://raw.githubusercontent.com/w3c/data-shapes/gh-pages/shacl-compact-syntax/' +
              'tests/valid/basic-shape-iri.shaclc',
            ],
          });

          expect(await partialArrayifyAsyncIterator(bindingStream, 1)).toHaveLength(1);
        });
      });
    });
  });
});
