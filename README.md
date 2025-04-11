<h1 align="center">
    Incremunica
</h1>

<p align="center">
  <strong>Incremental query evaluation for Comunica</strong>
</p>

<p align="center">
<a href="https://github.com/comunica/incremunica/actions/workflows/CI.yml?query=branch%3Amaster"><img src="https://github.com/comunica/incremunica/actions/workflows/CI.yml/badge.svg?branch=master" alt="Build Status"></a>
<a href="https://coveralls.io/github/comunica/incremunica?branch=master"><img src="https://coveralls.io/repos/github/comunica/incremunica/badge.svg?branch=master" alt="Coverage Status"></a>
<a href="https://comunica.github.io/incremunica/"><img src="https://img.shields.io/badge/doc-code_documentation-blueviolet"/></a>
</p>

This is a monorepo that builds upon the core Comunica packages to allow for incremental query evaluation.

## Querying with Incremunica

To query with Incremunica, you can follow the guide in the [`@incremunica/query-sparql-incremental`](https://www.npmjs.com/package/@incremunica/query-sparql-incremental?activeTab=readme) package on npm.
The rest of this readme is intended for developers who want to contribute to Incremunica.

## Contributing to Incremunica
**tl;dr:** Use `yarn install` instead of ~~`npm install`~~ and generally pull request should go to the `next/minor` branch.

_(JSDoc: https://comunica.github.io/incremunica/)_

This repository should be used by Comunica module **developers** as it contains multiple Incremunica modules that can be composed.
This repository is managed as a [monorepo](https://github.com/babel/babel/blob/master/doc/design/monorepo.md)
using [Lerna](https://lernajs.io/).

If you want to develop new features
or use the (potentially unstable) in-development version,
you can set up a development environment for Incremunica.

Incremunica requires [Node.JS](http://nodejs.org/) 8.0 or higher and the [Yarn](https://yarnpkg.com/en/) package manager.
Incremunica is tested on OSX, Linux and Windows.

This project can be setup by cloning and installing it as follows:

```bash
$ git clone https://github.com/comunica/incremunica.git
$ cd incremunica
$ yarn install
```

**Note: ~~`npm install`~~ is not supported at the moment, as this project makes use of Yarn's [workspaces](https://yarnpkg.com/lang/en/docs/workspaces/) functionality**

This will install the dependencies of all modules, and bootstrap the Lerna monorepo.

Furthermore, this will add [pre-commit hooks](https://www.npmjs.com/package/pre-commit)
to build, lint and test.
These hooks can temporarily be disabled at your own risk by adding the `-n` flag to the commit command.

### pull requests
If you want to contribute to Incremunica, please fork the repository and create a pull request.
The master branch will always be equal to the latest stable release to npm.
So, for minor changes, please create a pull request to the `next/minor` branch.
Once enough features are added to the `next/minor` branch, a new patch or minor version will be released to npm, and the branch will be merged into the `master` branch.
Major changes should be created on a new branch, and once they are stable, they can be merged into the `next/major` branch.
Incremunica generally follows the major release cycle of Comunica.

## License
This code is copyrighted by [Ghent University – imec](http://idlab.ugent.be/)
and released under the [MIT license](http://opensource.org/licenses/MIT).
