// ==== ユーティリティ ====
const qs = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => [...el.querySelectorAll(s)];

const targetDateEl = qs('#targetDate');
const fileInput     = qs('#fileInput');
const taskBody      = qs('#taskBody');
const emptyMsg      = qs('#emptyMessage');
const toggleAllBtn  = qs('#toggleAll');
const clearChecksBtn= qs('#clearChecks');
const summaryEl     = qs('#summary');
const shareBtn      = qs('#shareBtn');
const shareDialog   = qs('#shareDialog');
const exportCsvBtn  = qs('#exportCsvBtn');

function todayISO(){
  const d = new Date();
  const tz = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tz*60000);
  return local.toISOString().slice(0,10);
}
function storageKey(date){ return `dailycheck:${date}`; }

function loadState(date){
  try{ return JSON.parse(localStorage.getItem(storageKey(date))||'{}'); }
  catch{ return {}; }
}
function saveState(date, obj){
  localStorage.setItem(storageKey(date), JSON.stringify(obj||{}));
}

// local ISO8601 with timezone offset (e.g., 2025-08-27T16:42:10+09:00)
function nowISOWithTZ(){
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth()+1);
  const dd = pad(d.getDate());
  const HH = pad(d.getHours());
  const MM = pad(d.getMinutes());
  const SS = pad(d.getSeconds());
  const off = -d.getTimezoneOffset(); // minutes
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off)/60));
  const om = pad(Math.abs(off)%60);
  return `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}${sign}${oh}:${om}`;
}

function normalizeTime(s){
  if(s==null) return '';
  let t = String(s).trim();
  if(t==='') return '';
  // accept '730', '7:3', '07:30'
  const m = t.match(/^(\d{1,2})(?::?(\d{1,2}))?$/);
  if(!m) return '';
  let hh = parseInt(m[1],10);
  let mm = m[2]!=null ? parseInt(m[2],10) : 0;
  hh = Math.min(23, Math.max(0, hh));
  mm = Math.min(59, Math.max(0, mm));
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}

function smartSplit(line){
  if(line.includes('\t')) return line.split('\t');
  if(line.includes(',')) return line.split(',');
  if(line.includes('，')) return line.split('，');
  return [line];
}

