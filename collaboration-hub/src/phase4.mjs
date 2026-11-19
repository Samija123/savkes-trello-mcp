import { readFileSync, writeFileSync } from 'node:fs';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

export function installPhase4(server) {
  const file = process.env.COLLAB_DB_PATH || './collaboration-hub-phase4.json';
  let state = { workspaces: {}, tasks: {}, requests: {}, notifications: {} };
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  const save = () => writeFileSync(file, JSON.stringify(state));
  const tokens = (() => { try { return JSON.parse(process.env.COLLAB_USER_TOKENS || '{}'); } catch { return {}; } })();
  const eq = (a,b) => { if (typeof a !== 'string' || typeof b !== 'string') return false; const x=Buffer.from(a),y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); };
  const wss = new WebSocketServer({ noServer:true, maxPayload:16384 });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/') return;
    if (!eq(req.headers['x-hub-token'], process.env.HUB_BRIDGE_TOKEN || '')) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');socket.destroy();return; }
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  const emit = (ws,type,extra={}) => ws.send(JSON.stringify({type,...extra}));
  const fail = (ws,message) => emit(ws,'error',{message});
  const notify = (user,type,extra={}) => { (state.notifications[user] ||= []).push({id:randomUUID(),type,...extra});save(); };
  const member = (w,id) => !!w?.members?.some(m=>m.id===id);
  const manager = (w,id) => w?.owner===id || w?.members?.some(m=>m.id===id && ['admin','project_manager'].includes(m.role));
  wss.on('connection', ws => {
    let id = null;
    ws.on('message', raw => {
      let m;try {m=JSON.parse(raw);}catch{return fail(ws,'Invalid JSON');}
      if(m.type==='join') {
        if(!m.developerId || !eq(m.identityToken,tokens[m.developerId])) return fail(ws,'Invalid user identity');
        id=m.developerId;return emit(ws,'joined',{developerId:id});
      }
      if(!id) return fail(ws,'Join first');
      if(m.type==='notification') {
        if(m.subtype==='list')return emit(ws,'notification_list',{notifications:state.notifications[id]||[]});
        return fail(ws,'Unknown notification action');
      }
      if(m.type==='workspace') {
        const name=m.name, w=state.workspaces[name];
        if(m.subtype==='list')return emit(ws,'workspace_list',{workspaces:Object.values(state.workspaces).filter(x=>member(x,id))});
        if(m.subtype==='create') {if(!name || w)return fail(ws,'Invalid or existing workspace');state.workspaces[name]={name,owner:id,members:[{id,role:'admin'}]};save();return emit(ws,'workspace_created',{name});}
        if(!w || !manager(w,id))return fail(ws,'Insufficient permissions');
        if(m.subtype==='add_member') {if(!tokens[m.memberId])return fail(ws,'Unknown member');if(!member(w,m.memberId))w.members.push({id:m.memberId,role:'developer'});notify(m.memberId,'workspace_invitation',{workspace:name});save();return emit(ws,'workspace_member_added',{name});}
        if(m.subtype==='remove_member') {if(m.memberId===w.owner)return fail(ws,'Cannot remove owner');w.members=w.members.filter(x=>x.id!==m.memberId);save();return emit(ws,'workspace_member_removed',{name});}
        return fail(ws,'Unknown workspace action');
      }
      if(m.type==='task') {
        if(m.subtype==='list')return emit(ws,'task_list',{tasks:Object.values(state.tasks).filter(t=>member(state.workspaces[t.workspace],id))});
        if(m.subtype==='create') {const w=state.workspaces[m.workspace];if(!member(w,id)||!manager(w,id)||!member(w,m.assignee))return fail(ws,'Assignment not permitted');const taskId=randomUUID();state.tasks[taskId]={id:taskId,workspace:m.workspace,title:m.title,assignee:m.assignee,createdBy:id};notify(m.assignee,'task_assigned',{taskId});save();return emit(ws,'task_created',{taskId});}
        return fail(ws,'Unknown task action');
      }
      if(m.type==='change-request') {
        if(m.subtype==='list')return emit(ws,'change_request_list',{requests:Object.values(state.requests).filter(r=>member(state.workspaces[state.tasks[r.taskId]?.workspace],id))});
        if(m.subtype==='submit') {const t=state.tasks[m.taskId];if(!t||!member(state.workspaces[t.workspace],id))return fail(ws,'Task not accessible');const requestId=randomUUID();state.requests[requestId]={id:requestId,taskId:m.taskId,description:m.description,createdBy:id,status:'pending'};notify(t.createdBy,'change_request_submitted',{requestId});save();return emit(ws,'change_request_submitted',{requestId});}
        if(['approve','reject'].includes(m.subtype)) {const r=state.requests[m.requestId],t=state.tasks[r?.taskId];if(!r||!t||!manager(state.workspaces[t.workspace],id)||r.status!=='pending')return fail(ws,'Approval not permitted');r.status=m.subtype==='approve'?'approved':'rejected';notify(r.createdBy,'change_request_decided',{requestId:r.id,status:r.status});save();return emit(ws,m.subtype==='approve'?'change_request_approved':'change_request_rejected',{requestId:r.id});}
      }
      return fail(ws,'Unknown action');
    });
  });
}
