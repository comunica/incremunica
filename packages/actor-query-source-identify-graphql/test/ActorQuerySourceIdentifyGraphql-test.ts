import { ActorQuerySourceIdentify } from '@comunica/bus-query-source-identify';
import { KeysInitQuery } from '@comunica/context-entries';
import { ActionContext, Bus } from '@comunica/core';
import { DataFactory } from 'rdf-data-factory';
import { ActorQuerySourceIdentifyGraphql } from '../lib';
import { QuerySourceGraphql } from '../lib/QuerySourceGraphql';
import { KeysGraphQLSource } from '../lib/SchemaKeys';

const mediatorMergeBindingsContext: any = {
  mediate: () => ({}),
};
const mediatorHttp: any = {
  mediate: () => ({}),
};

const DF = new DataFactory();

describe('ActorQuerySourceIdentifyGraphql', () => {
  let bus: any;

  beforeEach(() => {
    bus = new Bus({ name: 'bus' });
  });

  describe('The ActorQuerySourceIdentify module', () => {
    it('should be a function', () => {
      expect(ActorQuerySourceIdentifyGraphql).toBeInstanceOf(Function);
    });

    it('should be a ActorQuerySourceIdentify constructor', () => {
      expect(new (<any> ActorQuerySourceIdentifyGraphql)({ name: 'actor', bus }))
        .toBeInstanceOf(ActorQuerySourceIdentifyGraphql);
      expect(new (<any> ActorQuerySourceIdentifyGraphql)({ name: 'actor', bus }))
        .toBeInstanceOf(ActorQuerySourceIdentify);
    });

    it('should not be able to create new ActorQuerySourceIdentifyStream objects without \'new\'', () => {
      expect(() => {
        (<any> ActorQuerySourceIdentifyGraphql)();
      }).toThrow(`Class constructor ActorQuerySourceIdentifyGraphql cannot be invoked without 'new'`);
    });
  });

  describe('An ActorQuerySourceIdentifyGraphql instance', () => {
    let actor: ActorQuerySourceIdentifyGraphql;

    beforeEach(() => {
      actor = new ActorQuerySourceIdentifyGraphql({
        name: 'actor',
        bus,
        mediatorMergeBindingsContext,
        mediatorHttp,
      });
    });

    describe('test', () => {
      it('should allow graphql sources with schema and context', async() => {
        await expect(actor.test({
          querySourceUnidentified: {
            type: 'graphql',
            value: 'http://example.com/graphql',
            context: new ActionContext({
              [KeysGraphQLSource.schema.name]: '',
              [KeysGraphQLSource.context.name]: {},
            }),
          },
          context: new ActionContext(),
        })).resolves.toPassTest(true);
      });

      it('should not allow graphql sources without a schema', async() => {
        await expect(actor.test({
          querySourceUnidentified: {
            type: 'graphql',
            value: 'http://example.com/graphql',
            context: new ActionContext({
              [KeysGraphQLSource.context.name]: {},
            }),
          },
          context: new ActionContext(),
        })).resolves.toFailTest('actor requires a graphql schema to be present in the context.');
      });

      it('should not allow graphql sources without a context', async() => {
        await expect(actor.test({
          querySourceUnidentified: {
            type: 'graphql',
            value: 'http://example.com/graphql',
            context: new ActionContext({
              [KeysGraphQLSource.schema.name]: '',
            }),
          },
          context: new ActionContext(),
        })).resolves.toFailTest('actor requires a graphql schema context to be present in the context.');
      });

      it('should not allow other sources', async() => {
        await expect(actor.test({
          querySourceUnidentified: {
            type: 'sparql',
            value: 'http://example.com/sparql',
          },
          context: new ActionContext(),
        })).resolves.toFailTest('actor requires a single query source with graphql type to be present in the context.');
      });
    });

    describe('run', () => {
      it('should create a graphql source', async() => {
        const result = await actor.run({
          querySourceUnidentified: {
            type: 'graphql',
            value: 'http://example.com/graphql',
            context: new ActionContext({
              [KeysGraphQLSource.schema.name]: 'type Subscription { dummy: String }',
              [KeysGraphQLSource.context.name]: {},
            }),
          },
          context: new ActionContext({
            [KeysInitQuery.dataFactory.name]: DF,
          }),
        });

        expect(result.querySource.source).toBeInstanceOf(QuerySourceGraphql);
      });
    });
  });
});
