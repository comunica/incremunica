import { EventEmitter } from 'events';
import {
  LinkedRdfSourcesAsyncRdfIterator,
} from '@comunica/actor-query-source-identify-hypermedia/lib/LinkedRdfSourcesAsyncRdfIterator';
import type { MediatorContextPreprocess } from '@comunica/bus-context-preprocess';
import {
  getVariables,
} from '@comunica/bus-query-source-identify';
import type { MediatorRdfMetadataAccumulate } from '@comunica/bus-rdf-metadata-accumulate';
import { KeysInitQuery, KeysQueryOperation } from '@comunica/context-entries';
import type {
  Bindings,
  BindingsStream,
  ComunicaDataFactory,
  FragmentSelectorShape,
  IActionContext,
  IQueryBindingsOptions,
  IQuerySource,
  MetadataBindings,
} from '@comunica/types';
import { MetadataValidationState } from '@comunica/utils-metadata';
import { KeysStreamingSource } from '@incremunica/context-entries';
import { Queue } from '@incremunica/data-structures';
import type { IQuerySourceStreamElement, QuerySourceStream } from '@incremunica/types';
import type * as RDF from '@rdfjs/types';
import { AsyncIterator, UnionIterator } from 'asynciterator';
import { type Algebra, Factory } from 'sparqlalgebrajs';
import type { Operation } from 'sparqlalgebrajs/lib/algebra';

enum SourceState {
  identify,
  done,
  deleted,
}

type ISourceWrapper = {
  source: IQuerySource | undefined;
  deleteCallbacks: (() => void)[];
  state: SourceState;
  identifiedEvent: EventEmitter;
};

export class StreamingQuerySourceStream implements IQuerySource {
  public referenceValue: string;
  public context: IActionContext;
  private readonly sources: Map<string, ISourceWrapper[]> = new Map();
  private readonly sourcesEventEmitter: EventEmitter;
  protected readonly selectorShape: FragmentSelectorShape;
  private readonly dataFactory: ComunicaDataFactory;
  private readonly mediatorRdfMetadataAccumulate: MediatorRdfMetadataAccumulate;
  private error: Error | undefined;

