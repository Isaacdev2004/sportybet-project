import type { Request, Response } from 'express';

import type { IndividualFilterRule } from '../filters/individualFilterTypes.js';
import {
  getIndividualFilters,
  saveIndividualFilters,
} from '../state/individualFiltersStore.js';

const MAX_RULES = 200;

function parseRuleList(raw: unknown, label: string): IndividualFilterRule[] {
  if (!Array.isArray(raw)) {
    throw new Error(`"${label}" must be an array`);
  }
  if (raw.length > MAX_RULES) {
    throw new Error(`At most ${MAX_RULES} rules per mode`);
  }
  return raw as IndividualFilterRule[];
}

export function getIndividualFiltersHandler(_req: Request, res: Response): void {
  res.json(getIndividualFilters());
}

export function putIndividualFiltersHandler(req: Request, res: Response): void {
  try {
    const body = req.body as { inplay?: unknown; prematch?: unknown };
    const next = {
      inplay: parseRuleList(body.inplay, 'inplay'),
      prematch: parseRuleList(body.prematch, 'prematch'),
    };
    saveIndividualFilters(next);
    res.json(getIndividualFilters());
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
