// ==== ユーティリティ ====
const qs = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => [...el.querySelectorAll(s)];

const targetDateEl = qs('#targetDate');
const fileInput     = qs('#fileInput');
const taskBody      = qs('#taskBody');
const emptyMsg      = qs('#emptyMessage');
const summaryEl     = qs('#summary');
const shareBtn      = qs('#shareBtn');
const shareDialog   = qs('#shareDialog');
const exportCsvBtn  = qs('#exportCsvBtn');
const toggleCompletedBtn = qs('#toggleCompletedVisibility');
const sortModeBtn   = qs('#sortModeBtn');

// 表示トグル：初期は「全データ表示（チェック済みも表示）」＝オン
let showCompleted = true;
// 並び順モード：'auto'（実行→予定→無し） / 'planned'（予定のみ）
let sortMode = 'auto';

// ファイル名から対象日を設定できたかのフラグ（できたらCSV中の最新実行日で上書きしない）
let dateFromFilenameSet = false;

function updateToggleBtnLabel(){
  if(toggleCompletedBtn){
    toggleCompletedBtn.textContent = `チェック済み表示：${showCompleted ? 'オン' : 'オフ'}`;
  }
}
function updateSortModeBtnLabel(){
  if(sortModeBtn){
    sortModeBtn.textContent = (sortMode === 'auto')
      ? '並び順：実行→予定'
      : '並び順：予定のみ';
  }
}

function todayISO(){
  const d = new Date();
  const tz = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tz*60000);
  return local.toISOString().slice(0,10);
}

// === ローカル保存・復元は使わない（no-op） ===
function loadState(){ return {}; }
function saveState(){ return; }

// 現在時刻をISO（ローカルTZ）で取得
function nowISOWithTZ(){
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth()+1);
  const dd = pad(d.getDate());
  const HH = pad(d.getHours());
  const MM = pad(d.getMinutes());
  const SS = pad(d.getSeconds());
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off)/60));
  const om = pad(Math.abs(off)%60);
  return `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}${sign}${oh}:${om}`;
}

