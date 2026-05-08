import type { Request, Response } from 'express';

import { getAccounts, invalidateAccountsCache } from '../account/accountManager.js';
import type { ExecutionAccount } from '../execution/types.js';

function redactAccount(a: ExecutionAccount): Omit<ExecutionAccount, 'password'> & { passwordSet: boolean } {
  const { password, ...rest } = a;
  return { ...rest, passwordSet: Boolean(password?.length) };
}

export function listAccounts(_req: Request, res: Response): void {
  const accounts = getAccounts().map(redactAccount);
  res.json({ accounts });
}

export function reloadAccounts(_req: Request, res: Response): void {
  invalidateAccountsCache();
  res.json({ ok: true, count: getAccounts().length });
}
