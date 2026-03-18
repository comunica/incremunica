import { EventEmitter } from 'events';
import type { MediatorHttp } from '@comunica/bus-http';
import type { IActorTest, TestResult } from '@comunica/core';
import { failTest, passTest } from '@comunica/core';
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
 * An incremunica Deferred Source Watch Actor.
 */
export class ActorSourceWatchDeferred extends ActorSourceWatch {
  public readonly mediatorHttp: MediatorHttp;
  public constructor(args: IActorSourceWatchDeferredArgs) {
    super(args);
  }

  public async test(action: IActionSourceWatch): Promise<TestResult<IActorTest>> {
    if (!action.context.has(KeysSourceWatch.deferredEvaluationTrigger)) {
      return failTest('Context does not have \'deferredEvaluationTrigger\'');
    }
    const responseHead = await this.mediatorHttp.mediate(
      {
        context: action.context,
        input: action.url,
        init: {
          method: 'HEAD',
        },
      },
    );
    if (!responseHead.ok) {
      return failTest('Source does not support HEAD requests');
    }
    if (!responseHead.headers.get('etag')) {
      return failTest('Source does not support etag headers');
    }
    return passTest({ priority: this.priority });
  }

  public async run(action: IActionSourceWatch): Promise<IActorSourceWatchOutput> {
    const eventsSource: ISourceWatchEventEmitter = action.context
      .getSafe(KeysSourceWatch.deferredEvaluationTrigger);
    eventsSource.setMaxListeners(eventsSource.getMaxListeners() + 1);
    const outputEvents: ISourceWatchEventEmitter = new EventEmitter();

    let etag = action.metadata.etag;
    const checkForChanges = (): void => {
      this.mediatorHttp.mediate(
        {
          context: action.context,
          input: action.url,
          init: {
            method: 'HEAD',
          },
        },
      ).then((responseHead) => {
        if (!responseHead.ok) {
          if (shouldEmitDeleteForStatus(responseHead.status)) {
            outputEvents.emit('delete');
          }
          return;
        }
        if (responseHead.headers.get('etag') !== etag) {
          outputEvents.emit('update');
          etag = responseHead.headers.get('etag');
        }
      }).catch(() => {
        // Ignore transient transport errors and retry on next trigger.
      });
    };

    let running = false;
    return {
      events: outputEvents,
      start: () => {
        if (!running) {
          running = true;
          eventsSource.on('update', checkForChanges);
        }
      },
      stop: () => {
        if (running) {
          running = false;
          eventsSource.removeListener('update', checkForChanges);
        }
      },
    };
  }
}

export interface IActorSourceWatchDeferredArgs extends IActorSourceWatchArgs {
  /**
   * The HTTP mediator
   */
  mediatorHttp: MediatorHttp;
}
