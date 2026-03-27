import {
  LinkedRdfSourcesAsyncRdfIterator,
} from '@comunica/actor-query-source-identify-hypermedia/lib/LinkedRdfSourcesAsyncRdfIterator';
import type { MediatorContextPreprocess } from '@comunica/bus-context-preprocess';
import { ActorQuerySourceIdentify } from '@comunica/bus-query-source-identify';
import type {
  IActionRdfMetadataAccumulate,
  IActorRdfMetadataAccumulateOutput,
  MediatorRdfMetadataAccumulate,
} from '@comunica/bus-rdf-metadata-accumulate';
import { KeysInitQuery, KeysQueryOperation } from '@comunica/context-entries';
import { ActionContext, Bus } from '@comunica/core';
import { BindingsStream, type Bindings, type IActionContext, type IQueryBindingsOptions, type IQuerySource, type MetadataBindings } from '@comunica/types';
import { MetadataValidationState } from '@comunica/utils-metadata';
import { KeysBindings, KeysStreamingSource } from '@incremunica/context-entries';
import {
  createTestContextWithDataFactory,
  AF,
  DF,
  BF,
  partialArrayifyAsyncIterator,
  testBufferIterator,
} from '@incremunica/dev-tools';
import type { IQuerySourceStreamElement } from '@incremunica/types';
import { ArrayIterator, AsyncIterator } from 'asynciterator';
import { ActorQuerySourceIdentifyStreamGraphql } from '../lib';
import 'jest-rdf';
import '@comunica/utils-jest';
import { StreamingQuerySourceStreamGraphql } from '../lib/StreamingQuerySourceStreamGraphql';
import { Algebra } from 'sparqlalgebrajs';
import { Operation } from 'sparqlalgebrajs/lib/algebra';

// @ts-expect-error
const mediatorRdfMetadataAccumulate: MediatorRdfMetadataAccumulate = {
  async mediate(action: IActionRdfMetadataAccumulate): Promise<IActorRdfMetadataAccumulateOutput> {
    if (action.mode === 'initialize') {
      return {
        metadata: {
          cardinality: { type: 'exact', value: 0 },
        },
      };
    }

    const metadata = { ...action.accumulatedMetadata };
    if (metadata.cardinality) {
      metadata.cardinality = { ...metadata.cardinality };
    }
    const subMetadata = action.appendingMetadata;
    if (!subMetadata.cardinality) {
      // We're already at infinite, so ignore any later metadata
      metadata.cardinality = <any>{};
      metadata.cardinality.type = 'estimate';
      metadata.cardinality.value = Number.POSITIVE_INFINITY;
    }
    if (metadata.cardinality?.value !== undefined && subMetadata.cardinality?.value !== undefined) {
      metadata.cardinality.value += subMetadata.cardinality.value;
    }
    if (subMetadata.cardinality?.type === 'estimate') {
      metadata.cardinality.type = 'estimate';
    }

    return { metadata };
  },
};

