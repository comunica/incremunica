import type { Bindings, BindingsStream } from '@comunica/types';
import { Queue } from '@incremunica/data-structures';
import type { IQuerySourceStreamElement, NonStreamingQuerySource, QuerySourceStream } from '@incremunica/types';
import type * as RDF from '@rdfjs/types';
import { AsyncIterator } from 'asynciterator';
import { isAddition } from './BindingsTools';

/**
 * Create a sources stream from a bindings stream.
 * @param bindingsStream the bindings stream to create the sources stream from.
 * @param variables optional parameter to specify the variables to extract from the bindings.
 */
export function createSourcesStreamFromBindingsStream(
  bindingsStream: BindingsStream,
  variables?: (string | RDF.Variable)[],
): QuerySourceStream {
  return bindingsStream.transform(
    {
      transform: (bindings: Bindings, done: () => void, push: (i: IQuerySourceStreamElement) => void) => {
        for (const variable of variables ?? bindings.keys()) {
          const term = bindings.get(variable);
          if (term === undefined) {
            continue;
          }
          if (term.termType === 'NamedNode') {
            push({ isAddition: isAddition(bindings), querySource: term.value });
          }
        }
        done();
      },
    },
  );
}

/**
 * A helper class to help build a query sources stream from different locations to pass to the query engine.
 */
export class QuerySourceIterator extends AsyncIterator<IQuerySourceStreamElement> implements QuerySourceStream {
  private readonly sources: Queue<IQuerySourceStreamElement>;
  private readonly ignoreDeletions: boolean;
  private readonly deletionCooldown: number;
  private readonly distinct: boolean;
  private readonly lenient: boolean;
  private readonly currentSources = new Map<string, number>();
  private sourcesStreams: QuerySourceStream[] = [];
  private readIndex = 0;

  /**
   * Create a new QuerySourceIterator.
   * @param options Optional options for the iterator.
   * @param options.seedSources Optional seed sources to start the iterator with.
   * @param options.bindingsStreams Optional bindings streams to add to the iterator.
   * @param options.distinct Optional flag to make the iterator distinct (no duplicates). @default false
   * @param options.ignoreDeletions Optional flag to ignore deletions in all streams. @default false
   *    The `removeSource` function will still work.
   * @param options.deletionCooldown Optional cooldown (in ms) for deletions. @default 0
   *    This will delay the deletion of sources to prevent a deletion followed immediately by a similar addition.
   *    This only works when `distinct` is set to true.
   * @param options.lenient Optional flag to ignore errors. @default false
   */
  public constructor(options?: {
    seedSources?: NonStreamingQuerySource[];
    bindingsStreams?: BindingsStream[];
    distinct?: boolean;
    ignoreDeletions?: boolean;
    deletionCooldown?: number;
    lenient?: boolean;
  }) {
    super();
    if (options?.seedSources) {
      this.sources = new Queue(options.seedSources.map(source => ({ isAddition: true, querySource: source })));
      this.readable = true;
    } else {
      this.sources = new Queue();
    }
    if (options?.bindingsStreams) {
      for (const bindingsStream of options.bindingsStreams) {
        this.addBindingsStream(bindingsStream);
      }
    }
    this.distinct = options?.distinct ?? false;
    this.ignoreDeletions = options?.ignoreDeletions ?? false;
    this.deletionCooldown = options?.deletionCooldown ?? 0;
    this.lenient = options?.lenient ?? false;
  }

  private getStringFromSource(source: NonStreamingQuerySource): string {
    if (typeof source === 'string') {
      return source;
    }
    return source.value;
  }

  private addSourceToMap(source: NonStreamingQuerySource): boolean {
    const value = this.getStringFromSource(source);
    if (!/^(https?:\/\/|www\.)/gu.test(value)) {
      return true;
    }
    const parsedUrl = new URL(value);
    parsedUrl.hash = '';
    const urlWithoutHash = parsedUrl.toString();
    const count = this.currentSources.get(urlWithoutHash);
    if (count === undefined) {
      this.currentSources.set(urlWithoutHash, 1);
      return true;
    }
    this.currentSources.set(urlWithoutHash, count + 1);
    return false;
  }

