# Incremunica Bindings Aggregator Factory Count Actor

[![npm version](https://badge.fury.io/js/%40incremunica%2Factor-bindings-aggregator-factory-count.svg)](https://www.npmjs.com/package/@incremunica/actor-bindings-aggregator-factory-count)

A [bindings aggregator factory](https://github.com/comunica/comunica/tree/master/packages/bus-bindings-aggregator-factory) actor
that constructs a bindings aggregator capable of evaluating [count](https://www.w3.org/TR/sparql11-query/#defn_aggCount).

## Install

```bash
$ yarn add @incremunica/actor-bindings-aggregator-factory-count
```

## Configure

After installing, this package can be added to your engine's configuration as follows:
```text
{
  "@context": [
    ...
    "https://linkedsoftwaredependencies.org/bundles/npm/@incremunica/actor-bindings-aggregator-factory-count/^2.0.0/components/context.jsonld"
  ],
  "actors": [
    ...
    {
      "@id": "urn:comunica:default:bindings-aggregator-factory/actors#count",
      "@type": "ActorBindingsAggregatorFactoryCount"
    }
  ]
}
```
