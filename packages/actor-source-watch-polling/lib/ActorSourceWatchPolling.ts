import { EventEmitter } from 'events';
import type { MediatorHttp } from '@comunica/bus-http';
import type { IActorTest, TestResult } from '@comunica/core';
import { passTest } from '@comunica/core';
import type {
  IActionSourceWatch,
  IActorSourceWatchArgs,
  IActorSourceWatchOutput,
} from '@incremunica/bus-source-watch';
import {
  ActorSourceWatch,
} from '@incremunica/bus-source-watch';
import { KeysSourceWatch } from '@incremunica/context-entries';
import type { ISourceWatchEventEmitter } from '@incremunica/types';

function shouldEmitDeleteForStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404 || status === 410 || status === 451;
}

/**
 * An incremunica Polling Source Watch Actor.
 */
export class ActorSourceWatchPolling extends ActorSourceWatch {
  public readonly mediatorHttp: MediatorHttp;
  public readonly defaultPollingPeriod: number;

  private readonly regex = /max-age=(\d+)/u;

  public constructor(args: IActorSourceWatchPollingArgs) {
    super(args);
  }

  public async test(_action: IActionSourceWatch): Promise<TestResult<IActorTest>> {
    return passTest({ priority: this.priority });
  }

  public async run(action: IActionSourceWatch): Promise<IActorSourceWatchOutput> {
    const events: ISourceWatchEventEmitter = new EventEmitter();

    const maxAgeArray = this.regex.exec(action.metadata['cache-control']);
    let pollingPeriod: number;
    if (maxAgeArray) {
      pollingPeriod = Number.parseInt(maxAgeArray[1], 10);
    } else if (action.context.has(KeysSourceWatch.pollingPeriod)) {
      pollingPeriod = action.context.get(KeysSourceWatch.pollingPeriod)!;
    } else {
      pollingPeriod = this.defaultPollingPeriod;
    }

    let pollingStartTime = Date.now() + (pollingPeriod - Number.parseInt(action.metadata.age, 10)) * 1000;

    let etag = action.metadata.etag;
    const checkForChanges = (): void => {
      // TODO [2026-10-01]: what if the source doesn't support HEAD requests, if it's a SPARQL endpoint for example?
      this.mediatorHttp.mediate(
        {
          context: action.context,
          input: action.url,
          init: {
            method: 'HEAD',
          },
        },
      ).then((responseHead) => {
        if (responseHead.headers.has('age')) {
          pollingStartTime = Date.now() + (pollingPeriod - Number.parseInt(action.metadata.age, 10)) * 1000;
        }

        if (!responseHead.ok) {
          if (shouldEmitDeleteForStatus(responseHead.status)) {
            events.emit('delete');
          }
          return;
        }
        if (responseHead.headers.get('etag') !== etag) {
          events.emit('update');
          etag = responseHead.headers.get('etag');
        }
      }).catch(() => {
        // Ignore transient transport errors and retry in the next cycle.
      });
    };

    let loopId: NodeJS.Timeout | undefined;
    const startCheckLoop = (): void => {
      checkForChanges();
      loopId = setInterval(
        checkForChanges,
        pollingPeriod * 1_000,
      );
    };

    let running = false;
    let timeoutId: NodeJS.Timeout | undefined;
    const start = (): void => {
      if (running) {
        return;
      }
      running = true;
      if (pollingStartTime) {
        let waitTime: number;
        const now = Date.now();
        if (now > pollingStartTime) {
          waitTime = pollingPeriod * 1_000 - ((now - pollingStartTime) % (pollingPeriod * 1_000));
          checkForChanges();
        } else {
          waitTime = (pollingStartTime - now);
        }
        timeoutId = setTimeout(
          startCheckLoop,
          waitTime,
        );
      } else {
        timeoutId = setTimeout(
          startCheckLoop,
          pollingPeriod * 1_000,
        );
      }
    };

    return {
      events,
      stop(): void {
        if (!running) {
          return;
        }
        running = false;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (loopId) {
          clearInterval(loopId);
        }
      },
      start,
    };
  }
}

export interface IActorSourceWatchPollingArgs extends IActorSourceWatchArgs {
  /**
   * The HTTP mediator
   */
  mediatorHttp: MediatorHttp;
  /**
   * The Polling Period in seconds
   */
  defaultPollingPeriod: number;
}