describe('ActorQuerySourceIdentifyStreamGraphql', () => {
  let bus: any;

  beforeEach(() => {
    bus = new Bus({ name: 'bus' });
  });

  describe('The ActorQuerySourceIdentifyStreamGraphql module', () => {
    it('should be a function', () => {
      expect(ActorQuerySourceIdentifyStreamGraphql).toBeInstanceOf(Function);
    });

    it('should be a ActorQuerySourceIdentifyStreamGraphql constructor', () => {
      expect(new (<any> ActorQuerySourceIdentifyStreamGraphql)({ name: 'actor', bus }))
        .toBeInstanceOf(ActorQuerySourceIdentifyStreamGraphql);
      expect(new (<any> ActorQuerySourceIdentifyStreamGraphql)({ name: 'actor', bus }))
        .toBeInstanceOf(ActorQuerySourceIdentify);
    });

    it('should not be able to create new ActorQuerySourceIdentifyStreamGraphql objects without \'new\'', () => {
      expect(() => {
        (<any> ActorQuerySourceIdentifyStreamGraphql)();
      }).toThrow(`Class constructor ActorQuerySourceIdentifyStreamGraphql cannot be invoked without 'new'`);
    });
  });

  describe('An ActorQuerySourceIdentifyStreamGraphql instance', () => {
    let actor: ActorQuerySourceIdentifyStreamGraphql;
    let source: AsyncIterator<any>;
    let mediatorContextPreprocess: MediatorContextPreprocess;
    let context: IActionContext;

    beforeEach(() => {
      jest.spyOn(mediatorRdfMetadataAccumulate, 'mediate');
      mediatorContextPreprocess = <MediatorContextPreprocess><any> {
        mediate: jest.fn((action) => {
          return Promise.resolve({
            context: action.context.set(KeysQueryOperation.querySources, [{
              source: {
                queryBindings: () => {
                  const it = new AsyncIterator();
                  it.read = () => {
                    if (it.readable) {
                      it.readable = false;
                      return BF.bindings([
                        [ DF.variable('v'), DF.namedNode('a') ],
                      ]).setContextEntry(KeysBindings.isAddition, true);
                    }
                    return null;
                  };
                  it.readable = true;

                  it.setProperty('metadata', {
                    state: new MetadataValidationState(),
                    cardinality: { type: 'exact', value: 1 },
                    variables: [
                      { variable: DF.variable('v'), canBeUndef: false },
                    ],
                  });

                  return it;
                },
                toString: () => "QuerySourceGraphql"
              },
              context: new ActionContext(),
            }]),
          });
        }),
      };
      actor = new ActorQuerySourceIdentifyStreamGraphql({
        name: 'actor',
        bus,
        mediatorRdfMetadataAccumulate,
        mediatorContextPreprocess,
      });
      source = new ArrayIterator<IQuerySourceStreamElement>([
        {
          isAddition: true,
          querySource: 'http://example.org/',
        },
      ]);
      context = createTestContextWithDataFactory();
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    describe('test', () => {
      it('should test', async() => {
        await expect(actor.test({
          querySourceUnidentified: { type: 'stream-graphql', value: <any>source },
          context: new ActionContext(),
        })).resolves.toBeTruthy();
      });

      it('should not test with sparql type', async() => {
        await expect(actor.test({
          querySourceUnidentified: { type: 'sparql', value: <any>source },
          context: new ActionContext(),
        })).resolves.toFailTest(`actor requires a single query source with stream-graphql type to be present in the context.`);
      });
    });

    describe('run', () => {
      it('should get the source', async() => {
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream-graphql', value: <any>source },
          context,
        });
        expect(result.querySource.source).toBeInstanceOf(StreamingQuerySourceStreamGraphql);
        expect(result.querySource.context).not.toBe(context);
        expect(result.querySource.source.referenceValue).toBe('StreamingQuerySourcesGraphql');
        expect(result.querySource.source.toString()).toBe('StreamingQuerySourcesGraphql');
        await expect(result.querySource.source.getSelectorShape(
          new ActionContext(),
        )).resolves.toEqual({
          type: 'disjunction',
          children: [
            {
              type: 'operation',
              operation: {
                operationType: 'type',
                type: Algebra.types.JOIN,
              },
            },
            {
              type: 'operation',
              operation: {
                operationType: 'type',
                type: Algebra.types.BGP,
              },
            },
            {
              type: 'operation',
              operation: {
                operationType: 'pattern',
                pattern: AF.createPattern(
                  DF.variable('s'),
                  DF.variable('p'),
                  DF.variable('o'),
                ),
              },
              variablesOptional: [
                DF.variable('s'),
                DF.variable('p'),
                DF.variable('o'),
              ],
            }
          ],
        });
        await expect(result.querySource.source.queryVoid(
          AF.createNop(),
          new ActionContext(),
        )).rejects.toThrow('queryVoid is not implemented in StreamingQuerySourceStreamGraphql');
        expect(() => {
          result.querySource.source.queryQuads(
            AF.createNop(),
            new ActionContext(),
          );
        }).toThrow('queryQuads is not implemented in StreamingQuerySourceStreamGraphql');
        await expect(result.querySource.source.queryBoolean(
          AF.createAsk(AF.createNop()),
          new ActionContext(),
        )).rejects.toThrow('queryBoolean is not implemented in StreamingQuerySourceStreamGraphql');
      });

      it('should fail if the sourcesEventEmitter fails', async() => {
        const source = testBufferIterator([
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
        ]);
        source.readable = true;
        const result = (await actor.run({
          querySourceUnidentified: { type: 'stream-graphql', value: <any> source },
          context,
        })).querySource;
        const bindingsStream = result.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(partialArrayifyAsyncIterator(bindingsStream, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        await expect(new Promise<void>((resolve, reject) => {
          bindingsStream.on('data', () => {
            resolve();
          });
          bindingsStream.on('end', () => {
            resolve();
          });
          bindingsStream.on('error', (e) => {
            reject(e);
          });
          source.destroy(new Error('Test Error'));
        })).rejects.toThrow('Test Error');
        expect(() => {
          result.source.queryBindings(
            AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
            new ActionContext(),
          );
        }).toThrow('Test Error');
      });

      it('should fail the context preprocessing fails (1)', async() => {
        jest.spyOn(mediatorContextPreprocess, 'mediate').mockImplementation(async() => {
          throw new Error('Test Error');
        });
        const result = (await actor.run({
          querySourceUnidentified: { type: 'stream-graphql', value: <any> new ArrayIterator([{
            isAddition: true,
            querySource: 'http://example.org/1',
          }]) },
          context,
        })).querySource;
        const bindingsStream = result.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(new Promise<void>((resolve, reject) => {
          bindingsStream.on('data', () => {
            resolve();
          });
          bindingsStream.on('end', () => {
            resolve();
          });
          bindingsStream.on('error', (e) => {
            reject(e);
          });
        })).rejects.toThrow('Test Error');
        expect(() => {
          result.source.queryBindings(
            AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
            new ActionContext(),
          );
        }).toThrow('Test Error');
      });

      it('should fail the context preprocessing fails (2)', async() => {
        jest.spyOn(mediatorContextPreprocess, 'mediate').mockImplementation((action) => {
          return Promise.resolve({
            context: action.context.set(KeysQueryOperation.querySources, undefined),
          });
        });
        const result = (await actor.run({
          querySourceUnidentified: { type: 'stream-graphql', value: <any> new ArrayIterator([{
            isAddition: true,
            querySource: 'http://example.org/1',
          }]) },
          context,
        })).querySource;
        const bindingsStream = result.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(new Promise<void>((resolve, reject) => {
          bindingsStream.on('data', () => {
            resolve();
          });
          bindingsStream.on('end', () => {
            resolve();
          });
          bindingsStream.on('error', (e) => {
            reject(e);
          });
        })).rejects.toThrow('Expected a single query source in the context.');
        expect(() => {
          result.source.queryBindings(
            AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
            new ActionContext(),
          );
        }).toThrow('Expected a single query source in the context.');
      });

      it('should fail the context preprocessing fails (3)', async() => {
        jest.spyOn(mediatorContextPreprocess, 'mediate').mockImplementation((action) => {
          return Promise.resolve({
            context: action.context.set(KeysQueryOperation.querySources, []),
          });
        });
        const result = (await actor.run({
          querySourceUnidentified: { type: 'stream-graphql', value: <any> new ArrayIterator([{
            isAddition: true,
            querySource: 'http://example.org/1',
          }]) },
          context,
        })).querySource;
        const bindingsStream = result.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(new Promise<void>((resolve, reject) => {
          bindingsStream.on('data', () => {
            resolve();
          });
          bindingsStream.on('end', () => {
            resolve();
          });
          bindingsStream.on('error', (e) => {
            reject(e);
          });
        })).rejects.toThrow('Expected a single query source in the context');
        expect(() => {
          result.source.queryBindings(
            AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
            new ActionContext(),
          );
        }).toThrow('Expected a single query source in the context');
      });

      it('should work when calling query bindings twice', async() => {
        const sources = [
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
        ];
        source = new ArrayIterator(sources);
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream-graphql', value: <any>source },
          context,
        });
        const bindings = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(partialArrayifyAsyncIterator(bindings, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        expect(mediatorContextPreprocess.mediate).toHaveBeenNthCalledWith(
          1,
          { context: context.set(KeysInitQuery.querySourcesUnidentified, [ sources[0].querySource ]) },
        );
        expect(mediatorRdfMetadataAccumulate.mediate).toHaveBeenCalledTimes(1);
        const bindings2 = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(partialArrayifyAsyncIterator(bindings2, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        expect(mediatorRdfMetadataAccumulate.mediate).toHaveBeenCalledTimes(2);
      });

      it('should work with QuerySourceGraphql', async() => {
        const sources = [
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          {
            isAddition: true,
            querySource: {
              value: 'http://example.org/',
              type: 'graphql'
            },
          },
        ];
        source = new ArrayIterator(sources);
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream-graphql', value: <any>source },
          context,
        });
        expect(result.querySource.source).toBeInstanceOf(StreamingQuerySourceStreamGraphql);
        expect(result.querySource.context).not.toBe(context);
        const bindings = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(partialArrayifyAsyncIterator(bindings, 2)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        expect(mediatorRdfMetadataAccumulate.mediate).toHaveBeenCalledTimes(2);
      });

      it('should not work with other source type', async() => {

        jest.spyOn(mediatorContextPreprocess, 'mediate').mockImplementation((action) => {
          return Promise.resolve({
            context: action.context.set(KeysQueryOperation.querySources, [{
              source: {
                queryBindings: () => {
                  const it = new AsyncIterator();
                  it.read = () => {
                    if (it.readable) {
                      it.readable = false;
                      return BF.bindings([
                        [ DF.variable('v'), DF.namedNode('a') ],
                      ]).setContextEntry(KeysBindings.isAddition, true);
                    }
                    return null;
                  };
                  it.readable = true;

                  it.setProperty('metadata', {
                    state: new MetadataValidationState(),
                    cardinality: { type: 'exact', value: 1 },
                    variables: [
                      { variable: DF.variable('v'), canBeUndef: false },
                    ],
                  });

                  return it;
                },
                toString: () => "OtherQuerySource",
              },
              context: new ActionContext(),
            }]),
          });
        });

        const sources = [
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
        ];
        source = new ArrayIterator(sources);

        const result = await actor.run({
          querySourceUnidentified: { type: 'stream-graphql', value: <any>source },
          context,
        });

        const bindings = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );

        await expect(new Promise<void>((_resolve, reject) => {
          bindings.on('error', (e) => {
            reject(e);
          });
          bindings.on('data', () => {
            // If data comes through, that's a failure
            reject(new Error('Should not emit data for non-GraphQL source'));
          });
          bindings.on('end', () => {
            reject(new Error('Should not end successfully'));
          });
        })).rejects.toThrow('Only allows graphql sources.');
      });

      it('should work with immediate deletions 1', async() => {
        const sources = [
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
        ];
        source = new ArrayIterator(sources);
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream-graphql', value: <any>source },
          context,
        });
        expect(result.querySource.source).toBeInstanceOf(StreamingQuerySourceStreamGraphql);
        expect(result.querySource.context).not.toBe(context);
        const bindings = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(mediatorContextPreprocess.mediate).toHaveBeenNthCalledWith(
          1,
          { context: context.set(KeysInitQuery.querySourcesUnidentified, [ sources[0].querySource ]) },
        );
      });

      it('should work with immediate deletions 2', async() => {
        const sources = [
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
        ];
        source = new ArrayIterator(sources);
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream-graphql', value: <any>source },
          context,
        });
        expect(result.querySource.source).toBeInstanceOf(StreamingQuerySourceStreamGraphql);
        expect(result.querySource.context).not.toBe(context);
        const bindings = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(partialArrayifyAsyncIterator(bindings, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        expect(mediatorContextPreprocess.mediate).toHaveBeenNthCalledWith(
          1,
          { context: context.set(KeysInitQuery.querySourcesUnidentified, [ sources[0].querySource ]) },
        );
      });

      it('should work with slow deletions', async() => {
        const sources = [
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
        ];
        source = new AsyncIterator();
        source.read = () => {
          if (sources.length === 0) {
            source.close();
            return null;
          }
          if (source.readable) {
            source.readable = false;
            return sources.shift();
          }
          source.readable = false;
          return null;
        };
        source.readable = true;
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream-graphql', value: <any>source },
          context,
        });
        expect(result.querySource.source).toBeInstanceOf(StreamingQuerySourceStreamGraphql);
        expect(result.querySource.context).not.toBe(context);
        const bindings = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(partialArrayifyAsyncIterator(bindings, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        source.readable = true;
        await expect(partialArrayifyAsyncIterator(bindings, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, false),
        ]);
        expect(mediatorContextPreprocess.mediate).toHaveBeenNthCalledWith(
          1,
          { context: context.set(KeysInitQuery.querySourcesUnidentified, [ 'http://example.org/' ]) },
        );
      });

      it('should use sources that already identified', async() => {
        source = testBufferIterator([
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          null,
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
          null,
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          null,
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
        ]);
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream-graphql', value: <any>source },
          context,
        });
        expect(result.querySource.source).toBeInstanceOf(StreamingQuerySourceStreamGraphql);
        expect(result.querySource.context).not.toBe(context);
        const bindingsStream = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        source.readable = true;
        await expect(partialArrayifyAsyncIterator(bindingsStream, 2)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        source.readable = true;
        await expect(partialArrayifyAsyncIterator(bindingsStream, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, false),
        ]);
        source.readable = true;
        await expect(partialArrayifyAsyncIterator(bindingsStream, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        source.readable = true;
        await expect(partialArrayifyAsyncIterator(bindingsStream, 2)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, false),
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, false),
        ]);
      });

      it('should not consider new sources after end', async() => {
        source = testBufferIterator([
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          null,
          {
            isAddition: true,
            querySource: 'http://example.org/1',
          },
        ]);
        source.readable = true;
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream-graphql', value: <any>source },
          context,
        });
        expect(result.querySource.source).toBeInstanceOf(StreamingQuerySourceStreamGraphql);
        expect(result.querySource.context).not.toBe(context);
        const bindingsStream = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(partialArrayifyAsyncIterator(bindingsStream, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        bindingsStream.destroy();
        source.readable = true;
      });

      it('should fail on non existing deletions', async() => {
        const sources = [
          {
            isAddition: true,
            querySource: 'http://example.org/1',
          },
          {
            isAddition: true,
            querySource: 'http://example.org/2',
          },
          {
            isAddition: false,
            querySource: 'http://example.org/a',
          },
        ];
        source = new AsyncIterator();
        source.read = () => {
          if (sources.length === 0) {
            source.close();
            return null;
          }
          return sources.shift();
        };
        source.readable = false;
        const result = (await actor.run({
          querySourceUnidentified: { type: 'stream-graphql', value: <any>source },
          context,
        })).querySource;
        const bindingsStream = result.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        source.readable = true;
        await expect(new Promise<void>((resolve, reject) => {
          bindingsStream.on('data', () => {
            resolve();
          });
          bindingsStream.on('end', () => {
            resolve();
          });
          bindingsStream.on('error', (e) => {
            reject(e);
          });
        })).rejects.toThrow('Deleted source: "http://example.org/a" has not been added. List of added sources:\n[\nhttp://example.org/1,\nhttp://example.org/2\n]');
        expect(bindingsStream.read()).toBeNull();
        expect(() => {
          result.source.queryBindings(
            AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
            new ActionContext(),
          );
        }).toThrow('Deleted source: "http://example.org/a" has not been added. List of added sources:\n[\nhttp://example.org/1,\nhttp://example.org/2\n]');
      });

      it('should get the source with context', async() => {
        const contextSource = new ActionContext();
        const ret = await actor.run({
          querySourceUnidentified: { type: 'stream-graphql', value: <any>source, context: contextSource },
          context,
        });
        expect(ret.querySource.source).toBeInstanceOf(StreamingQuerySourceStreamGraphql);
        expect(ret.querySource.context).not.toBe(context);
        expect(ret.querySource.context).toBe(contextSource);
      });

      it('should accumulate metadata', async() => {
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream-graphql', value: <any>source },
          context,
        });
        const bindingsStream = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.variable('p'), DF.variable('o'), DF.variable('g')),
          new ActionContext(),
        );
        expect(bindingsStream.getProperty<MetadataBindings>('metadata')).toEqual({
          cardinality: {
            type: 'exact',
            value: 1,
          },
          state: expect.any(MetadataValidationState),
          variables: [
            {
              canBeUndef: false,
              variable: DF.variable('s'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('p'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('o'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('g'),
            },
          ],
        });
        await expect(partialArrayifyAsyncIterator(bindingsStream, 1)).resolves.toEqual([
          BF.bindings([
            [ DF.variable('v'), DF.namedNode('a') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        expect(bindingsStream.getProperty<MetadataBindings>('metadata')).toEqual({
          cardinality: {
            type: 'exact',
            value: 2,
          },
          state: expect.any(MetadataValidationState),
          variables: [
            {
              canBeUndef: false,
              variable: DF.variable('s'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('p'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('o'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('g'),
            },
          ],
        });
      });

      it('should ignore errors when accumulating metadata', async() => {
        jest.spyOn(mediatorRdfMetadataAccumulate, 'mediate').mockRejectedValue(new Error('Test error'));
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream-graphql', value: <any>source },
          context,
        });
        const bindingsStream = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.variable('p'), DF.variable('o'), DF.variable('g')),
          new ActionContext(),
        );
        expect(bindingsStream.getProperty<MetadataBindings>('metadata')).toEqual({
          cardinality: {
            type: 'exact',
            value: 1,
          },
          state: expect.any(MetadataValidationState),
          variables: [
            {
              canBeUndef: false,
              variable: DF.variable('s'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('p'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('o'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('g'),
            },
          ],
        });
        await expect(partialArrayifyAsyncIterator(bindingsStream, 1)).resolves.toEqual([
          BF.bindings([
            [ DF.variable('v'), DF.namedNode('a') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        expect(bindingsStream.getProperty<MetadataBindings>('metadata')).toEqual({
          cardinality: {
            type: 'exact',
            value: 1,
          },
          state: expect.any(MetadataValidationState),
          variables: [
            {
              canBeUndef: false,
              variable: DF.variable('s'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('p'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('o'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('g'),
            },
          ],
        });
        expect(mediatorRdfMetadataAccumulate.mediate).toHaveBeenCalledTimes(1);
      });
    });
  });
});
