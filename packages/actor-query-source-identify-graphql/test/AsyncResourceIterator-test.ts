import type { MediatorHttp } from '@comunica/bus-http';
import { ActionContext } from '@comunica/core';
import type { IActionContext } from '@comunica/types';
import { BindingsFactory } from '@comunica/utils-bindings-factory';
import { QueryMapper } from '@comunica-graphql/sparql2graphql-converter';
import { isAddition } from '@incremunica/user-tools';
import { DataFactory } from 'rdf-data-factory';
import { Factory, translate } from 'sparqlalgebrajs';
import { AsyncResourceIterator } from '../lib/AsyncResourceIterator';

const mediatorMergeBindingsContext: any = {
  mediate: () => ({}),
};

function createInteractiveGraphqlService(
  additionField?: string,
  deletionField?: string,
  queryResponses?: any[],
) {
  const encoder = new TextEncoder();

  let additionController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let deletionController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let queryResponseIndex = -1;

  function createSseStream(assign: (c: ReadableStreamDefaultController<Uint8Array>) => void) {
    return new ReadableStream({
      start(controller) {
        assign(controller);
      },
    });
  }

  return {
    mediator: {
      mediate: jest.fn(async(action: any) => {
        const body = action.init?.body ? JSON.parse(action.init.body) : {};
        const query = body.query ?? '';

        // Handle addition subscription
        if (query.includes(additionField ?? '')) {
          if (!additionField) {
            return new Response('Addition subscription failed', { status: 400 });
          }

          const stream = createSseStream((c) => {
            additionController = c;
          });

          return new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }

        // Handle deletion subscription
        if (query.includes(deletionField ?? '')) {
          if (!deletionField) {
            return new Response(null, {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            });
          }

          const stream = createSseStream((c) => {
            deletionController = c;
          });

          return new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }

        // Handle initial query
        if (query.includes('query')) {
          if (queryResponses === undefined) {
            return new Response('Init query failed', { status: 400 });
          }

          queryResponseIndex += 1;
          return new Response(JSON.stringify(queryResponses[queryResponseIndex]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(null, { status: 400 });
      }),
    },

    emitAddition(event: any) {
      if (!additionController) {
        throw new Error('Addition stream not started');
      }

      additionController.enqueue(
        encoder.encode(
          `event: next\n` +
          `data: ${JSON.stringify(event)}\n\n`,
        ),
      );
    },

    emitDeletion(event: any) {
      if (!deletionController) {
        throw new Error('Deletion stream not started');
      }

      deletionController.enqueue(
        encoder.encode(
          `event: next\n` +
          `data: ${JSON.stringify(event)}\n\n`,
        ),
      );
    },

    close() {
      additionController?.close();
      deletionController?.close();
    },
  };
}

function waitForReadable(iterator: AsyncResourceIterator): Promise<void> {
  return new Promise((resolve) => {
    if (iterator.readable) {
      resolve();
      return;
    }

    iterator.once('readable', resolve);
  });
}

const DF = new DataFactory();

describe('AsyncResourceIterator', () => {
  let context: IActionContext;
  let BF: BindingsFactory;
  let AF: Factory;

  beforeEach(async() => {
    context = new ActionContext({});
    BF = await BindingsFactory.create(mediatorMergeBindingsContext, new ActionContext(), DF);
    AF = new Factory(DF);
  });

  it('should convert an operation, execute graphql queries and push bindings', async() => {
    const svc = createInteractiveGraphqlService(
      'onPersonAdded',
      'onPersonDeleted',
      [
        {
          data: {
            persons: [
              {
                id: 'http://example.org/alice',
                ex_name: 'Alice',
              },
              {
                id: 'http://example.org/bob',
                ex_name: 'Bob',
              },
            ],
          },
        },
      ],
    );

    const op = translate(`
      PREFIX ex: <http://example.org/>
      SELECT ?person ?name WHERE { ?person ex:name ?name }
    `);

    const schema_context = { ex: 'http://example.org/' };
    const schema_string = `
      type Query {
        persons: [ex_Person!]!
      }

      type Subscription {
        onPersonAdded: ex_Person!
        onPersonDeleted: ex_Person!
      }

      type ex_Person {
        id: ID!
        ex_name: String!
      }
    `;

    const variables = [ DF.variable('person'), DF.variable('name') ];
    const queryMapper = new QueryMapper(schema_string, schema_context);

    const iterator = new AsyncResourceIterator(
      'http://example.org/test',
      context,
      schema_context,
      queryMapper,
      op,
      <MediatorHttp><unknown>svc.mediator,
      variables,
      DF,
      BF,
    );

    // Wait until both subscription streams are started
    while (svc.mediator.mediate.mock.calls.length < 3) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    svc.emitAddition({
      data: {
        onPersonAdded: {
          id: 'http://example.org/carol',
          ex_name: 'Carol',
        },
      },
    });

    svc.emitDeletion({
      data: {
        onPersonDeleted: {
          id: 'http://example.org/dylan',
          ex_name: 'Dylan',
        },
      },
    });

    svc.close();

    // Alice
    await waitForReadable(iterator);
    let bindings = iterator.read();
    expect(bindings).not.toBeNull();
    expect(isAddition(bindings!)).toBe(true);

    // Bob
    await waitForReadable(iterator);
    bindings = iterator.read();
    expect(bindings).not.toBeNull();
    expect(isAddition(bindings!)).toBe(true);

    // Carol
    await waitForReadable(iterator);
    bindings = iterator.read();
    expect(bindings).not.toBeNull();
    expect(isAddition(bindings!)).toBe(true);

    // Dylan
    await waitForReadable(iterator);
    bindings = iterator.read();
    expect(bindings).not.toBeNull();
    expect(isAddition(bindings!)).toBe(false);

    // Buffer empty now
    expect(iterator.readable).toBe(false);
    bindings = iterator.read();
    expect(bindings).toBeNull();

    // Wait for iterator to close
    await new Promise<void>((resolve) => {
      iterator.on('end', () => resolve());
      iterator.on('close', () => resolve());
    });
    expect(iterator.closed).toBe(true);
  });

  it('should handle paginated initial queries before starting subscriptions', async() => {
    const svc = createInteractiveGraphqlService(
      'onPersonAdded',
      'onPersonDeleted',
      [
        // Page 1
        {
          data: {
            persons: [
              {
                id: 'http://example.org/alice',
                ex_name: 'Alice',
              },
            ],
          },
          extensions: {
            pagination: [
              {
                path: '/persons',
                next: 'cursor1',
              },
            ],
          },
        },

        // Page 2
        {
          data: {
            persons: [
              {
                id: 'http://example.org/bob',
                ex_name: 'Bob',
              },
            ],
          },
          extensions: {
            pagination: [
              {
                path: '/persons',
                next: 'cursor2',
              },
            ],
          },
        },

        // Page 3 (last page, no pagination)
        {
          data: {
            persons: [
              {
                id: 'http://example.org/carol',
                ex_name: 'Carol',
              },
            ],
          },
        },
      ],
    );

    const op = translate(`
      PREFIX ex: <http://example.org/>
      SELECT ?person ?name WHERE { ?person ex:name ?name }
    `);

    const schema_context = { ex: 'http://example.org/' };

    const schema_string = `
      type Query {
        persons(cursor: String): [ex_Person!]!
      }

      type Subscription {
        onPersonAdded: ex_Person!
        onPersonDeleted: ex_Person!
      }

      type ex_Person {
        id: ID!
        ex_name: String!
      }
    `;

    const variables = [ DF.variable('person'), DF.variable('name') ];
    const queryMapper = new QueryMapper(schema_string, schema_context);

    const iterator = new AsyncResourceIterator(
      'http://example.org/test',
      context,
      schema_context,
      queryMapper,
      op,
      <MediatorHttp><unknown>svc.mediator,
      variables,
      DF,
      BF,
    );

    // Wait until all queries + subscriptions started
    while (svc.mediator.mediate.mock.calls.length < 5) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    // Alice (page 1)
    await waitForReadable(iterator);
    let bindings = iterator.read();
    expect(bindings).not.toBeNull();
    expect(isAddition(bindings!)).toBe(true);

    // Bob (page 2)
    await waitForReadable(iterator);
    bindings = iterator.read();
    expect(bindings).not.toBeNull();
    expect(isAddition(bindings!)).toBe(true);

    // Carol (page 3)
    await waitForReadable(iterator);
    bindings = iterator.read();
    expect(bindings).not.toBeNull();
    expect(isAddition(bindings!)).toBe(true);

    // Now test subscription still works
    svc.emitAddition({
      data: {
        onPersonAdded: {
          id: 'http://example.org/dylan',
          ex_name: 'Dylan',
        },
      },
    });

    await waitForReadable(iterator);
    bindings = iterator.read();
    expect(bindings).not.toBeNull();
    expect(isAddition(bindings!)).toBe(true);

    svc.close();
  });

  it('should throw if no valid addition subscription can be constructed', async() => {
    const svc = createInteractiveGraphqlService(
      'onPersonAdded',
      'onPersonDeleted',
      [],
    );

    const op = translate(`
      PREFIX ex: <http://example.org/>
      SELECT ?person ?name WHERE { ?person ex:name ?name }
    `);

    const schema_context = { ex: 'http://example.org/' };
    const schema_string = `
      type Subscription {
        onPersonDeleted: ex_Person!
      }

      type ex_Person {
        id: ID!
        ex_name: String!
      }
    `;

    const variables = [ DF.variable('person'), DF.variable('name') ];
    const queryMapper = new QueryMapper(schema_string, schema_context);

    expect(() => new AsyncResourceIterator(
      'http://example.org/test',
      context,
      schema_context,
      queryMapper,
      op,
      <MediatorHttp><unknown>svc.mediator,
      variables,
      DF,
      BF,
    )).toThrow(/Failed to convert SPARQL query to addition subscription stream/u);
  });

  it('should throw if no valid deletion subscription can be constructed', async() => {
    const svc = createInteractiveGraphqlService(
      'onPersonAdded',
      'onPersonDeleted',
    );

    const op = translate(`
      PREFIX ex: <http://example.org/>
      SELECT ?person ?name WHERE { ?person ex:name ?name }
    `);

    const schema_context = { ex: 'http://example.org/' };
    const schema_string = `
      type Subscription {
        onPersonAdded: ex_Person!
      }

      type ex_Person {
        id: ID!
        ex_name: String!
      }
    `;

    const variables = [ DF.variable('person'), DF.variable('name') ];
    const queryMapper = new QueryMapper(schema_string, schema_context);

    expect(() => new AsyncResourceIterator(
      'http://example.org/test',
      context,
      schema_context,
      queryMapper,
      op,
      <MediatorHttp><unknown>svc.mediator,
      variables,
      DF,
      BF,
    )).toThrow(/Failed to convert SPARQL query to deletion subscription stream/u);
  });

  it('should throw if init query fails', async() => {
    const svc = createInteractiveGraphqlService(
      'onPersonAdded',
      'onPersonDeleted',
      undefined,
    );

    const op = translate(`
      PREFIX ex: <http://example.org/>
      SELECT ?person ?name WHERE { ?person ex:name ?name }
    `);

    const schema_context = { ex: 'http://example.org/' };
    const schema_string = `
      type Query {
        persons: [ex_Person!]!
      }

      type Subscription {
        onPersonAdded: ex_Person!
        onPersonDeleted: ex_Person!
      }

      type ex_Person {
        id: ID!
        ex_name: String!
      }
    `;

    const variables = [ DF.variable('person'), DF.variable('name') ];
    const queryMapper = new QueryMapper(schema_string, schema_context);

    const iterator = new AsyncResourceIterator(
      'http://example.org/test',
      context,
      schema_context,
      queryMapper,
      op,
      <MediatorHttp><unknown>svc.mediator,
      variables,
      DF,
      BF,
    );

    await new Promise<void>((resolve, reject) => {
      iterator.on('error', (err) => {
        try {
          expect(err.message).toMatch(/Unable to execute initial query/u);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it('should throw if subscription is unreadable', async() => {
    const svc = createInteractiveGraphqlService(
      'onPersonAdded',
      undefined,
    );

    const op = translate(`
      PREFIX ex: <http://example.org/>
      SELECT ?person ?name WHERE { ?person ex:name ?name }
    `);

    const schema_context = { ex: 'http://example.org/' };
    const schema_string = `
      type Subscription {
        onPersonAdded: ex_Person!
        onPersonDeleted: ex_Person!
      }

      type ex_Person {
        id: ID!
        ex_name: String!
      }
    `;

    const variables = [ DF.variable('person'), DF.variable('name') ];
    const queryMapper = new QueryMapper(schema_string, schema_context);

    const iterator = new AsyncResourceIterator(
      'http://example.org/test',
      context,
      schema_context,
      queryMapper,
      op,
      <MediatorHttp><unknown>svc.mediator,
      variables,
      DF,
      BF,
    );

    await new Promise<void>((resolve, reject) => {
      iterator.on('error', (err) => {
        try {
          expect(err.message).toMatch(/Unable to parse body of subscription stream/u);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it('should throw if subscription fails to start', async() => {
    const svc = createInteractiveGraphqlService(
      undefined,
      'onPersonDeleted',
    );

    const op = translate(`
      PREFIX ex: <http://example.org/>
      SELECT ?person ?name WHERE { ?person ex:name ?name }
    `);

    const schema_context = { ex: 'http://example.org/' };
    const schema_string = `
      type Subscription {
        onPersonAdded: ex_Person!
        onPersonDeleted: ex_Person!
      }

      type ex_Person {
        id: ID!
        ex_name: String!
      }
    `;

    const variables = [ DF.variable('person'), DF.variable('name') ];
    const queryMapper = new QueryMapper(schema_string, schema_context);

    const iterator = new AsyncResourceIterator(
      'http://example.org/test',
      context,
      schema_context,
      queryMapper,
      op,
      <MediatorHttp><unknown>svc.mediator,
      variables,
      DF,
      BF,
    );

    await new Promise<void>((resolve, reject) => {
      iterator.on('error', (err) => {
        try {
          expect(err.message).toMatch(/Unable to start subscription stream/u);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it('should throw if data is unreadable', async() => {
    const svc = createInteractiveGraphqlService(
      'onPersonAdded',
      'onPersonDeleted',
    );

    const op = translate(`
      PREFIX ex: <http://example.org/>
      SELECT ?person ?name WHERE { ?person ex:name ?name }
    `);

    const schema_context = { ex: 'http://example.org/' };
    const schema_string = `
      type Subscription {
        onPersonAdded: ex_Person!
        onPersonDeleted: ex_Person!
      }

      type ex_Person {
        id: ID!
        ex_name: String!
      }
    `;

    const variables = [ DF.variable('person'), DF.variable('name') ];
    const queryMapper = new QueryMapper(schema_string, schema_context);

    const iterator = new AsyncResourceIterator(
      'http://example.org/test',
      context,
      schema_context,
      queryMapper,
      op,
      <MediatorHttp><unknown>svc.mediator,
      variables,
      DF,
      BF,
    );

    svc.emitAddition(null);

    await new Promise<void>((resolve, reject) => {
      iterator.on('error', (err) => {
        try {
          expect(err.message).toMatch(/Cannot read properties of null/u);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });
});
