import { ActionContextKey } from '@comunica/core';
import type {
  BindingsOrder,
  IDetermineChangesEvents,
  ISourceWatchEventEmitter,
  MatchOptions,
} from '@incremunica/types';

/**
 * When adding entries to this file, also add a shortcut for them in the contextKeyShortcuts TSDoc comment in
 * ActorIniQueryBase in @comunica/actor-init-query if it makes sense to use this entry externally.
 * Also, add this shortcut to IQueryContextCommon in @comunica/types.
 */

export const KeysDetermineChanges = {
  /**
   * Events sent by the determine-changes actor.
   */
  events: new ActionContextKey<IDetermineChangesEvents>('@incremunica/determine-changes:events'),
};

export const KeysStreamingSource = {
  matchOptions: new ActionContextKey<MatchOptions[]>('@incremunica/streaming-source:matchOptions'),
};

export const KeysBindings = {
  isAddition: new ActionContextKey<boolean>('@incremunica/bindings:isAddition'),
  order: new ActionContextKey<BindingsOrder>('@incremunica/bindings:order'),
};

export const KeysSourceWatch = {
  pollingPeriod: new ActionContextKey<number>('@incremunica/source-watch:pollingPeriod'),
  deferredEvaluationTrigger:
    new ActionContextKey<ISourceWatchEventEmitter>('@incremunica/source-watch:deferredEvaluationTrigger'),
};
