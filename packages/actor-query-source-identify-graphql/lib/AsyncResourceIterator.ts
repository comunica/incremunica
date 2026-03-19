import type { MediatorHttp } from '@comunica/bus-http';
import type { IActionContext, ComunicaDataFactory } from '@comunica/types';
import type { BindingsFactory } from '@comunica/utils-bindings-factory';
import type { QueryMapper, ResponseMapper } from '@comunica-graphql/sparql2graphql-converter';
import { KeysBindings } from '@incremunica/context-entries';
import { Queue } from '@incremunica/data-structures';
import type * as RDF from '@rdfjs/types';
import { AsyncIterator } from 'asynciterator';
import type { Algebra } from 'sparqlalgebrajs';

type SourceType = 'addition' | 'deletion' | 'init';

export class AsyncResourceIterator extends AsyncIterator<RDF.Bindings> {
  protected readonly source: string;
  protected readonly mediatorHttp: MediatorHttp;
  protected readonly context: IActionContext;

  private readonly variables: RDF.Variable[];
  private readonly dataFactory: ComunicaDataFactory;
  private readonly bindingsFactory: BindingsFactory;

  private readonly queryContext: Record<string, string>;

  protected addQuery?: string;
  protected addRespMapper?: ResponseMapper;

  protected delQuery?: string;
  protected delRespMapper?: ResponseMapper;

  protected initQuery?: string;
  protected initRespMapper?: ResponseMapper;

  protected buffer: Queue<RDF.Bindings>;
  protected decoder: TextDecoder;
  protected activeSources: Set<SourceType> = new Set();

  public constructor(
    source: string,
    context: IActionContext,
    queryContext: Record<string, string>,
    queryMapper: QueryMapper,
    operation: Algebra.Operation,
    mediatorHttp: MediatorHttp,
    variables: RDF.Variable[],
    dataFactory: ComunicaDataFactory,
    bindingsFactory: BindingsFactory,
  ) {
    super();

    this.source = source;
    this.mediatorHttp = mediatorHttp;
    this.context = context;
    this.variables = variables;
    this.dataFactory = dataFactory;
    this.bindingsFactory = bindingsFactory;
    this.queryContext = queryContext;

    // --- Try to create addition/deletion streams ---
    try {
      const converted = queryMapper.subscribeOperation(operation, 'addition');
      if (converted.length > 0) {
        [ this.addQuery, this.addRespMapper ] = converted[0];
        this.startSource('addition');
      }
    } catch {
      // Ignore
    }

    try {
      const converted = queryMapper.subscribeOperation(operation, 'deletion');
      if (converted.length > 0) {
        [ this.delQuery, this.delRespMapper ] = converted[0];
        this.startSource('deletion');
      }
    } catch {
      // Ignore
    }

    if (this.activeSources.size === 0) {
      throw new TypeError(
        'Failed to convert SPARQL query: neither addition nor deletion subscription streams could be created',
      );
    }

    this.buffer = new Queue<RDF.Bindings>();
    this.readable = false;
    this.decoder = new TextDecoder('utf-8');

    // --- Initial query (optional) ---
    const converted = queryMapper.queryOperation(operation);
    if (converted.length > 0) {
      [ this.initQuery, this.initRespMapper ] = converted[0];
      this.startSource('init');
      this.query(this.initQuery).catch(err => this.handleError(err));
    } else {
      // Start subscription if no init query possible
      this.startSubscription();
    }
  }

  public override read(): RDF.Bindings | null {
    const bindings = this.buffer.shift();
    if (!bindings) {
      this.readable = false;
      return null;
    }

    this.readable = this.buffer.length > 0;
    return bindings;
  }

  // --- Centralized subscription starter ---
  private startSubscription(): void {
    if (this.addQuery && this.addRespMapper) {
      this.subscribe(this.addQuery, this.addRespMapper, 'addition').catch(err => this.handleError(err));
    }
    if (this.delQuery && this.delRespMapper) {
      this.subscribe(this.delQuery, this.delRespMapper, 'deletion').catch(err => this.handleError(err));
    }
  }

