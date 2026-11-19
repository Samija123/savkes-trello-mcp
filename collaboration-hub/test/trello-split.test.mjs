import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTrelloCard } from '../src/trello-split.mjs';
const id='abcdefabcdefabcdefabcdef';
test('rejects demo IDs without calling Trello', async()=>{
 let calls=0;
 await assert.rejects(splitTrelloCard({cardId:'TRELLO-42',ownerWork:'A',collaboratorWork:'B',collaboratorName:'Dev B',key:'x',token:'y',fetchImpl:()=>{calls++;}}), /real 24-character/);
 assert.equal(calls,0);
});
test('creates new card and never modifies original', async()=>{
 const calls=[];
 const mock=async(url,opts)=>{
  calls.push({url,opts});
  return {ok:true,json:async()=>opts?{id:'123456789012345678901234',url:'https://trello.com/c/new'}:{id,name:'Original',desc:'Existing text',idList:'list-123',closed:false}};
 };
 const result=await splitTrelloCard({cardId:id,ownerWork:'Frontend',collaboratorWork:'Backend',collaboratorName:'Dev B',key:'x',token:'y',fetchImpl:mock});
 assert.equal(calls.length,2);
 assert.equal(calls[0].opts,undefined);
 assert.equal(calls[1].opts.method,'POST');
 assert.equal(new URLSearchParams(calls[1].opts.body).get('idList'),'list-123');
 assert.match(new URLSearchParams(calls[1].opts.body).get('desc'),/Backend/);
 assert.equal(result.newCardUrl,'https://trello.com/c/new');
});
test('does not write when Trello card lookup fails',async()=>{
 let calls=0;
 await assert.rejects(splitTrelloCard({cardId:id,ownerWork:'A',collaboratorWork:'B',collaboratorName:'Dev B',key:'x',token:'y',fetchImpl:async()=>{calls++;return {ok:false,status:404};}}),/404/);
 assert.equal(calls,1);
});
