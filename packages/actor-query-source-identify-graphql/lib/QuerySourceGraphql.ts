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
import type * as RDF from '@rdfjs/types';
import type { AsyncIterator } from 'asynciterator';
import { Algebra, Util, Factory } from 'sparqlalgebrajs';
import type { Operation, Ask, Update } from 'sparqlalgebrajs/lib/algebra';
import { AsyncResourceIterator } from './AsyncResourceIterator';
import { SparqlQueryConverter } from './SparqlQueryConverter';

export class QuerySourceGraphql implements IQuerySource {
  protected readonly selectorShape: FragmentSelectorShape;
  protected readonly schemaSelectorShape: FragmentSelectorShape;
  protected readonly tripleSelectorShape: FragmentSelectorShape;
  public referenceValue: string;
  protected readonly source: string;

  private readonly dataFactory: ComunicaDataFactory;
  private readonly bindingsFactory: BindingsFactory;
  private readonly mediatorHttp: MediatorHttp;

  private readonly queryConverter: SparqlQueryConverter;

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

    this.queryConverter = new SparqlQueryConverter(dataFactory, schema_context, schema_source);
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
    const iterator = this.queryConversion(operation, variables, context);
    iterator.setProperty('metadata', {
      state: new MetadataValidationState(),
      cardinality: { type: 'exact', value: 1 },
      variables: variables.map(variable => ({ variable, canBeUndef: false })),
    });
    return iterator;
  }

  private queryConversion(
    operation: Algebra.Operation,
    variables: RDF.Variable[],
    context: IActionContext,
  ): AsyncIterator<RDF.Bindings> {
    function extractPatterns(op: Algebra.Operation): Algebra.Pattern[] {
      switch (op.type) {
        case Algebra.types.PROJECT:
          return extractPatterns(op.input);
        case Algebra.types.BGP:
          return op.patterns;
        case Algebra.types.PATTERN:
          return [ op ];
        case Algebra.types.JOIN: {
          const patterns: Algebra.Pattern[] = [];
          for (const child of op.input) {
            patterns.push(...extractPatterns(child));
          }
          return patterns;
        }
        default:
          throw new Error(`Unsupported operation type: ${op.type}`);
      }
    }

    const patterns = extractPatterns(operation);

    for (const [ query, varMap, filterMap ] of this.queryConverter.convertOperation(patterns)) {
      try {
        return new AsyncResourceIterator(
          this.source,
          query,
          context,
          this.mediatorHttp,
          variables,
          varMap,
          filterMap,
          this.dataFactory,
          this.bindingsFactory,
        );
      } catch {
        continue;
      }
    }

    throw new Error(`Unable to convert SPARQL Query to Graphql Query for source ${this.source}`);
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
