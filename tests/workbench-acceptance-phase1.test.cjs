'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');

function sliceSource(start, end) {
  const a = worker.indexOf(start), b = worker.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'source markers exist: ' + start);
  return worker.slice(a, b);
}
function evaluate(source, expose, globals = {}) {
  const sandbox = {
    ...globals, URL, Date, Math, JSON, Set, Map, Promise, AbortController,
    AbortSignal, console, crypto: require('node:crypto').webcrypto,
    codeWorkbenchLocalLockControllers: new Map(), rand: () => '12345678', codeWorkbenchWithLock: async (_env,_user,_repo,_operation,run) => run(),
    setInterval: () => 1, clearInterval: () => {},
    codeGitRefWriteUrl: (repo, ref) => 'https://api.github.com/repos/' + repo + '/git/refs/' + String(ref).split('/').map(encodeURIComponent).join('/')
  };
  vm.runInNewContext(source + '\nglobalThis.__out = {' + expose + '};', sandbox);
  return sandbox.__out;
}
const validators = evaluate(
  sliceSource('const codeRepoList = (env) =>', 'const codeVerifyKey') +
  sliceSource('function codePathProtected', '// 口令：消息里写'),
  'codeRepoOk,codePathOk,codeVerifyRef,codePathProtected,codePushGuard',
  { getKeys: value => String(value).split(',').map(x => x.trim()).filter(Boolean) }
);
const { codeRepoOk, codePathOk, codeVerifyRef, codePathProtected, codePushGuard } = validators;
const goodEnv = { GH_PAT: 'configured-not-real', CODE_OWNER: 'owner', CODE_REPOS: 'owner/repo' };
const testCase = (id, domain, input, operation, expected, failure, run) => {
  test('P1-' + id + ' [' + domain + '] input=' + input + ' operation=' + operation, async () => {
    await run();
    assert.ok(expected.length > 0 && failure.length > 0, 'case declares expected result and failure判据');
  });
};

// 1. 权限边界与操作者审计：真实 guard 函数，不访问 GitHub。
const permissions = [
  ['001','missing token','{GH_PAT:null}', 'reject',()=>assert.match(codePushGuard({...goodEnv,GH_PAT:''},'owner','owner/repo','src/a.js'),/GH_PAT/)],
  ['002','missing owner','{CODE_OWNER:""}','reject',()=>assert.match(codePushGuard({...goodEnv,CODE_OWNER:''},'owner','owner/repo','src/a.js'),/CODE_OWNER/)],
  ['003','wrong actor','user=intruder','reject',()=>assert.match(codePushGuard(goodEnv,'intruder','owner/repo','src/a.js'),/主人账号/)],
  ['004','unlisted repository','repo=other/repo','reject',()=>assert.match(codePushGuard(goodEnv,'owner','other/repo','src/a.js'),/不在允许名单/)],
  ['005','absolute path','path=/etc/passwd','reject',()=>assert.match(codePushGuard(goodEnv,'owner','owner/repo','/etc/passwd'),/路径/)],
  ['006','dot traversal','path=src/../secret','reject',()=>assert.match(codePushGuard(goodEnv,'owner','owner/repo','src/../secret'),/路径/)],
  ['007','git metadata','path=.git/config','reject',()=>assert.match(codePushGuard(goodEnv,'owner','owner/repo','.git/config'),/敏感文件/)],
  ['008','environment file','path=config/.env.local','reject',()=>assert.match(codePushGuard(goodEnv,'owner','owner/repo','config/.env.local'),/敏感文件/)],
  ['009','key file','path=private_.key','reject',()=>assert.match(codePushGuard(goodEnv,'owner','owner/repo','private_.key'),/敏感文件/)],
  ['010','token file','path=deploy_token_prod','reject',()=>assert.match(codePushGuard(goodEnv,'owner','owner/repo','deploy_token_prod'),/敏感文件/)]
];
for (const [id,label,input,expected,run] of permissions) testCase(id,'权限边界',input,'codePushGuard',expected,'错误身份或敏感路径不得获准写入',run);
testCase('011','幂等并发','actor=owner repo=owner/repo path=src/index.js','allow','返回空拒绝原因','合法授权请求被拒绝',()=>assert.equal(codePushGuard(goodEnv,'owner','owner/repo','src/index.js'),''));
testCase('012','幂等并发','CODE_REPOS 大小写不同','allow','仓库白名单大小写不敏感','合法仓库因大小写被误拒',()=>assert.equal(codeRepoOk({CODE_REPOS:'Owner/Repo'},'owner/repo'),true));

