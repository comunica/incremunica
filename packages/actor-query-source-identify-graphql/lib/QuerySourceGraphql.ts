import type { MediatorHttp } from '@comunica/bus-http';
import type {
  BindingsStream,
  ComunicaDataFactory,
  FragmentSelectorShape,
  IActionContext,
  IQuerySource,
} from '@comunica/types';
import type { BindingsFactory } from '@comunica/utils-bindings-factory';
import { MetadataValidationState } from '@comunica/utils-metadata';
import { QueryMapper } from '@comunica-graphql/sparql2graphql-converter';
import type * as RDF from '@rdfjs/types';
import type { AsyncIterator } from 'asynciterator';
import { Algebra, Util, Factory } from 'sparqlalgebrajs';
import type { Operation, Ask, Update } from 'sparqlalgebrajs/lib/algebra';
import { AsyncResourceIterator } from './AsyncResourceIterator';

export class QuerySourceGraphql implements IQuerySource {
  protected readonly selectorShape: FragmentSelectorShape;
  protected readonly schemaSelectorShape: FragmentSelectorShape;
  protected readonly tripleSelectorShape: FragmentSelectorShape;
  public referenceValue: string;
  protected readonly source: string;

  private readonly dataFactory: ComunicaDataFactory;
  private readonly bindingsFactory: BindingsFactory;
  private readonly mediatorHttp: MediatorHttp;

  private readonly queryContext: Record<string, string>;
  private readonly queryMapper: QueryMapper;

  public constructor(
    source: string,
    dataFactory: ComunicaDataFactory,
    bindingsFactory: BindingsFactory,
    mediator: MediatorHttp,
    schema_source: string,
    schema_context: Record<string, string>,
  ) {
    this.source = source;
    this.referenceValue = source;
    this.dataFactory = dataFactory;
    this.bindingsFactory = bindingsFactory;
    this.mediatorHttp = mediator;

    const AF = new Factory(<RDF.DataFactory> this.dataFactory);
    this.tripleSelectorShape = {
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
    this.schemaSelectorShape = {
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
        this.tripleSelectorShape,
      ],
    };

    this.queryContext = schema_context;
    this.queryMapper = new QueryMapper(schema_source, schema_context);
    this.selectorShape = this.schemaSelectorShape;
  }

  public async getSelectorShape(): Promise<FragmentSelectorShape> {
    return this.selectorShape;
  }

  public queryBindings(
    operation: Operation,
    context: IActionContext,
  ): BindingsStream {
    const variables = Util.inScopeVariables(operation);

    const iterator = new AsyncResourceIterator(
      this.source,
      context,
      this.queryContext,
      this.queryMapper,
      operation,
      this.mediatorHttp,
      variables,
      this.dataFactory,
      this.bindingsFactory,
    );

    iterator.setProperty('metadata', {
      state: new MetadataValidationState(),
      cardinality: { type: 'estimate', value: 1 },
      variables: variables.map(variable => ({ variable, canBeUndef: false })),
    });
    return iterator;
  }

  public queryQuads(
    _operation: Operation,
    _context: IActionContext,
  ): AsyncIterator<RDF.Quad> {
    throw new Error('queryQuads is not implemented in QuerySourceGraphql');
  }

  public queryBoolean(_operation: Ask, _context: IActionContext): Promise<boolean> {
    throw new Error('queryBoolean is not implemented in QuerySourceGraphql');
  }

  public queryVoid(_operation: Update, _context: IActionContext): Promise<void> {
    throw new Error('queryVoid is not implemented in QuerySourceGraphql');
  }

  public toString(): string {
    return `QuerySourceGraphql(${this.referenceValue})`;
  }
}