  private deleteSourceFromMap(source: NonStreamingQuerySource, fromStream: boolean): boolean {
    const value = this.getStringFromSource(source);
    if (!/^(https?:\/\/|www\.)/gu.test(value)) {
      return true;
    }
    const parsedUrl = new URL(value);
    parsedUrl.hash = '';
    const urlWithoutHash = parsedUrl.toString();
    const count = this.currentSources.get(urlWithoutHash);
    if (count === undefined) {
      if (!this.lenient) {
        throw new Error(`Deleted source ${urlWithoutHash} was never added.`);
      }
      return false;
    }
    if (count === 1) {
      if (fromStream && this.deletionCooldown > 0) {
        setTimeout(() => {
          this.sources.push({
            isAddition: false,
            querySource: source,
          });
          this.readable = true;
        }, this.deletionCooldown);
        return false;
      }
      this.currentSources.delete(urlWithoutHash);
      return true;
    }
    this.currentSources.set(urlWithoutHash, count - 1);
    return false;
  }

  /**
   * Add a bindings stream to this iterator. If you plan on using this bindings stream somewhere else, pass a clone to
   * this method with `bindingsStream.clone()`. When using the bindings stream again clone it again to use it there.
   * @param bindingsStream the bindings stream to add
   * @param variables optional parameter to specify the variables to extract from the bindings
   * @param ignoreDeletions optional parameter to ignore deletions in the bindings stream
   */
  public addBindingsStream(
    bindingsStream: BindingsStream,
    variables?: (string | RDF.Variable)[],
    ignoreDeletions?: boolean,
  ): void {
    if (this.closed) {
      throw new Error('Cannot add a bindings stream to a closed QuerySourceIterator');
    }
    if (bindingsStream.readable) {
      this.readable = true;
    }
    const sourcesStream = createSourcesStreamFromBindingsStream(bindingsStream, variables);
    this.addSourcesStream(sourcesStream, ignoreDeletions);
  }

  /**
   * Add a sources stream to this iterator.
   * @param sourcesStream the sources stream to add.
   * @param ignoreDeletions optional parameter to ignore deletions in the sources stream
   */
  public addSourcesStream(sourcesStream: QuerySourceStream, ignoreDeletions?: boolean): void {
    if (this.closed) {
      throw new Error('Cannot add a source stream to a closed QuerySourceIterator');
    }
    if (sourcesStream.readable) {
      this.readable = true;
    }
    if (this.ignoreDeletions || ignoreDeletions) {
      sourcesStream = sourcesStream.filter(element => element.isAddition);
    }
    this.sourcesStreams.push(sourcesStream);
    sourcesStream.on('error', (error: Error) => {
      if (this.lenient) {
        this.sourcesStreams.splice(this.sourcesStreams.indexOf(sourcesStream), 1);
      } else {
        this.destroy(error);
      }
    });
    sourcesStream.on('readable', () => this.readable = true);
    sourcesStream.on('end', () => this.sourcesStreams.splice(this.sourcesStreams.indexOf(sourcesStream), 1));
  }

  /**
   * Add a source to this iterator.
   * @param querySource
   */
  public addSource(querySource: NonStreamingQuerySource): void {
    if (this.closed) {
      throw new Error('Cannot add a source to a closed QuerySourceIterator');
    }
    this.sources.push({ isAddition: true, querySource });
    this.readable = true;
  }

  /**
   * Remove a source from this iterator.
   * @param querySource
   */
  public removeSource(querySource: NonStreamingQuerySource): void {
    if (this.closed) {
      throw new Error('Cannot remove a source to a closed QuerySourceIterator');
    }
    this.sources.push({ isAddition: false, querySource });
    this.readable = true;
  }

  public override _end(): void {
    super._end();
    for (const sourcesStream of this.sourcesStreams) {
      sourcesStream.destroy();
    }
    this.sourcesStreams = [];
  }

  private handleReadElement(
    source: IQuerySourceStreamElement,
    fromStream = false,
  ): IQuerySourceStreamElement | undefined {
    if (this.distinct) {
      if (source.isAddition && this.addSourceToMap(source.querySource)) {
        return source;
      }
      if (!source.isAddition && this.deleteSourceFromMap(source.querySource, fromStream)) {
        return source;
      }
      return undefined;
    }
    return source;
  }

  public override read(): IQuerySourceStreamElement | null {
    let source = this.sources.shift();
    while (source) {
      const result = this.handleReadElement(source);
      if (result) {
        return result;
      }
      source = this.sources.shift();
    }
    if (this.sourcesStreams.length === 0) {
      this.readable = false;
      return null;
    }
    const startIndex = this.readIndex;
    do {
      this.readIndex = (this.readIndex + 1) % this.sourcesStreams.length;
      const sourcesStream = this.sourcesStreams[this.readIndex];
      const element = sourcesStream.read();
      if (element) {
        const result = this.handleReadElement(element, true);
        if (result) {
          return result;
        }
        this.readIndex--;
      }
    } while (startIndex !== this.readIndex);
    this.readable = false;
    return null;
  }
}