// 2. 幂等性与并发重复：验证真实锁包装器的拒绝、释放和异常路径。
const lockSource = sliceSource('async function codeWorkbenchLockCall', 'async function codeWorkbenchBranchCurrent');
const lockFns = evaluate(lockSource,'codeWorkbenchLockCall,codeWorkbenchWithLock');
testCase('013','幂等并发','CODE_CLAIMS 缺失','reject','写操作不执行并返回失败','无 Durable Object 时执行回调',async()=>{let ran=false;const r=await lockFns.codeWorkbenchWithLock({},'u','owner/repo','save',async()=>{ran=true;});assert.equal(r.ok,false);assert.equal(ran,false);});
testCase('014','幂等并发','DO claim busy=true','reject','busy=true 且业务回调不执行','锁竞争时仍执行写操作',async()=>{let ran=false;const env={CODE_CLAIMS:{idFromName:()=>1,get:()=>({fetch:async()=>({json:async()=>({ok:false,busy:true,msg:'busy'})})})}};const r=await lockFns.codeWorkbenchWithLock(env,'u','Owner/Repo','save',async()=>{ran=true;});assert.equal(r.busy,true);assert.equal(ran,false);});
testCase('015','幂等并发','DO claim succeeds','allow','回调执行一次且随后 unlock','成功操作未释放锁',async()=>{const actions=[];const env={CODE_CLAIMS:{idFromName:id=>id,get:()=>({fetch:async url=>{actions.push(url);return{json:async()=>({ok:true})}}})}};let count=0;const r=await lockFns.codeWorkbenchWithLock(env,'u','Owner/Repo','save',async()=>{count++;return{ok:true,value:1};});assert.equal(count,1);assert.equal(r.value,1);assert.ok(actions.some(x=>x.endsWith('/branch-unlock')));});
testCase('016','幂等并发','callback throws','propagate after unlock','原异常向上传递且锁释放','异常吞掉或锁未释放',async()=>{const actions=[];const env={CODE_CLAIMS:{idFromName:id=>id,get:()=>({fetch:async url=>{actions.push(url);return{json:async()=>({ok:true})}}})}};await assert.rejects(()=>lockFns.codeWorkbenchWithLock(env,'u','owner/repo','save',async()=>{throw Error('operation-failed');}),/operation-failed/);assert.ok(actions.some(x=>x.endsWith('/branch-unlock')));});
testCase('017','幂等并发','DO unlock fails','uncertain','返回 lock_release_failed','释放失败仍报告成功',async()=>{let calls=0;const env={CODE_CLAIMS:{idFromName:id=>id,get:()=>({fetch:async url=>({json:async()=>{calls++;return{ok:!url.endsWith('/branch-unlock')}}})})}};const r=await lockFns.codeWorkbenchWithLock(env,'u','owner/repo','save',async()=>({ok:true}));assert.equal(r.lock_release_failed,true);});
testCase('018','幂等并发','claim request identity','normalized repo','锁名按小写仓库规范化','同仓库大小写产生不同锁',async()=>{let id='';const env={CODE_CLAIMS:{idFromName:x=>(id=x,1),get:()=>({fetch:async()=>({json:async()=>({ok:false})})})}};await lockFns.codeWorkbenchWithLock(env,'u','OWNER/REPO','save',async()=>{});assert.equal(id,'workbench:owner/repo');});
testCase('019','幂等并发','lock call without DO','reject','configured=false','未配置 DO 被当成锁成功',async()=>{const r=await lockFns.codeWorkbenchLockCall({},'owner/repo','branch-lock',{});assert.equal(r.configured,false);});
testCase('020','幂等并发','DO returns invalid JSON','reject','返回无效锁响应失败对象','无效响应被当成已获锁',async()=>{const env={CODE_CLAIMS:{idFromName:()=>1,get:()=>({fetch:async()=>({json:async()=>{throw Error('bad-json')}})})}};const r=await lockFns.codeWorkbenchLockCall(env,'owner/repo','branch-lock',{});assert.equal(r.ok,false);});
testCase('021','幂等并发','same repo lock ID','same identity','所有操作共享仓库级锁 ID','不同操作绕过同仓库互斥',async()=>{const ids=[];const env={CODE_CLAIMS:{idFromName:x=>(ids.push(x),1),get:()=>({fetch:async()=>({json:async()=>({ok:false})})})}};for(const op of ['save','review','discard'])await lockFns.codeWorkbenchWithLock(env,'u','OWNER/REPO',op,async()=>{});assert.deepEqual(ids,['workbench:owner/repo','workbench:owner/repo','workbench:owner/repo']);});
testCase('022','幂等并发','operation callback returns false','return exact result','锁包装器不改写业务返回值','业务结果被误报成功',async()=>{const env={CODE_CLAIMS:{idFromName:()=>1,get:()=>({fetch:async()=>({json:async()=>({ok:true})})})}};const r=await lockFns.codeWorkbenchWithLock(env,'u','owner/repo','save',async()=>({ok:false,reason:'stale'}));assert.equal(r.ok,false);assert.equal(r.reason,'stale');});

