import type { MediatorHttp } from '@comunica/bus-http';
import type { IActionContext, ComunicaDataFactory } from '@comunica/types';
import type { BindingsFactory } from '@comunica/utils-bindings-factory';
import { Queue } from '@incremunica/data-structures';
import type * as RDF from '@rdfjs/types';
import { AsyncIterator } from 'asynciterator';
import type { RawRDF } from './SparqlQueryConverter';

export type Resource = Record<string, string | RawRDF>;

export class AsyncResourceIterator extends AsyncIterator<RDF.Bindings> {
  protected readonly source: string;
  protected readonly mediatorHttp: MediatorHttp;
  protected readonly context: IActionContext;

  private readonly variables: RDF.Variable[];
  private readonly varMap: Record<string, string>;
  private readonly filterMap: Record<string, RawRDF>;
  private readonly dataFactory: ComunicaDataFactory;
  private readonly bindingsFactory: BindingsFactory;

  protected query: string;
  protected buffer: Queue<RDF.Bindings>;
  protected decoder: TextDecoder;

  public constructor(
    source: string,
    query: string,
    context: IActionContext,
    mediatorHttp: MediatorHttp,
    variables: RDF.Variable[],
    varMap: Record<string, string>,
    filterMap: Record<string, RawRDF>,
    dataFactory: ComunicaDataFactory,
    bindingsFactory: BindingsFactory,
  ) {
    super();
    this.source = source;
    this.query = query;
    this.mediatorHttp = mediatorHttp;
    this.context = context;
    this.variables = variables;
    this.varMap = varMap;
    this.filterMap = filterMap;
    this.dataFactory = dataFactory;
    this.bindingsFactory = bindingsFactory;

    this.buffer = new Queue<RDF.Bindings>();
    this.readable = false;
    this.decoder = new TextDecoder('utf-8');
    this.subscribe().catch((err) => {
      throw err;
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

  private resourceToBindings(resource: Resource): boolean {
    const bindings: Record<string, RDF.Term> = {};

    // --- Filter resources based on filterMap ---
    for (const filterId of Object.keys(this.filterMap)) {
      const filterValue: RawRDF = this.filterMap[filterId];

      if (!resource[filterId]) {
        // Resource does not have filterId so does not have to be filtered
        continue;
      }
      const resourceValue = <RawRDF> resource[filterId];

      if (filterValue['@id']) {
        if (resourceValue['@id'] !== filterValue['@id']) {
          // Doesn't match, skip resource
          return false;
        }
      } else if (filterValue['@type'] && filterValue['@value'] && (
        resourceValue['@value'] !== filterValue['@value'] ||
          resourceValue['@type'] !== filterValue['@type']
      )) {
        // Doesn't match, skip resource
        return false;
      }
    }

    // --- Convert resource values to RDF terms ---
    for (const variable of this.variables) {
      const varName = variable.value;
      const value = resource[this.varMap[varName]];

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        if (value['@id']) {
          bindings[varName] = this.dataFactory.namedNode(value['@id']);
        } else if (value['@value'] && value['@type']) {
          const valueType = this.dataFactory.namedNode(value['@type']);
          bindings[varName] = this.dataFactory.literal(value['@value'], valueType);
        } else {
          throw new Error(
            `Invalid RawRDF format for variable "${varName}": ${JSON.stringify(value)}`,
          );
        }
      } else {
        bindings[varName] = termFromValue(value, this.dataFactory);
      }
    }

    this.buffer.push(this.bindingsFactory.bindings(
      Object.entries(bindings).map(([ key, term ]) => [ this.dataFactory.variable(key), term ]),
    ));
    return true;
  }

  private async subscribe(): Promise<void> {
    const body = {
      '@context': {},
      query: `subscription { ${this.query} }`,
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
          throw new Error('SSE subscription stream closed unexpectedly.');
        }

        dataBuffer += this.decoder.decode(Buffer.from(value));
        const parts = dataBuffer.split('\n\n');
        dataBuffer = parts.pop() ?? '';

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
            const resource = flattenData(json.data);

            if (this.resourceToBindings(resource)) {
              this.readable = true;
            }
          }
        }
      }
    };
    handleSSE().catch((err) => {
      throw err;
    });
  }
}

function flattenData(obj: any, prefix = ''): Resource {
  const result: Resource = {};

  function recurse(value: any, keyPrefix: string): void {
    if (Array.isArray(value)) {
      // If an array is expected to represent one resource,
      // just flatten each element into the same object
      for (const el of value) {
        recurse(el, keyPrefix);
      }
      return;
    }

    if (typeof value !== 'object' || value === null) {
      // Primitive → assign directly
      result[keyPrefix] = value;
      return;
    }

    // Object → recurse over keys
    for (const [ key, val ] of Object.entries(value)) {
      const fullKey = keyPrefix ? `${keyPrefix}_${key}` : key;

      if (key === '_rawRDF' && typeof val === 'object' && val !== null) {
        // Preserve RawRDF as-is
        result[fullKey] = <RawRDF> val;
      } else {
        recurse(val, fullKey);
      }
    }
  }

  recurse(obj, prefix);
  return result;
}

function isUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function termFromValue(value: any, dataFactory: ComunicaDataFactory): RDF.Term {
  const XSD = 'http://www.w3.org/2001/XMLSchema#';

  if (typeof value === 'string') {
    if (isUri(value)) {
      return dataFactory.namedNode(value);
    }
    return dataFactory.literal(value, `${XSD}string`);
  }

  if (typeof value === 'number') {
    // Distinguish integers from decimals
    if (Number.isInteger(value)) {
      return dataFactory.literal(
        value.toString(),
        dataFactory.namedNode(`${XSD}integer`),
      );
    }
    return dataFactory.literal(
      value.toString(),
      dataFactory.namedNode(`${XSD}decimal`),
    );
  }

  if (typeof value === 'boolean') {
    return dataFactory.literal(
      value ? 'true' : 'false',
      dataFactory.namedNode(`${XSD}boolean`),
    );
  }

  if (value instanceof Date) {
    return dataFactory.literal(
      value.toISOString(),
      dataFactory.namedNode(`${XSD}dateTime`),
    );
  }

  // Default: treat as string
  return dataFactory.literal(
    value.toString(),
    dataFactory.namedNode(`${XSD}string`),
  );
}