  public constructor(
    stream: QuerySourceStream,
    dataFactory: ComunicaDataFactory,
    mediatorRdfMetadataAccumulate: MediatorRdfMetadataAccumulate,
    mediatorContextPreprocess: MediatorContextPreprocess,
    context: IActionContext,
  ) {
    this.mediatorRdfMetadataAccumulate = mediatorRdfMetadataAccumulate;
    this.sourcesEventEmitter = new EventEmitter();
    this.sourcesEventEmitter.setMaxListeners(Number.POSITIVE_INFINITY);
    stream.on('data', (item: IQuerySourceStreamElement) => {
      let hash: string;
      if (typeof item.querySource === 'string') {
        hash = item.querySource;
      } else {
        hash = item.querySource.value;
      }
      if (item.isAddition) {
        const existingSourceInstance = this.sources.get(hash);
        if (existingSourceInstance === undefined) {
          const sourceWrapper: ISourceWrapper = {
            source: undefined,
            deleteCallbacks: [],
            state: SourceState.identify,
            identifiedEvent: new EventEmitter(),
          };
          mediatorContextPreprocess
            .mediate({ context: context.set(KeysInitQuery.querySourcesUnidentified, [ item.querySource ]) })
            .then((contextPreprocessResult) => {
              const sources = contextPreprocessResult.context.get(KeysQueryOperation.querySources);
              if (sources === undefined || sources.length !== 1) {
                this.error = new Error('Expected a single query source in the context.');
                this.sourcesEventEmitter.emit('error', this.error);
                return;
              }
              sourceWrapper.source = sources[0].source;
              // Don't set the state to done if it is deleted
              if (sourceWrapper.state === SourceState.identify) {
                sourceWrapper.state = SourceState.done;
              }
              sourceWrapper.identifiedEvent.emit('identified');
            })
            .catch((error: Error) => {
              this.error = error;
              this.sourcesEventEmitter.emit('error', this.error);
            });
          this.sourcesEventEmitter.emit('data', sourceWrapper);
          this.sources.set(hash, [ sourceWrapper ]);
        } else {
          const sourceWrapper: ISourceWrapper = {
            source: existingSourceInstance[0].source,
            state: existingSourceInstance[0].state,
            deleteCallbacks: [],
            identifiedEvent: existingSourceInstance[0].identifiedEvent,
          };
          existingSourceInstance.push(sourceWrapper);
          sourceWrapper.identifiedEvent.on('identified', () => {
            if (sourceWrapper.state === SourceState.identify) {
              sourceWrapper.source = existingSourceInstance[0].source;
              sourceWrapper.state = SourceState.done;
            }
          });
          this.sourcesEventEmitter.emit('data', sourceWrapper);
        }
      } else {
        const source = this.sources.get(hash);
        if (source === undefined || source.length === 0) {
          this.error = new Error(`Deleted source: "${hash}" has not been added. List of added sources:\n[\n${[ ...this.sources.keys() ].join(',\n')}\n]`);
          this.sourcesEventEmitter.emit('error', this.error);
          return;
        }
        const workingSource = source.pop()!;
        workingSource.state = SourceState.deleted;
        for (const deleteCallback of workingSource.deleteCallbacks) {
          deleteCallback();
        }
        if (source.length === 0) {
          this.sources.delete(hash);
        }
      }
    });
    stream.on('error', (error: Error) => {
      this.error = error;
      this.sourcesEventEmitter.emit('error', error);
    });
    this.referenceValue = 'StreamingQuerySources';
    this.dataFactory = dataFactory;
    const AF = new Factory(<RDF.DataFactory> this.dataFactory);
    this.selectorShape = {
      type: 'operation',
      operation: {
        operationType: 'pattern',
        pattern: AF.createPattern(
          this.dataFactory.variable('s'),
          this.dataFactory.variable('p'),
          this.dataFactory.variable('o'),
        ),
      },
      variablesOptional: [
        this.dataFactory.variable('s'),
        this.dataFactory.variable('p'),
        this.dataFactory.variable('o'),
      ],
    };
  }

  public async getSelectorShape(_context: IActionContext): Promise<FragmentSelectorShape> {
    return this.selectorShape;
  }