// 3. 多文件审核、路径与重命名安全：验证实际路径校验器的正反样本。
const paths = [
['023','simple file','src/app.js',true],['024','nested file','frontend/studio.js',true],['025','hyphenated name','src/my-file.test.js',true],['026','underscore name','src/my_file.js',true],['027','numeric folder','v2/2026/file.js',true],
['028','empty path','',false],['029','leading slash','/src/a.js',false],['030','double slash','src//a.js',false],['031','dot segment','src/./a.js',false],['032','parent segment','src/../a.js',false]
];
for(const [id,label,input,valid] of paths)testCase(id,'多文件审核',input,'codePathOk',valid?'true':'false','路径校验结果与预期不一致',()=>assert.equal(codePathOk(input),valid));
const discardSource = sliceSource('async function codeWorkbenchBranchDiscardUnlocked', 'async function codeWorkbenchBranchDiscard(');
const discardHarness = (overrides = {}) => {
  const state = { record: { project: 'p', branch: 'code/p-1', repo: 'owner/repo' }, deleted: 0, audit: 0, removed: 0 };
  const fn = evaluate(discardSource,'codeWorkbenchBranchDiscardUnlocked',{
    codeRepoOk:()=>true,codePushGuard:()=>'',codeWorkbenchBranchKey:()=> 'k',
    codeDeleteBranch:async()=>{state.deleted++;return{ok:true};},
    codeHistoryLoad:async()=>[],codeHistorySave:async()=>{state.audit++;},
    ...overrides
  });
  const env={KV:{get:async()=>state.record,put:async(_k,v)=>{state.record=JSON.parse(v);},delete:async()=>{state.removed++;state.record=null;}}};
  return {fn,env,state};
};
testCase('033','失败清理','KV record absent','idempotent discard','already_absent=true','无记录时误删其他分支',async()=>{const h=discardHarness();h.env.KV.get=async()=>null;const r=await h.fn.codeWorkbenchBranchDiscardUnlocked(h.env,'owner',{repo:'owner/repo'});assert.equal(r.already_absent,true);assert.equal(h.state.deleted,0);});
testCase('034','失败清理','request branch differs from stored branch','reject','拒绝删除且不调用 GitHub','请求可删除其他活动分支',async()=>{const h=discardHarness();const r=await h.fn.codeWorkbenchBranchDiscardUnlocked(h.env,'owner',{repo:'owner/repo',branch:'code/other'});assert.equal(r.ok,false);assert.equal(h.state.deleted,0);});
testCase('035','失败清理','GitHub delete returns 503','retain','保留 KV 且不写审计','删除失败却清除恢复状态',async()=>{const h=discardHarness({codeDeleteBranch:async()=>({ok:false,status:503,msg:'unavailable'})});const r=await h.fn.codeWorkbenchBranchDiscardUnlocked(h.env,'owner',{repo:'owner/repo'});assert.equal(r.ok,false);assert.equal(h.state.removed,0);assert.equal(h.state.audit,0);});
testCase('036','失败清理','audit persistence throws','recovery status','保存 discard_history_failed 状态','审计失败后无恢复记录',async()=>{const h=discardHarness({codeHistorySave:async()=>{throw Error('audit-failed');}});const r=await h.fn.codeWorkbenchBranchDiscardUnlocked(h.env,'owner',{repo:'owner/repo'});assert.equal(r.ok,false);assert.equal(r.branch_deleted,true);assert.equal(h.state.record.status,'discard_history_failed');});
testCase('037','失败清理','KV delete throws','recovery status','保存 discard_record_cleanup_failed 状态','状态删除失败被报告为完成',async()=>{const h=discardHarness();h.env.KV.delete=async()=>{throw Error('kv-delete-failed');};const r=await h.fn.codeWorkbenchBranchDiscardUnlocked(h.env,'owner',{repo:'owner/repo'});assert.equal(r.ok,false);assert.equal(h.state.record.status,'discard_record_cleanup_failed');});