// 時刻の正規化＋LOOP保持
function normalizeTime(s){
  if(s==null) return '';
  let t = String(s).trim();
  if(t==='') return '';
  // LOOP / ループ はそのまま保持（内部表記は 'LOOP' に統一）
  if (t.toUpperCase() === 'LOOP' || t === 'ループ') return 'LOOP';

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

// === 並べ替え ===
function keyTimeMillis(row){
  const cd = toDate(row.completed_at);
  if(cd) return cd.getTime();
  if(row.planned_time && row.planned_time !== 'LOOP'){
    const [hh, mm] = row.planned_time.split(':').map(Number);
    const d = new Date();
    d.setHours(hh||0, mm||0, 0, 0);
    return d.getTime();
  }
  return null;
}

function compareAuto(a,b){
  const ak = keyTimeMillis(a);
  const bk = keyTimeMillis(b);
  if(ak!=null && bk!=null) return ak - bk;
  if(ak!=null) return -1;
  if(bk!=null) return 1;
  return a._idx - b._idx;
}

function comparePlanned(a,b){
  const at = a.planned_time || '';
  const bt = b.planned_time || '';
  if(at && bt) return at.localeCompare(bt);
  if(at && !bt) return -1;
  if(!at && bt) return 1;
  return a._idx - b._idx;
}

function sortRowsForDisplay(rows){
  const withIdx = rows.map((r,i)=> ({...r, _idx: r._idx ?? i}));
  return withIdx.sort(sortMode === 'auto' ? compareAuto : comparePlanned);
}

// ==== 読み込み ====
let currentRows = [];

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

function isoToLocalDateStr(iso){
  const d = toDate(iso);
  if(!d) return '';
  const pad = n => String(n).padStart(2,'0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth()+1);
  const dd = pad(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
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

    const tdOps = document.createElement('td');
    tdOps.className = 'opscell';

    // 削除
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'delbtn';
    delBtn.setAttribute('aria-label', 'この行を削除');
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', ()=>{
      const idx = currentRows.findIndex(x=>x.id===row.id);
      if(idx>=0) currentRows.splice(idx, 1);
      currentRows = sortRowsForDisplay(currentRows);
      renderRows(targetDateEl.value, currentRows);
    });

    // チェックボックス
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.id = row.id;
    cb.checked = !!row.checked;

    // === チェックイベント ===
    cb.addEventListener('change', ()=>{
      const idx = currentRows.findIndex(x=>x.id===row.id);
      if(idx<0) return;

      const isLoop = (currentRows[idx].planned_time||'').toUpperCase() === 'LOOP';

      if (isLoop && cb.checked) {
        // 原本は未チェックのまま残す（UIも戻す）
        cb.checked = false;

        // 複製作成（実行記録）
        const nowIso = nowISOWithTZ();
        const d = new Date();
        const pad = n => String(n).padStart(2,'0');
        const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

        const copy = {
          ...currentRows[idx],
          planned_time: hhmm,     // 実行時刻を予定欄へ（ID差別化にも使う）
          checked: 1,
          completed_at: nowIso,
          _idx: currentRows.length
        };
        // 複製IDは必ずユニーク
        copy.id = `LOOP_${currentRows[idx].task}_${hhmm}_${Date.now()}`;

        currentRows.push(copy);
      } else {
        // 通常行
        currentRows[idx].checked = cb.checked ? 1 : 0;
        currentRows[idx].completed_at = cb.checked ? nowISOWithTZ() : '';
      }

      currentRows = sortRowsForDisplay(currentRows);
      renderRows(targetDateEl.value, currentRows);
    });

    tdOps.append(delBtn, cb);

    const tdExec = document.createElement('td');
    tdExec.textContent = hhmmFromISO(row.completed_at);

    const tdTime = document.createElement('td');
    tdTime.textContent = row.planned_time || '—';

    const tdTask = document.createElement('td');
    tdTask.textContent = row.task || '—';

    const tdUrl = document.createElement('td');
    if(row.url){
      const a = document.createElement('a');
      a.href = row.url; a.target = '_blank'; a.rel='noopener'; a.className='link'; a.textContent='開く';
      tdUrl.append(a);
    }else{
      tdUrl.textContent = '—'; tdUrl.style.color = '#778';
    }

    // 表示トグル（showCompleted=false のときはチェック済みを隠す）
    if(!showCompleted && row.checked){
      tr.style.display = 'none';
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

    currentRows = parsed;

    // ファイル名から対象日がセットされていない場合のみ、CSVの最新実行日で補完
    if(!dateFromFilenameSet){
      const execDates = currentRows
        .map(r => r.completed_at)
        .filter(Boolean)
        .map(isoToLocalDateStr)
        .filter(Boolean);
      if(execDates.length){
        const mostRecent = execDates.sort().at(-1);
        if(mostRecent) targetDateEl.value = mostRecent;
      }
    }

    // 並べ替え＆描画
    currentRows = sortRowsForDisplay(currentRows);
    renderRows(targetDateEl.value, currentRows);

    // 次回に影響しないようフラグはクリア
    dateFromFilenameSet = false;
  };
  reader.readAsText(file, 'utf-8');
}

async function exportCSV(){
  // 出力ファイル名は「現在選択中のファイル名」をそのまま使用
  let filename = 'DailyCheck.csv';
  if (fileInput.files && fileInput.files.length > 0) {
    filename = fileInput.files[0].name;
  }

  const rows = [];
  qsa('#taskBody tr').forEach(tr=>{
    const tds   = qsa('td', tr);
    // 列順：[0]=操作, [1]=実行, [2]=予定, [3]=要件, [4]=リンク
    const planned = tds[2].textContent==='—' ? '' : tds[2].textContent; // LOOP もそのまま出力
    const task    = tds[3].textContent==='—' ? '' : tds[3].textContent;
    const linkEl  = qs('a', tds[4]);
    const url     = linkEl ? linkEl.getAttribute('href') : '';
    const cb      = qs('input[type="checkbox"]', tds[0]);
    const id      = cb.dataset.id;
    const row     = currentRows.find(r=>r.id===id) || {completed_at:''};

    rows.push({
      checked: cb.checked ? 1 : 0,
      planned_time: planned,
      completed_at: row.completed_at || '',
      task,
      url,
    });
  });

  let csv = 'checked,planned_time,completed_at,task,url\n';
  csv += rows.map(r=>[r.checked, r.planned_time, r.completed_at, r.task, r.url]
    .map(v=>String(v||'')).join(',')).join('\n');

  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});

  if('showSaveFilePicker' in window){
    try{
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }],
        excludeAcceptAllOption: false
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }catch(e){
      return;
    }
  }

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
  // 初期表示：全データ表示（オン）
  updateToggleBtnLabel();
  updateSortModeBtnLabel();
  targetDateEl.value = todayISO();

  toggleCompletedBtn?.addEventListener('click', ()=>{
    showCompleted = !showCompleted;
    updateToggleBtnLabel();
    renderRows(targetDateEl.value, currentRows);
  });

  sortModeBtn?.addEventListener('click', ()=>{
    sortMode = (sortMode === 'auto') ? 'planned' : 'auto';
    updateSortModeBtnLabel();
    currentRows = sortRowsForDisplay(currentRows);
    renderRows(targetDateEl.value, currentRows);
  });

  // ファイル選択時：まずファイル名からYYMMDDを拾って対象日に設定（拾えなければスキップ）
  fileInput.addEventListener('change', ()=>{
    const f = fileInput.files?.[0];
    if(f){
      const name = f.name;
      // 例）abc_250831_予定.csv → '_'区切りで2番目が YYMMDD
      const parts = name.split('_');
      if (parts.length >= 2) {
        const dateStr = parts[1];
        if (/^\d{6}$/.test(dateStr)) {
          const yy = dateStr.slice(0,2);
          const mm = dateStr.slice(2,4);
          const dd = dateStr.slice(4,6);
          targetDateEl.value = `20${yy}-${mm}-${dd}`;
          dateFromFilenameSet = true;
        }
      }
      loadFromFile(f);
    }
  });

  shareBtn.addEventListener('click', ()=>{
    if(typeof shareDialog?.showModal === 'function'){
      shareDialog.showModal();
    }else{
      exportCSV();
    }
  });
  exportCsvBtn?.addEventListener('click', async (e)=>{
    e.preventDefault();
    await exportCSV();
    shareDialog.close();
  });

  targetDateEl.addEventListener('change', ()=>{
    currentRows = sortRowsForDisplay(currentRows);
    renderRows(targetDateEl.value, currentRows);
  });
});