  public queryBindings(
    operation: Operation,
    context: IActionContext,
    options: IQueryBindingsOptions | undefined,
  ): BindingsStream {
    if (this.error) {
      throw this.error;
    }

    const buffer = new Queue<ISourceWrapper>();
    for (const sourceWrappers of this.sources.values()) {
      for (const sourceWrapper of sourceWrappers) {
        if (sourceWrapper.state === SourceState.identify) {
          sourceWrapper.identifiedEvent.once('identified', () => {
            buffer.push(sourceWrapper);
            iterator.readable = true;
          });
        } else {
          buffer.push(sourceWrapper);
        }
      }
    }

    const variables = getVariables(<Algebra.Pattern>operation);
    // TODO [2025-09-01]: We need to first read the sources and then start the iterator with a more accurate metadata
    // Furthermore the cardinality value should not start at 1 but it does not work otherwise
    let accumulatedMetadata: MetadataBindings = {
      state: new MetadataValidationState(),
      cardinality: { type: 'exact', value: 1 },
      variables: variables.map(variable => ({ variable, canBeUndef: false })),
    };
    const iterator = new AsyncIterator<BindingsStream>();
    iterator.read = (): BindingsStream | null => {
      const sourceWrapper = buffer.shift();
      if (sourceWrapper === undefined) {
        iterator.readable = false;
        return null;
      }
      if (sourceWrapper.state === SourceState.deleted) {
        return iterator.read();
      }
      const currentContext = context.set(KeysStreamingSource.matchOptions, []);
      const bindingsStream = sourceWrapper.source!.queryBindings(operation, currentContext, options);
      bindingsStream.getProperty('metadata', (metadata: MetadataBindings) => {
        this.mediatorRdfMetadataAccumulate.mediate({
          mode: 'append',
          accumulatedMetadata,
          appendingMetadata: metadata,
          context: this.context,
        }).then((result) => {
          const resultMetadata = result.metadata;
          resultMetadata.state = new MetadataValidationState();
          accumulatedMetadata.state.invalidate();
          accumulatedMetadata = <MetadataBindings>resultMetadata;
          unionIterator.setProperty('metadata', accumulatedMetadata);
        }).catch(() => {
          // We ignore errors in the metadata as this would not change the results
        });
      });
      let stopStreamFn = bindingsStream.getProperty<() => void>('delete');
      if (!stopStreamFn) {
        // Either the source of the bindingsStream (as the bindingsStream is probably a mapping iterator from the
        // skolemization) is possibly a LinkedRdfSourcesAsyncRdfIterator
        let linkedRdfSourcesAsyncRdfIterator: LinkedRdfSourcesAsyncRdfIterator | undefined;
        if (bindingsStream instanceof LinkedRdfSourcesAsyncRdfIterator) {
          linkedRdfSourcesAsyncRdfIterator = bindingsStream;
        }
        if ((<any>bindingsStream)._source instanceof LinkedRdfSourcesAsyncRdfIterator) {
          linkedRdfSourcesAsyncRdfIterator = (<any>bindingsStream)._source;
        }
        if (linkedRdfSourcesAsyncRdfIterator) {
          stopStreamFn = () => {
            const matchOptions = currentContext.get(KeysStreamingSource.matchOptions)!;
            if (matchOptions.length === 0) {
              iterator.destroy(new Error('matchOptions are not set, this should not happen.'));
            }
            for (const matchOption of matchOptions) {
              if (matchOption.deleteStream) {
                matchOption.deleteStream();
              } else {
                iterator.destroy(new Error('No delete function found.'));
              }
            }
          };
        } else {
          stopStreamFn = () => {
            iterator.destroy(new Error('No delete function found.'));
          };
        }
      }
      sourceWrapper.deleteCallbacks.push(stopStreamFn);
      return bindingsStream;
    };
    iterator.readable = true;

    const addSourceToBuffer = (sourceWrapper: ISourceWrapper): void => {
      if (iterator.done) {
        this.sourcesEventEmitter.removeListener('data', addSourceToBuffer);
        return;
      }
      if (sourceWrapper.state === SourceState.identify) {
        sourceWrapper.identifiedEvent.once('identified', () => {
          buffer.push(sourceWrapper);
          iterator.readable = true;
        });
      } else {
        buffer.push(sourceWrapper);
        iterator.readable = true;
      }
    };
    this.sourcesEventEmitter.on('data', addSourceToBuffer);
    this.sourcesEventEmitter.on('error', (error: Error) => {
      unionIterator.destroy(error);
    });

    const unionIterator = new UnionIterator<Bindings>(iterator, { autoStart: false });

    unionIterator.setProperty('metadata', accumulatedMetadata);

    return unionIterator;
  }

  public queryQuads(
    _operation: Algebra.Operation,
    _context: IActionContext,
  ): AsyncIterator<RDF.Quad> {
    throw new Error('queryQuads is not implemented in StreamingQuerySourceRdfJs');
  }

  public queryBoolean(
    _operation: Algebra.Ask,
    _context: IActionContext,
  ): Promise<boolean> {
    return Promise.reject(new Error('queryBoolean is not implemented in StreamingQuerySourceRdfJs'));
  }

  public queryVoid(
    _operation: Algebra.Update,
    _context: IActionContext,
  ): Promise<void> {
    return Promise.reject(new Error('queryVoid is not implemented in StreamingQuerySourceRdfJs'));
  }

  public toString(): string {
    return `StreamingHypermediaQuerySources`;
  }
}