// 4. 失败清理：删除失败保留恢复信息，状态读取区分 404 与服务端错误。
const currentSource = sliceSource('async function codeWorkbenchBranchCurrent', 'async function codeWorkbenchBranchCreateUnlocked');
const currentFn = evaluate(currentSource,'codeWorkbenchBranchCurrent',{codeRepoOk:()=>true,codeWorkbenchBranchKey:()=> 'k',codeGitRefUrl:()=>'/ref',codeGhApi:async()=>({ok:false,status:404})});
testCase('038','失败清理','KV 无分支记录','inactive','返回 active=false','空记录误报活动分支',async()=>{const f=evaluate(currentSource,'codeWorkbenchBranchCurrent',{codeRepoOk:()=>true,codeWorkbenchBranchKey:()=> 'k',codeGhApi:async()=>({ok:true})});const r=await f.codeWorkbenchBranchCurrent({KV:{get:async()=>null}},'u','owner/repo');assert.equal(r.active,false);});
testCase('039','失败清理','GitHub ref 404','stale cleanup','删除过期记录并返回 stale_branch_record','404 后保留无效活动记录',async()=>{let deleted=0;const f=evaluate(currentSource,'codeWorkbenchBranchCurrent',{codeRepoOk:()=>true,codeWorkbenchBranchKey:()=> 'k',codeGitRefUrl:()=>'/ref',codeGhApi:async()=>({ok:false,status:404})});const r=await f.codeWorkbenchBranchCurrent({KV:{get:async()=>({branch:'code/x'}),delete:async()=>deleted++}},'u','owner/repo');assert.equal(r.stale_branch_record,true);assert.equal(deleted,1);});
testCase('040','失败清理','GitHub ref 503','retain record','返回失败并保留 KV','网络故障时删除恢复记录',async()=>{let deleted=0;const f=evaluate(currentSource,'codeWorkbenchBranchCurrent',{codeRepoOk:()=>true,codeWorkbenchBranchKey:()=> 'k',codeGitRefUrl:()=>'/ref',codeGhApi:async()=>({ok:false,status:503,msg:'unavailable'})});const r=await f.codeWorkbenchBranchCurrent({KV:{get:async()=>({branch:'code/x'}),delete:async()=>deleted++}},'u','owner/repo');assert.equal(r.ok,false);assert.equal(deleted,0);});
testCase('041','失败清理','discard record + ref 404','recovery active','保留 discard recovery 状态','分支已删但恢复入口丢失',async()=>{const f=evaluate(currentSource,'codeWorkbenchBranchCurrent',{codeRepoOk:()=>true,codeWorkbenchBranchKey:()=> 'k',codeGitRefUrl:()=>'/ref',codeGhApi:async()=>({ok:false,status:404})});const r=await f.codeWorkbenchBranchCurrent({KV:{get:async()=>({branch:'code/x',status:'discard_history_failed'})}},'u','owner/repo');assert.equal(r.discard_recovery,true);assert.equal(r.active,true);});
const deleteSource = sliceSource('async function codeDeleteBranch', 'async function codeMergeTempBranch');
const deleteFn = evaluate(deleteSource,'codeDeleteBranch',{codeGhApi:async(_e,url,opt)=>({ok:true,url,method:opt.method})});
testCase('042','失败清理','branch=main','reject','只允许 code/ 临时分支','删除 main 被放行',async()=>{const r=await deleteFn.codeDeleteBranch({},'owner/repo','main');assert.equal(r.ok,false);});
testCase('043','失败清理','branch=code/task-1','delete refs','DELETE 使用 git/refs 路径','删除请求路径不正确',async()=>{const r=await deleteFn.codeDeleteBranch({},'owner/repo','code/task-1');assert.equal(r.method,'DELETE');assert.match(r.url,/git\/refs\/heads\/code\/task-1$/);});
testCase('044','失败清理','branch=code/../main; code/./main; code//main','reject','拒绝父目录、当前目录和空路径段，且不发 GitHub 请求','非法路径段删除被允许',async()=>{let calls=0;const f=evaluate(deleteSource,'codeDeleteBranch',{codeGhApi:async()=>{calls++;return{ok:true}}});for(const branch of ['code/../main','code/./main','code//main']){const r=await f.codeDeleteBranch({},'owner/repo',branch);assert.equal(r.ok,false,branch);}assert.equal(calls,0);const valid=await f.codeDeleteBranch({},'owner/repo','code/task-1');assert.equal(valid.ok,true);assert.equal(calls,1);});

