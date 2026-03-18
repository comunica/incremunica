import type { MediatorHttp } from '@comunica/bus-http';
import type { IActionContext, ComunicaDataFactory } from '@comunica/types';
import type { BindingsFactory } from '@comunica/utils-bindings-factory';
import type { QueryMapper, ResponseMapper } from '@comunica-graphql/sparql2graphql-converter';
import { KeysBindings } from '@incremunica/context-entries';
import { Queue } from '@incremunica/data-structures';
import type * as RDF from '@rdfjs/types';
import { AsyncIterator } from 'asynciterator';
import type { Algebra } from 'sparqlalgebrajs';

export class AsyncResourceIterator extends AsyncIterator<RDF.Bindings> {
  protected readonly source: string;
  protected readonly mediatorHttp: MediatorHttp;
  protected readonly context: IActionContext;

  private readonly variables: RDF.Variable[];
  private readonly dataFactory: ComunicaDataFactory;
  private readonly bindingsFactory: BindingsFactory;

  private readonly queryContext: Record<string, string>;
  protected addQuery: string;
  protected addRespMapper: ResponseMapper;
  protected delQuery: string;
  protected delRespMapper: ResponseMapper;
  protected initQuery: string | undefined;
  protected initRespMapper: ResponseMapper | undefined;

  protected buffer: Queue<RDF.Bindings>;
  protected decoder: TextDecoder;
  protected activeSources = 0;

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

    // Map addition subscription
    try {
      const converted = queryMapper.subscribeOperation(operation, 'addition');

      if (converted.length === 0) {
        throw new Error('No viable conversions found for this schema');
      }

      [ this.addQuery, this.addRespMapper ] = converted[0];
    } catch (err: unknown) {
      if (err instanceof Error) {
        throw new TypeError(`Failed to convert SPARQL query to addition subscription stream: ${err.message}`);
      }
    }

    // Map deletion subscription
    try {
      const converted = queryMapper.subscribeOperation(operation, 'deletion');

      if (converted.length === 0) {
        throw new Error('No viable conversions found for this schema');
      }

      [ this.delQuery, this.delRespMapper ] = converted[0];
    } catch (err: unknown) {
      if (err instanceof Error) {
        throw new TypeError(`Failed to convert SPARQL query to deletion subscription stream: ${err.message}`);
      }
    }

    // Map initial query if possible
    try {
      [ this.initQuery, this.initRespMapper ] = queryMapper.queryOperation(operation)[0];
    } catch {
      this.initQuery = this.initRespMapper = undefined;
    }

    this.buffer = new Queue<RDF.Bindings>();
    this.readable = false;
    this.decoder = new TextDecoder('utf-8');

    // Start initial query
    this.startSource();
    this.query(this.initQuery).catch((err) => {
      this.handleError(err);
    });

    // Start deletion stream
    this.startSource();
    this.subscribe(this.delQuery, this.delRespMapper, false).catch((err) => {
      this.handleError(err);
    });
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

  private async subscribe(query: string, resMapper: ResponseMapper, isAdditionValue: boolean): Promise<void> {
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
          this.stopSource();
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
            const bindings = resMapper.dataToBindings(
              json.data,
              this.variables,
              this.dataFactory,
              this.bindingsFactory,
            );

            for (const b of bindings) {
              this.buffer.push(b.setContextEntry(KeysBindings.isAddition, isAdditionValue));
            }

            if (bindings.length > 0) {
              this.readable = true;
            }
          }
        }
      }
    };
    handleSSE().catch((err) => {
      this.handleError(err);
    });
  }

  private async query(query?: string): Promise<void> {
    // Start additions subscriptions stream if initial query is done
    if (!query) {
      // Start the subscription source
      this.startSource();
      this.subscribe(this.addQuery, this.addRespMapper, true).catch((err) => {
        this.handleError(err);
      });
      // Stop the init query source
      this.stopSource();
      return;
    }

    // Get query response
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

    // Parse response and map to bindings
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

    // Handle pagination
    const paginations = json?.extensions?.pagination?.filter((p: any) => p?.next);

    // If no pagination, start the addition stream
    if (!paginations || paginations.length === 0) {
      // Start the subscription source
      this.startSource();
      this.subscribe(this.addQuery, this.addRespMapper, true).catch((err) => {
        this.handleError(err);
      });
      // Stop the init query source
      this.stopSource();
      return;
    }

    // Find the pagination with the deepest path
    const deepestPagination = paginations.reduce((deepest: any, current: any) => {
      const currentDepth = current.path.split('/').filter(Boolean).length;
      const deepestDepth = deepest.path.split('/').filter(Boolean).length;
      return currentDepth > deepestDepth ? current : deepest;
    });

    // Update query cursor
    const nextQuery = updateQueryCursor(query, deepestPagination.path, deepestPagination.next);
    this.query(nextQuery).catch((err) => {
      this.handleError(err);
    });
  }

  private startSource(): void {
    this.activeSources += 1;
  }

  private stopSource(): void {
    this.activeSources -= 1;
    if (this.activeSources === 0) {
      this.close();
    }
  }

  private handleError(error: Error): void {
    this.emit('error', error);
    this.close();
  }
}

export function updateQueryCursor(query: string, path: string, newCursor: string): string {
  // Remove query declaration
  query = query.trim().slice('query {'.length, query.length - 1).trim();
  const pathParts = path.replace(/^\/+/u, '').split('/');

  function insertCursorAtField(source: string, parts: string[], depth = 0): string {
    const field = parts[0];
    let index = 0;
    let inString = false;

    while (index < source.length) {
      const char = source[index];

      // Avoid modifying inside strings
      if (char === '"') {
        inString = !inString;
        index++;
        continue;
      }

      // Match target field at current depth
      if (!inString && field && new RegExp(`^\\b${field}\\b`, 'u').test(source.slice(index))) {
        const matchStart = index;
        const matchEnd = index + field.length;

        // Find args and body
        let argsStart = -1;
        let argsEnd = -1;
        let bodyStart = -1;

        index = matchEnd;

        while (/\s/u.test(source[index])) {
          index++;
        }

        // Handle arguments
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

        // Handle body
        if (source[index] === '{') {
          bodyStart = index;
        }

        // Leaf field — apply cursor
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

        // Recursive case
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

          const newBody = insertCursorAtField(body, parts.slice(1), depth + 1);
          return before + newBody + after;
        }
      }

      index++;
    }

    throw new Error(`Unable to update query with cursor ${newCursor} at path ${path}`);
  }

  return `query { ${insertCursorAtField(query, pathParts)} }`;
}
