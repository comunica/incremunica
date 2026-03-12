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
  protected addQuery: string | undefined;
  protected addRespMapper: ResponseMapper | undefined;
  protected delQuery: string | undefined;
  protected delRespMapper: ResponseMapper | undefined;
  protected initQuery: string | undefined;
  protected initRespMapper: ResponseMapper | undefined;

  protected buffer: Queue<RDF.Bindings>;
  protected decoder: TextDecoder;

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

    // Map addition subscription if possible
    try {
      [ this.addQuery, this.addRespMapper ] = queryMapper.subscribeOperation(operation, 'addition')[0];
    } catch {
      this.addQuery = this.addRespMapper = undefined;
    }

    // Map deletion subscription if possible
    try {
      [ this.delQuery, this.delRespMapper ] = queryMapper.subscribeOperation(operation, 'deletion')[0];
    } catch {
      this.delQuery = this.delRespMapper = undefined;
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
    this.query(this.initQuery).catch((err) => {
      this.handleError(err);
    });

    // Start deletion stream
    if (this.delQuery && this.delRespMapper) {
      this.subscribe(this.delQuery, this.delRespMapper, false).catch((err) => {
        this.handleError(err);
      });
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

  private async subscribe(query: string, resMapper: ResponseMapper, isAddition: boolean): Promise<void> {
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
          this.close();
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

            bindings.map(b => b.setContextEntry(KeysBindings.isAddition, isAddition));
            for (const b of bindings) {
              this.buffer.push(b);
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
      if (this.addQuery && this.addRespMapper) {
        this.subscribe(this.addQuery, this.addRespMapper, true).catch((err) => {
          this.handleError(err);
        });
      }
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
      // Try to read the body for extra error info
      let errorBody: any;
      try {
        errorBody = await response.text();
      } catch {
        errorBody = '<failed to read body>';
      }

      throw new Error(`HTTP ${response.status} ${response.statusText}: ${errorBody}`);
    }

    // Parse response and map to bindings
    const json = await response.json();
    const bindings = this.initRespMapper!.dataToBindings(
      json.data,
      this.variables,
      this.dataFactory,
      this.bindingsFactory,
    );

    bindings.map(b => b.setContextEntry(KeysBindings.isAddition, true));
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
      if (this.addQuery && this.addRespMapper) {
        this.subscribe(this.addQuery, this.addRespMapper, true).catch((err) => {
          this.handleError(err);
        });
      }
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

  private handleError(error: Error): void {
    this.emit('error', error);
    this.close();
  }
}

function updateQueryCursor(query: string, path?: string, newCursor = ''): string {
  const pathParts = path ? path.replace(/^\/+/u, '').split('/') : [];

  function insertCursorAtField(source: string, parts: string[], depth = 0): string {
    const field = parts[0];
    let index = 0;
    let inString = false;

    while (index < source.length) {
      const char = source[index];

      // Handle string quotes properly (avoid modifying inside strings)
      if (char === '"') {
        inString = !inString;
        index++;
        continue;
      }

      // Root-level query injection
      if (parts.length === 0 && depth === 0) {
        // Find the first field in the query body
        const fieldMatch = /\b([_A-Za-z][_0-9A-Za-z]*)\b\s*(\(|\{)/u.exec(source);
        if (!fieldMatch) {
          throw new Error('Unable to locate root field in query.');
        }

        const fieldName = fieldMatch[1];
        const matchStart = fieldMatch.index;
        const matchEnd = matchStart + fieldName.length;
        let i = matchEnd;

        // Skip whitespace
        while (/\s/u.test(source[i])) {
          i++;
        }

        // Check for existing arguments
        if (source[i] === '(') {
          let parenCount = 1;
          const argsStart = i;
          i++;

          while (i < source.length && parenCount > 0) {
            if (source[i] === '(') {
              parenCount++;
            } else if (source[i] === ')') {
              parenCount--;
            }
            i++;
          }

          const argsEnd = i;
          const argsStr = source
            .slice(argsStart + 1, argsEnd - 1)
            .split(',')
            .map(arg => arg.trim())
            .filter(arg => arg && !arg.startsWith('cursor:'));

          argsStr.push(`cursor: "${newCursor}"`);
          const updatedField = `${fieldName}(${argsStr.join(', ')})`;

          return (
            source.slice(0, matchStart) +
            updatedField +
            source.slice(argsEnd)
          );
        }
        // No args → inject a new one
        const updatedField = `${fieldName}(cursor: "${newCursor}")`;
        return (
          source.slice(0, matchStart) +
            updatedField +
            source.slice(matchEnd)
        );
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
            updatedField = `${field}(cursor: "${newCursor}")`;
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

  return insertCursorAtField(query, pathParts);
}