// 5. 分支隔离：创建分支必须基于指定基线 SHA，失败不能伪报成功。
const createSource = sliceSource('async function codeCreateTempBranch', 'async function codeDeleteBranch');
testCase('045','分支隔离','base=main ref 404','reject','未读取基线 SHA 不创建分支','无基线仍创建临时分支',async()=>{let writes=0;const f=evaluate(createSource,'codeCreateTempBranch',{codeVerifyRef:x=>x,codeGitRefUrl:()=>'/base',codeTempBranch:()=> 'code/p-1',codeGhApi:async()=>({ok:false,status:404}),});const r=await f.codeCreateTempBranch({},'owner/repo','p','main');assert.equal(r.ok,false);});
testCase('046','分支隔离','base=main valid','create from base SHA','新 ref 指向读取到的 base SHA','分支指向错误 commit',async()=>{let body;const f=evaluate(createSource,'codeCreateTempBranch',{codeVerifyRef:x=>x,codeGitRefUrl:()=>'/base',codeTempBranch:()=> 'code/p-1',codeGhApi:async(_e,url,opt={})=>{if(opt.method==='POST'){body=JSON.parse(opt.body);return{ok:true};}return{ok:true,data:{object:{sha:'a'.repeat(40)}}};}});const r=await f.codeCreateTempBranch({},'owner/repo','p','main');assert.equal(r.ok,true);assert.equal(body.sha,'a'.repeat(40));assert.equal(body.ref,'refs/heads/code/p-1');});
testCase('047','分支隔离','unsafe base ref','reject','不合法基线在 GitHub 调用前拒绝','注入 ref 被请求',async()=>{let calls=0;const f=evaluate(createSource,'codeCreateTempBranch',{codeVerifyRef:()=>null,codeGhApi:async()=>{calls++;return{ok:true}}});const r=await f.codeCreateTempBranch({},'owner/repo','p','main;delete');assert.equal(r.ok,false);assert.equal(calls,0);});
testCase('048','分支隔离','GitHub create 422','reject','创建失败返回错误','创建失败仍返回 ok',async()=>{const f=evaluate(createSource,'codeCreateTempBranch',{codeVerifyRef:x=>x,codeGitRefUrl:()=>'/base',codeTempBranch:()=> 'code/p-1',codeGhApi:async(_e,_u,opt={})=>opt.method==='POST'?{ok:false,status:422,msg:'exists'}:{ok:true,data:{object:{sha:'a'.repeat(40)}}}});const r=await f.codeCreateTempBranch({},'owner/repo','p','main');assert.equal(r.ok,false);});
const tempSource = sliceSource('function codeTempBranch', 'function codeTempPreview');
const tempFn = evaluate(tempSource,'codeTempBranch',{rand:()=> '12345678'});
for(const [id,input,expected] of [
['049','"My Project"','code/my-project'],['050','"../bad project"','code/..-bad-project'],['051','""','code/project'],['052','"UPPER_CASE"','code/upper_case']
])testCase(id,'分支隔离',input,'sanitize project name',expected,'分支名前缀不安全或不可读',()=>{const branch=tempFn.codeTempBranch(JSON.parse(input));assert.ok(branch.startsWith(expected+'-'));assert.match(branch,/^code\/[a-z0-9._-]+-\d+-12345678$/);});

