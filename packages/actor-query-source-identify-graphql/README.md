# Comunica Graphql Query Source Identify Actor

[![npm version](https://badge.fury.io/js/%40incremunica%2Factor-query-source-identify-graphql.svg)](https://www.npmjs.com/package/@incremunica/actor-query-source-identify-graphql)

A incremunica Graphql Query Source Identify Actor.

## Install

```bash
$ yarn add @incremunica/actor-query-source-identify-graphql
```

## Configure

After installing, this package can be added to your engine's configuration as follows:
```text
{
  "@context": [
    ...
    "https://linkedsoftwaredependencies.org/bundles/npm/@incremunica/actor-query-source-identify-graphql/^1.0.0/components/context.jsonld"
  ],
  "actors": [
    ...
    {
      "@id": "urn:comunica:default:query-source-identify/actors#graphql",
      "@type": "ActorQuerySourceIdentifyGraphql",
      "mediatorHttp": { "@id": "urn:comunica:default:http/mediators#main" }
    }
  ]
}
```

### Config Parameters

* `mediatorHttp`: A mediator over the [HTTP bus](https://github.com/comunica/comunica/tree/master/packages/bus-http).