function rowKey(planned, task, url){ return `${planned||''}|${task||''}|${url||''}`; }
const toDate = s => {
  if(!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

// ==== 並べ替えキー：実行時刻があればそれ、無ければ予定時刻、どちらも無ければ最後 ====
function keyTimeMillis(row){
  // 1) completed_at（ISO）優先
  const cd = toDate(row.completed_at);
  if(cd) return cd.getTime();

  // 2) planned_time（HH:MM）を「本日」のミリ秒に
  if(row.planned_time){
    const [hh, mm] = row.planned_time.split(':').map(Number);
    const d = new Date();
    d.setHours(hh||0, mm||0, 0, 0);
    return d.getTime();
  }

  // 3) 無し
  return null;
}

function sortRowsForDisplay(rows){
  return rows
    .map((r, i)=> ({...r, _idx: r._idx ?? i}))
    .sort((a,b)=>{
      const ak = keyTimeMillis(a);
      const bk = keyTimeMillis(b);
      if(ak!=null && bk!=null) return ak - bk; // 両方キーあり → 昇順
      if(ak!=null) return -1;                  // 片方のみキーあり → そちらを先
      if(bk!=null) return 1;
      return a._idx - b._idx;                  // どちらも無し → 元順
    });
}

// ==== 読み込み ====
let currentRows = []; // [{planned_time, task, url, checked, completed_at, id, _idx}]

function parseUserFormat(text){
  const rows = [];
  text.split(/\r?\n/).forEach(raw=>{
    const line = raw.trim();
    if(!line || line.startsWith('#')) return;
    const parts = smartSplit(line).map(s=>s.trim());
    const [t, task, url] = [parts[0]||'', parts[1]||'', parts[2]||''];
    const planned = normalizeTime(t);
    const obj = {
      planned_time: planned,
      task: task || (planned ? '(内容未設定)' : line),
      url: url || '',
      checked: 0,
      completed_at: '',
      _idx: rows.length
    };
    obj.id = rowKey(obj.planned_time, obj.task, obj.url);
    rows.push(obj);
  });
  return sortRowsForDisplay(rows);
}

function looksLikeAppHeader(s){
  return s.trim().toLowerCase() === 'checked,planned_time,completed_at,task,url';
}

function parseAppCSV(text){
  const lines = text.split(/\r?\n/);
  if(!lines.length) return [];
  let start = 0;
  if(looksLikeAppHeader(lines[0])) start = 1;
  const rows = [];
  for(let i=start;i<lines.length;i++){
    const line = lines[i].trim();
    if(!line) continue;
    const parts = line.split(',');
    const [checked, planned_time, completed_at, task, url] = [
      (parts[0]||'').trim(),
      (parts[1]||'').trim(),
      (parts[2]||'').trim(),
      (parts[3]||'').trim(),
      (parts.slice(4).join(',')||'').trim(),
    ];
    const obj = {
      planned_time: normalizeTime(planned_time),
      task,
      url,
      checked: (checked==='1'||checked==='true') ? 1 : 0,
      completed_at: completed_at || '',
      _idx: rows.length
    };
    obj.id = rowKey(obj.planned_time, obj.task, obj.url);
    rows.push(obj);
  }
  return sortRowsForDisplay(rows);
}

function detectAndParse(text){
  const firstLine = text.split(/\r?\n/).find(l=>l.trim().length>0) || '';
  if(looksLikeAppHeader(firstLine)) return parseAppCSV(text);
  return parseUserFormat(text);
}

function mergeWithLocal(rows, date){
  const state = loadState(date); // key -> {checked, completed_at}
  const merged = rows.map(r=>{
    const local = state[r.id];
    if(local){
      return {...r, checked: local.checked ?? r.checked, completed_at: local.completed_at ?? r.completed_at};
    }
    return r;
  });
  return sortRowsForDisplay(merged);
}

function mergePreferAppCSV(rows, date){
  const state = loadState(date);
  const mergedState = {};
  rows.forEach(r=>{
    mergedState[r.id] = {checked: r.checked, completed_at: r.completed_at};
  });
  // keep any local-only rows too
  Object.keys(state).forEach(id=>{
    if(!mergedState[id]) mergedState[id] = state[id];
  });
  saveState(date, mergedState);
}

// ==== 表示ユーティリティ ====
function hhmmFromISO(iso){
  const d = toDate(iso);
  if(!d) return '—';
  const pad = n => String(n).padStart(2,'0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ==== 描画 ====
function renderRows(date, rows){
  taskBody.innerHTML = '';
  rows.forEach(row=>{
    const tr = document.createElement('tr');

    // 1列目：操作（🗑 + ✔）
    const tdOps = document.createElement('td');
    tdOps.className = 'opscell';

    // 削除ボタン
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'delbtn';
    delBtn.setAttribute('aria-label', 'この行を削除');
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', ()=>{
      const dateKey = targetDateEl.value;
      // localStorage から削除
      const st = loadState(dateKey);
      delete st[row.id];
      saveState(dateKey, st);
      // currentRows から削除
      const idx = currentRows.findIndex(x=>x.id===row.id);
      if(idx>=0) currentRows.splice(idx, 1);
      // 並び替え & 再描画
      currentRows = sortRowsForDisplay(currentRows);
      renderRows(dateKey, currentRows);
    });

    // チェックボックス
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.id = row.id;
    cb.checked = !!row.checked;
    cb.addEventListener('change', ()=>{
      const st = loadState(date);
      if(cb.checked){
        st[row.id] = {checked:1, completed_at: nowISOWithTZ()};
      }else{
        // ③ チェックOFF時、実行時刻もクリア
        st[row.id] = {checked:0, completed_at:''};
      }
      saveState(date, st);
      // モデル更新
      const idx = currentRows.findIndex(x=>x.id===row.id);
      if(idx>=0){
        currentRows[idx].checked = st[row.id].checked;
        currentRows[idx].completed_at = st[row.id].completed_at;
      }
      // ③ 動的並べ替え
      currentRows = sortRowsForDisplay(currentRows);
      renderRows(date, currentRows);
    });

    tdOps.append(delBtn, cb);

    // 2列目：実行時刻
    const tdExec = document.createElement('td');
    tdExec.textContent = hhmmFromISO(row.completed_at);

    // 3列目：予定時刻
    const tdTime = document.createElement('td');
    tdTime.textContent = row.planned_time || '—';

    // 4列目：要件
    const tdTask = document.createElement('td');
    tdTask.textContent = row.task || '—';

    // 5列目：リンク
    const tdUrl = document.createElement('td');
    if(row.url){
      const a = document.createElement('a');
      a.href = row.url; a.target = '_blank'; a.rel='noopener'; a.className='link'; a.textContent='開く';
      tdUrl.append(a);
    }else{
      tdUrl.textContent = '—'; tdUrl.style.color = '#778';
    }

    tr.append(tdOps, tdExec, tdTime, tdTask, tdUrl);
    taskBody.append(tr);
  });
  emptyMsg.style.display = rows.length ? 'none' : '';
  updateSummary();
}

function updateSummary(){
  const total = qsa('tbody input[type="checkbox"]').length;
  const done  = qsa('tbody input[type="checkbox"]:checked').length;
  summaryEl.textContent = `${done} / ${total} 完了`;
}

// ==== 入出力 ====
function loadFromFile(file){
  const reader = new FileReader();
  reader.onload = e=>{
    const text = String(e.target.result||'');
    const parsed = detectAndParse(text);
    const fromAppCSV = looksLikeAppHeader((text.split(/\r?\n/)[0]||''));
    if(fromAppCSV){
      // アプリ出力CSVの場合：CSV側（チェック/完了時刻）を採用してローカル状態を置換
      mergePreferAppCSV(parsed, targetDateEl.value);
      currentRows = parsed;
    }else{
      // 手書き入力の場合：既存ローカル状態を優先して反映
      currentRows = mergeWithLocal(parsed, targetDateEl.value);
    }
    // 表示用の並びを最終確定
    currentRows = sortRowsForDisplay(currentRows);
    renderRows(targetDateEl.value, currentRows);
  };
  reader.readAsText(file, 'utf-8');
}

function exportCSV(){
  const date = targetDateEl.value;
  const st = loadState(date);
  // DOMの行順で出力（削除済み行はDOMにないので除外）
  const rows = [];
  qsa('#taskBody tr').forEach(tr=>{
    const tds = qsa('td', tr);
    // 列順： [0]=操作, [1]=実行, [2]=予定, [3]=要件, [4]=リンク
    const planned = tds[2].textContent==='—' ? '' : tds[2].textContent;
    const task    = tds[3].textContent==='—' ? '' : tds[3].textContent;
    const linkEl  = qs('a', tds[4]);
    const url     = linkEl ? linkEl.getAttribute('href') : '';
    const cb      = qs('input[type="checkbox"]', tds[0]);
    const id      = cb.dataset.id;
    const state   = st[id] || {checked:0, completed_at:''};
    rows.push({
      checked: state.checked ? 1 : 0,
      planned_time: planned,
      completed_at: state.completed_at || '',
      task,
      url,
    });
  });

  let csv = 'checked,planned_time,completed_at,task,url\n';
  csv += rows.map(r=>[r.checked, r.planned_time, r.completed_at, r.task, r.url].map(v=>String(v||'')).join(',')).join('\n');

  // ファイル名：DailyCheck‗yymmdd.csv
  const d  = new Date(date+'T00:00:00');
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const filename = `DailyCheck‗${yy}${mm}${dd}.csv`;

  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ==== イベント ====
window.addEventListener('DOMContentLoaded', ()=>{
  targetDateEl.value = todayISO();

  fileInput.addEventListener('change', ()=>{
    const f = fileInput.files?.[0];
    if(f) loadFromFile(f);
  });

  toggleAllBtn.addEventListener('click', ()=>{
    const date = targetDateEl.value;
    const boxes = qsa('tbody td.opscell input[type="checkbox"]');
    const allOn = boxes.length && boxes.every(b=>b.checked);
    const map = loadState(date);
    boxes.forEach(b=>{
      const id = b.dataset.id;
      const newState = !allOn;
      b.checked = newState;
      map[id] = {checked: newState ? 1 : 0, completed_at: newState ? nowISOWithTZ() : ''};
      const idx = currentRows.findIndex(x=>x.id===id);
      if(idx>=0){
        currentRows[idx].checked = map[id].checked;
        currentRows[idx].completed_at = map[id].completed_at;
      }
    });
    saveState(date, map);
    // 並べ替え & 再描画
    currentRows = sortRowsForDisplay(currentRows);
    renderRows(date, currentRows);
  });

  clearChecksBtn.addEventListener('click', ()=>{
    const date = targetDateEl.value;
    localStorage.removeItem(storageKey(date));
    qsa('tbody td.opscell input[type="checkbox"]').forEach(b=> b.checked = false);
    currentRows.forEach(r=>{ r.checked = 0; r.completed_at=''; });
    // 並べ替え & 再描画
    currentRows = sortRowsForDisplay(currentRows);
    renderRows(date, currentRows);
  });

  shareBtn.addEventListener('click', ()=>{
    if(typeof shareDialog?.showModal === 'function'){
      shareDialog.showModal();
    }else{
      exportCSV();
    }
  });
  exportCsvBtn?.addEventListener('click', (e)=>{
    e.preventDefault();
    exportCSV();
    shareDialog.close();
  });

  // 日付変更：既存の保存状態を適用
  targetDateEl.addEventListener('change', ()=>{
    const date = targetDateEl.value;
    const st = loadState(date);
    qsa('#taskBody tr').forEach(tr=>{
      const cb = qs('td.opscell input[type="checkbox"]', tr);
      const id = cb.dataset.id;
      const local = st[id];
      cb.checked = !!(local && local.checked);
      const idx = currentRows.findIndex(x=>x.id===id);
      if(idx>=0){
        currentRows[idx].checked = cb.checked ? 1 : 0;
        currentRows[idx].completed_at = (local && local.completed_at) || '';
      }
    });
    // 並べ替え & 再描画
    currentRows = sortRowsForDisplay(currentRows);
    renderRows(date, currentRows);
  });
});
