import type { ScenarioFilter } from '../execution/types.js';

export type IndividualFilterMode = 'inplay' | 'prematch';

export type IndividualMarketKey = Extract<
  ScenarioFilter,
  'moneyline' | 'total' | 'spread' | 'team_total'
>;

export type IndividualOutcomeKey = 'home' | 'away' | 'draw' | 'over' | 'under';

export interface IndividualFilterRule {
  id: string;
  order: number;
  name: string;
  /** Lowercased sport key, empty = any sport */
  sport: string;
  markets: IndividualMarketKey[];
  outcomes: IndividualOutcomeKey[];
  minLine?: number;
  maxLine?: number;
  /** Lowercased substrings matched against `periodName` */
  periodNames: string[];
}
