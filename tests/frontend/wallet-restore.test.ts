// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { restoreWallet, wallet } from '../../web/fingerprint/nft.js';
afterEach(()=>{Reflect.deleteProperty(window,'ethereum');wallet.account=null;wallet.chainId=null;});
it('restores an existing wallet grant across native pages without requesting permission or switching chains',async()=>{
  const account='0x1111111111111111111111111111111111111111';
  const request=vi.fn(async({method})=>method==='eth_accounts'?[account]:'0x3c8');
  Object.defineProperty(window,'ethereum',{configurable:true,value:{request}});
  expect(await restoreWallet()).toBe(true);expect(wallet.account).toBe(account);
  expect(request.mock.calls.map(([p])=>p.method)).toEqual(['eth_accounts','eth_chainId']);
});
it('keeps a locked wallet disconnected without prompting',async()=>{
  const request=vi.fn(async()=>[]);Object.defineProperty(window,'ethereum',{configurable:true,value:{request}});
  expect(await restoreWallet()).toBe(false);expect(wallet.account).toBeNull();expect(request).toHaveBeenCalledTimes(1);
});