  private async subscribe(
    query: string,
    resMapper: ResponseMapper,
    type: 'addition' | 'deletion',
  ): Promise<void> {
    const body = {
      '@context': this.queryContext,
      query,
    };

    const init: RequestInit = {
      headers: new Headers({
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      }),
      method: 'POST',
      body: JSON.stringify(body),
    };

    const response = await this.mediatorHttp.mediate({
      input: this.source,
      init,
      context: this.context,
    });

    if (!response.ok) {
      throw new Error(`Unable to start subscription stream: (${response.status}) ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Unable to parse body of subscription stream');
    }

    const reader = response.body.getReader();
    let dataBuffer = '';

    const handleSSE = async(): Promise<void> => {
      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          this.stopSource(type);
          return;
        }

        dataBuffer += this.decoder.decode(Buffer.from(value));
        const parts = dataBuffer.split('\n\n');
        dataBuffer = '';

        for (const part of parts) {
          const lines = part.split('\n');

          let eventType = 'message';
          let dataStr = '';

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.replace(/^event:\s*/u, '').trim();
            } else if (line.startsWith('data:')) {
              dataStr += `${line.replace(/^data:\s*/u, '')}\n`;
            }
          }

          dataStr = dataStr.trim();
          if (!dataStr) {
            continue;
          }

          if (eventType === 'next') {
            const json = JSON.parse(dataStr);

            if (json.errors) {
              this.handleError(
                new Error(
                  `Received error on ${type} stream: ${JSON.stringify(json, null, 2)}`,
                ),
              );
            } else if (json.data) {
              const bindings = resMapper.dataToBindings(
                json.data,
                this.variables,
                this.dataFactory,
                this.bindingsFactory,
              );

              for (const b of bindings) {
                this.buffer.push(b.setContextEntry(KeysBindings.isAddition, type === 'addition'));
              }

              if (bindings.length > 0) {
                this.readable = true;
              }
            }
          }
        }
      }
    };

    handleSSE().catch(err => this.handleError(err));
  }

  private async query(query: string): Promise<void> {
    const body = {
      '@context': this.queryContext,
      query,
    };

    const init: RequestInit = {
      headers: new Headers({ 'Content-Type': 'application/json' }),
      method: 'POST',
      body: JSON.stringify(body),
    };

    const response = await this.mediatorHttp.mediate({
      input: this.source,
      init,
      context: this.context,
    });

    if (!response.ok) {
      throw new Error(`Unable to execute initial query: (${response.status}) ${response.statusText}`);
    }

    const json = await response.json();

    const bindings = this.initRespMapper!.dataToBindings(
      json.data,
      this.variables,
      this.dataFactory,
      this.bindingsFactory,
    );

    for (const b of bindings) {
      this.buffer.push(b);
    }

    if (bindings.length > 0) {
      this.readable = true;
    }

    const paginations = json?.extensions?.pagination?.filter((p: any) => p?.next);

    if (!paginations || paginations.length === 0) {
      this.startSubscription();
      this.stopSource('init');
      return;
    }

    const deepestPagination = paginations.reduce((deepest: any, current: any) => {
      const currentDepth = current.path.split('/').filter(Boolean).length;
      const deepestDepth = deepest.path.split('/').filter(Boolean).length;
      return currentDepth > deepestDepth ? current : deepest;
    });

    const nextQuery = updateQueryCursor(query, deepestPagination.path, deepestPagination.next);
    this.query(nextQuery).catch(err => this.handleError(err));
  }

  private startSource(type: SourceType): void {
    this.activeSources.add(type);
  }

  private stopSource(type: SourceType): void {
    this.activeSources.delete(type);
    if (this.activeSources.size === 0) {
      this.close();
    }
  }

  private handleError(error: Error): void {
    this.emit('error', error);
    this.close();
  }
}

export function updateQueryCursor(query: string, path: string, newCursor: string): string {
  query = query.trim().slice('query {'.length, query.length - 1).trim();
  const pathParts = path.replace(/^\/+/u, '').split('/');

  function insertCursorAtField(source: string, parts: string[]): string {
    const field = parts[0];
    let index = 0;
    let inString = false;

    while (index < source.length) {
      const char = source[index];

      if (char === '"') {
        inString = !inString;
        index++;
        continue;
      }

      if (!inString && field && new RegExp(`^\\b${field}\\b`, 'u').test(source.slice(index))) {
        const matchStart = index;
        const matchEnd = index + field.length;

        let argsStart = -1;
        let argsEnd = -1;
        let bodyStart = -1;

        index = matchEnd;

        while (/\s/u.test(source[index])) {
          index++;
        }

        if (source[index] === '(') {
          argsStart = index;
          let parenCount = 1;
          index++;
          while (index < source.length && parenCount > 0) {
            if (source[index] === '(') {
              parenCount++;
            } else if (source[index] === ')') {
              parenCount--;
            }
            index++;
          }
          argsEnd = index;
        }

        while (/\s/u.test(source[index])) {
          index++;
        }

        if (source[index] === '{') {
          bodyStart = index;
        }

        if (parts.length === 1) {
          let updatedField = '';

          if (argsStart === -1) {
            updatedField = `${field}(cursor: "${newCursor}") `;
          } else {
            const argsStr = source
              .slice(argsStart + 1, argsEnd - 1)
              .split(',')
              .map(arg => arg.trim())
              .filter(arg => arg && !arg.startsWith('cursor:'));
            argsStr.push(`cursor: "${newCursor}"`);
            updatedField = `${field}(${argsStr.join(', ')})`;
          }

          return source.slice(0, matchStart) + updatedField + source.slice(index);
        }

        if (bodyStart !== -1) {
          let braceCount = 1;
          let bodyEnd = bodyStart + 1;
          while (bodyEnd < source.length && braceCount > 0) {
            if (source[bodyEnd] === '{') {
              braceCount++;
            } else if (source[bodyEnd] === '}') {
              braceCount--;
            }
            bodyEnd++;
          }

          const before = source.slice(0, bodyStart + 1);
          const body = source.slice(bodyStart + 1, bodyEnd - 1);
          const after = source.slice(bodyEnd - 1);

          const newBody = insertCursorAtField(body, parts.slice(1));
          return before + newBody + after;
        }
      }

      index++;
    }

    throw new Error(`Unable to update query with cursor ${newCursor} at path ${path}`);
  }

  return `query { ${insertCursorAtField(query, pathParts)} }`;
}