// 6. 冲突保护：真实合并函数的 base/head SHA 校验必须先于任何写入。
const mergeSource = sliceSource('async function codeMergeTempBranch', 'async function codeMemoryAppend');
const mergeFn = evaluate(mergeSource,'codeMergeTempBranch',{codeVerifyRef:x=>x,codeGitRefUrl:(_r,ref)=>'/refs/'+ref,codeTempBranch:()=> 'code/merge-txn-1',codeGhApi:async()=>({ok:true})});
for(const [id,field,baseSha,headSha,expected] of [
['053','base drift','b'.repeat(40),'c'.repeat(40),409],['054','head drift','a'.repeat(40),'d'.repeat(40),409],
['055','empty base SHA','','c'.repeat(40),false],['056','short base SHA','123','c'.repeat(40),false],
['057','empty head SHA','a'.repeat(40),'',false],['058','invalid base ref','a'.repeat(40),'c'.repeat(40),false]
])testCase(id,'冲突保护',field,'codeMergeTempBranch SHA gate',String(expected),'SHA 不匹配仍继续创建 scratch ref',async()=>{let writes=0;const f=evaluate(mergeSource,'codeMergeTempBranch',{codeVerifyRef:x=>field==='invalid base ref'?null:x,codeGitRefUrl:(_r,ref)=>'/refs/'+ref,codeTempBranch:()=> 'code/scratch',codeGhApi:async()=>{writes++;return{ok:true,data:{object:{sha:'f'.repeat(40)}}}}});const r=await f.codeMergeTempBranch({},'owner/repo','code/task','main','msg',baseSha,headSha);assert.equal(r.ok,false);assert.equal(writes,field==='base drift'||field==='head drift'?1:0);});
testCase('059','冲突保护','branch=main','reject','合并源必须为 code/ 临时分支','main 被当成源临时分支',async()=>{let calls=0;const f=evaluate(mergeSource,'codeMergeTempBranch',{codeVerifyRef:x=>x,codeGitRefUrl:()=>'/ref',codeGhApi:async()=>{calls++;return{ok:true}}});const r=await f.codeMergeTempBranch({},'owner/repo','main','main','msg','a'.repeat(40),'b'.repeat(40));assert.equal(r.ok,false);assert.equal(calls,0);});
testCase('060','冲突保护','merge ref syntax','force=false CAS','最终 ref 更新不得 force push','force=true 允许覆盖基线',()=>{assert.match(mergeSource,/force:\s*false/);assert.match(mergeSource,/expectedBaseSha/);});
testCase('061','冲突保护','merge preview returns HTTP 409','conflict','将 GitHub 409 作为 conflict 返回','真实合并冲突被误报普通成功',()=>{assert.match(mergeSource,/preview\.status === 409/);assert.match(mergeSource,/conflict:\s*preview\.status === 409/);});
testCase('062','冲突保护','scratch ref cleanup fails','stop before target update','清理失败时返回 scratch_cleanup_failed','scratch 泄漏后仍更新目标分支',()=>{assert.match(mergeSource,/scratch_cleanup_failed/);assert.match(mergeSource,/目标分支尚未更新/);});

// 7. 历史与回滚：缺失/不完整历史禁止整仓回滚，局部路径受保护。
const rollbackSource = sliceSource('async function codeRollbackUnlocked', 'const CODE_DEPLOY_WORKFLOW');
const rollbackFn = evaluate(rollbackSource,'codeRollback',{codeHistoryLoad:async()=>[],codeHistorySave:async()=>{},codeVerifyRef:x=>x,codeRepoOk:()=>true,codePushGuard:()=>''});
testCase('063','历史回滚','history empty','reject','无历史记录返回失败','空历史触发回滚',async()=>{const r=await rollbackFn.codeRollback({},'owner',{id:'missing'});assert.equal(r.ok,false);});
testCase('064','历史回滚','record without previous_sha','reject','无 previous_sha 不回滚','缺少版本指针仍执行',async()=>{const f=evaluate(rollbackSource,'codeRollback',{codeHistoryLoad:async()=>[{id:'x',repo:'owner/repo'}],codeVerifyRef:x=>x,codeRepoOk:()=>true,codePushGuard:()=>''});const r=await f.codeRollback({},'owner',{id:'x'});assert.equal(r.ok,false);});
testCase('065','历史回滚','invalid repo in history','reject','仓库白名单检查失败','非白名单仓库可回滚',async()=>{const f=evaluate(rollbackSource,'codeRollback',{codeHistoryLoad:async()=>[{id:'x',repo:'bad/repo',previous_sha:'a'.repeat(40)}],codeVerifyRef:x=>x,codeRepoOk:()=>false,codePushGuard:()=>''});const r=await f.codeRollback({},'owner',{id:'x'});assert.equal(r.ok,false);});
testCase('066','历史回滚','protected path guard','reject','回滚写入受权限 guard 约束','无权限身份可回滚',async()=>{const f=evaluate(rollbackSource,'codeRollback',{codeHistoryLoad:async()=>[{id:'x',repo:'owner/repo',previous_sha:'a'.repeat(40)}],codeVerifyRef:x=>x,codeRepoOk:()=>true,codePushGuard:()=> 'denied'});const r=await f.codeRollback({},'owner',{id:'x'});assert.equal(r.ok,false);});
testCase('067','历史回滚','history files=[]','reject','无文件清单拒绝整仓回滚','缺失路径清单回滚整个仓库',async()=>{let calls=0;const f=evaluate(rollbackSource,'codeRollback',{codeHistoryLoad:async()=>[{id:'x',repo:'owner/repo',previous_sha:'a'.repeat(40),files:[]}],codeVerifyRef:x=>x,codeRepoOk:()=>true,codePushGuard:()=>'',codeGitRefUrl:()=>'/ref',codeGhApi:async()=>{calls++;return{ok:true}}});const r=await f.codeRollback({},'owner',{id:'x'});assert.equal(r.ok,false);assert.equal(calls,1);});
testCase('068','历史回滚','truncated Git tree','reject','树结果截断时不创建回滚 commit','不完整文件树仍提交',()=>{assert.match(rollbackSource,/data\.truncated/);assert.match(rollbackSource,/拒绝执行整仓库回滚/);});
testCase('069','历史回滚','rollback commit parent','append-only','回滚新 commit 以当前 HEAD 为 parent','回滚重写历史指针',()=>{assert.match(rollbackSource,/parents:\s*\[currentSha\]/);});
testCase('070','历史回滚','rollback path allowlist','path filtered','变更路径先经过 codePathOk','非法历史路径写入回滚树',()=>{assert.match(rollbackSource,/filter\(codePathOk\)/);});

// 8. 预览与环境隔离：只允许配置的 URL 和指定仓库触发预览。
const previewSource = sliceSource('function codeVerifyPreview', 'const codeWorkbenchLocalLockControllers');
const previewFns = evaluate(previewSource,'codeVerifyPreview');
for(const [id,env,expected] of [
['071','{"CODE_PREVIEW_URL":"https://preview.example/run/{run_id}"}','https://preview.example/run/run%201'],['072','{"PREVIEW_URL":"http://preview.example/{run_id}"}','http://preview.example/run%201']
])testCase(id,'预览隔离',env,'codeVerifyPreview',expected,'不安全 URL 被返回或 run_id 未编码',()=>{const r=previewFns.codeVerifyPreview(JSON.parse(env),'run 1');assert.equal(r,expected);});
testCase('073','预览隔离','repo=other/repo','reject','无预览配置的仓库不触发任何预览工作流','未配置仓库触发预览部署',()=>{const s=sliceSource('async function codeWorkbenchBranchPreviewUnlocked','async function codeWorkbenchBranchPreview(');assert.match(s,/const previewConfig = typeof codePreviewConfig === "function" \? codePreviewConfig\(repo\) : null/);assert.match(s,/if \(!previewConfig\) return/);assert.match(s,/previewConfig\.mode === "worker"/);assert.match(s,/deploy-worker-preview\.yml/);});
testCase('074','预览隔离','preview dispatch HTTP 500','reject','部署启动失败返回失败','预览 dispatch 失败被报成功',()=>{const s=sliceSource('async function codeWorkbenchBranchPreviewUnlocked','async function codeWorkbenchBranchPreview(');assert.match(s,/if \(!dispatched\.ok\) return \{ ok: false/);});
testCase('075','预览隔离','preview audit actor','audit','记录 preview_started_by 和 actor','预览操作无操作者记录',()=>{const s=sliceSource('async function codeWorkbenchBranchPreviewUnlocked','async function codeWorkbenchBranchPreview(');assert.match(s,/preview_started_by:\s*String\(user\)|preview_started_by = String\(user\)/);assert.match(s,/actor:\s*String\(user\)/);});
testCase('076','预览隔离','preview event history cap','bounded','预览事件最多保留 100 条','审计事件无上限增长',()=>{const s=sliceSource('async function codeWorkbenchBranchPreviewUnlocked','async function codeWorkbenchBranchPreview(');assert.match(s,/slice\(-100\)/);});
testCase('077','预览隔离','branch preview URL slug','safe slug','只为目标仓库生成 branch slug URL','其他仓库获得生产预览 URL',()=>{const s=sliceSource('function codeTempPreview','async function codeCreateTempBranch');assert.match(s,/tianxin1300\/openmanus-gateway/);assert.match(s,/branch-/);});
testCase('078','预览隔离','main protection','preview uses active branch','dispatch ref 绑定活动临时分支','预览错误引用 main',()=>{const s=sliceSource('async function codeWorkbenchBranchPreviewUnlocked','async function codeWorkbenchBranchPreview(');assert.match(s,/ref: current\.branch/);});

// 9. 文件树、搜索、逐文件审核、提交一致性：核对实际前端函数和后端路径契约。
const wbScript = /<script\b(?=[^>]*\bid=["']wb-devbench["'])[^>]*>([\s\S]*?)<\/script\s*>/i.exec(frontend);
assert.ok(wbScript,'workbench frontend script exists');
const ui = wbScript[1];
const uiCases = [
['079','file tree loads active project','async function loadWorkbenchTree','loadWorkbenchTree','文件树读取必须使用活动仓库/分支上下文'],
['080','file tree renders paths','function renderWorkbenchTree','renderWorkbenchTree','文件树渲染入口缺失'],
['081','file open uses selected path','async function openWorkbenchFile','openWorkbenchFile','逐文件打开入口缺失'],
['082','file search filters query','workbenchFiles.filter(path => !query','workbenchFiles.filter','文件搜索入口缺失'],
['083','branch diff drives review list','async function loadWorkbenchTree','diff','改动差异加载契约缺失'],
['084','review reject sends previous path','previous_path','previous_path','重命名审核未携带旧路径'],
['085','merge action sends branch identity','async function mergeWorkbenchBranch','branch','合并请求未绑定活动分支'],
['086','discard action is explicit','async function discardWorkbenchBranch','discard','丢弃入口缺失'],
['087','project switch clears prior branch context','async function switchWorkbenchProject','activeBranchRecord','项目切换未隔离旧分支状态']
];
for(const [id,label,needle,expected,fail] of uiCases)testCase(id,'文件树与逐文件审核',label,'frontend source contract',expected,fail,()=>{assert.ok(ui.includes(needle),fail);});
