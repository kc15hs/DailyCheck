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

// 初期ソートモード：実行→予定
let sortMode = 'exec_then_planned'; // or 'planned_then_exec'

// レコード配列（UIの唯一の真実）
let currentRows = [];

// ファイル名から日付推測を一度だけ行うフラグ
let dateFromFilenameSet = false;

function pad(n){ return String(n).padStart(2,'0'); }

function nowISOWithTZ(){
  const d = new Date();
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
  if(t==='' ) return '';
  if(t.toUpperCase()==='LOOP') return 'LOOP';
  const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if(m){
    return `${pad(+m[1])}:${m[2]}`;
  }
  return t;
}

function hhmmFromISO(iso){
  if(!iso) return '—';
  const d = new Date(iso);
  if(isNaN(+d)) return '—';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoToLocalDateStr(iso){
  if(!iso) return '';
  const d = new Date(iso);
  if(isNaN(+d)) return '';
  const y = d.getFullYear();
  const m = pad(d.getMonth()+1);
  const day = pad(d.getDate());
  return `${y}-${m}-${day}`;
}

// 旧「アプリCSV」判定（読み込み後方互換用）
function looksLikeAppHeader(s){
  const h = s.trim().toLowerCase();
  return h === 'checked,planned_time,completed_at,task,url' ||
         h === 'checked,planned_time,completed_at,task,desc_url,url';
}

// 旧「アプリCSV」読み込み（後方互換）
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
    const checked      = (parts[0]||'').trim();
    const planned_time = (parts[1]||'').trim();
    const completed_at = (parts[2]||'').trim();
    const task         = (parts[3]||'').trim();

    let desc_url = '';
    let url = '';
    if (parts.length >= 6) {
      desc_url = (parts[4]||'').trim();
      url      = (parts.slice(5).join(',')||'').trim();
    } else if (parts.length >= 5) {
      url      = (parts.slice(4).join(',')||'').trim();
    }

    const obj = {
      planned_time: normalizeTime(planned_time),
      task,
      url,
      desc_url,
      checked: (checked==='1'||checked==='true') ? 1 : 0,
      completed_at: completed_at || '',
      _idx: rows.length
    };
    obj.id = `${obj.planned_time}__${obj.task}__${obj.url}`;
    rows.push(obj);
  }
  return rows;
}

// 本来の4列CSV（ヘッダなし）：A=時刻, B=地名/本文, C=地図URL, D=説明サイトURL
function parsePlainCSV(text){
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const rows = [];
  for(const line of lines){
    const ps = line.split(',');
    const a = (ps[0]||'').trim();                 // A: 時刻/LOOP
    const b = (ps[1]||'').trim();                 // B: 地名テキスト
    const c = (ps[2]||'').trim();                 // C: 地図URL
    const d = (ps.slice(3).join(',')||'').trim(); // D: 説明URL（カンマ含む可能性に備え結合）

    const obj = {
      planned_time: normalizeTime(a),
      task: b,
      url: c,
      desc_url: d,
      checked: 0,
      completed_at: '',
      _idx: rows.length
    };
    obj.id = `${obj.planned_time}__${obj.task}__${obj.url}`;
    rows.push(obj);
  }
  return rows;
}

function detectFormatAndParse(text){
  const first = (text.split(/\r?\n/)[0]||'').trim();
  if(looksLikeAppHeader(first)) return parseAppCSV(text);
  return parsePlainCSV(text); // 既定：4列ヘッダなしCSV
}

// === 並び替えユーティリティ ===
const isValidHHMM = t => /^\d{2}:\d{2}$/.test(String(t||'').trim());

// 「予定も実行もどちらも有効時刻でない」→最下部送り
function isMissingBoth(r){
  const pValid = isValidHHMM(r.planned_time);
  const eStr   = hhmmFromISO(r.completed_at);
  const eValid = isValidHHMM(eStr);
  return !pValid && !eValid;
}

// 予定側のキー（カテゴリ, 時刻文字）
const plannedKey = r => {
  const t = (r.planned_time||'').toUpperCase();
  if (isValidHHMM(r.planned_time)) return ['0', r.planned_time];
  if (t === 'LOOP')                 return ['2', '99:99'];
  return ['1', '98:98'];
};

// 実行側のキー（カテゴリ, 時刻文字）
const execKey = r => {
  const h = hhmmFromISO(r.completed_at);
  if (isValidHHMM(h)) return ['0', h];
  return ['1', '98:98'];
};

// 並び替え：実行→予定 は「実行あり→実行時刻昇順」「実行なし→予定時刻昇順」、両方空は最下部
function sortRowsForDisplay(rows){
  const x = [...rows];
  x.sort((a,b)=>{
    const ma = isMissingBoth(a), mb = isMissingBoth(b);
    if (ma !== mb) return ma ? 1 : -1;

    if (sortMode==='planned_then_exec'){
      const [ca,ka] = plannedKey(a);
      const [cb,kb] = plannedKey(b);
      if (ca < cb) return -1; if (ca > cb) return 1;
      if (ka < kb) return -1; if (ka > kb) return 1;
      return (a._idx - b._idx);
    } else {
      const [ea,xa] = execKey(a);
      const [eb,xb] = execKey(b);
      if (ea !== eb) return ea < eb ? -1 : 1;

      if (ea === '0' && eb === '0') {
        if (xa < xb) return -1; if (xa > xb) return 1;
        return (a._idx - b._idx);
      } else {
        const [ca,ka] = plannedKey(a);
        const [cb,kb] = plannedKey(b);
        if (ca < cb) return -1; if (ca > cb) return 1;
        if (ka < kb) return -1; if (ka > kb) return 1;
        return (a._idx - b._idx);
      }
    }
  });
  return x;
}

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

    // チェック（進捗トグル）
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.id = row.id;
    cb.checked = !!row.checked;
    cb.addEventListener('change', ()=>{
      const id = cb.dataset.id;
      const idx = currentRows.findIndex(x=>x.id===id);
      if(idx<0) return;

      const isLoop = (currentRows[idx].planned_time||'').toUpperCase() === 'LOOP';

      if (isLoop && cb.checked) {
        // 原本は未チェックのまま残す（UIも戻す）
        cb.checked = false;

        // 複製作成（実行記録）
        const nowIso = nowISOWithTZ();
        const d = new Date();
        const pad2 = n => String(n).padStart(2,'0');
        const hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

        const copy = {
          ...currentRows[idx],
          planned_time: hhmm,
          checked: 1,
          completed_at: nowIso,
          _idx: currentRows.length
        };
        copy.id = `LOOP_${currentRows[idx].task}_${hhmm}_${Date.now()}`;

        currentRows.push(copy);
      } else {
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

    // 説明リンク（D列）
    const tdDesc = document.createElement('td');
    if(row.desc_url){
      const aDesc = document.createElement('a');
      aDesc.href = row.desc_url; aDesc.target = '_blank'; aDesc.rel='noopener'; aDesc.className='link'; aDesc.textContent='説明';
      tdDesc.append(aDesc);
    }else{
      tdDesc.textContent = '—'; tdDesc.style.color = '#778';
    }

    // 地図リンク（C列）
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

    tr.append(tdOps, tdExec, tdTime, tdTask, tdDesc, tdUrl);
    taskBody.append(tr);
  });
  emptyMsg.style.display = rows.length ? 'none' : '';
  updateSummary();
}

function updateSummary(){
  const total = qsa('tbody input[type="checkbox"]').length;
  const done  = qsa('tbody input[type="checkbox"]:checked').length;
  summaryEl.textContent = `合計 ${total} 件 / 完了 ${done} 件`;
}

function trySetDateFromFilename(name){
  if(dateFromFilenameSet) return;
  const m = name && name.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
  if(m){
    const y = m[1], mo = m[2], d = m[3];
    targetDateEl.value = `${y}-${mo}-${d}`;
    dateFromFilenameSet = true;
  }
}

function handleFile(file){
  const reader = new FileReader();
  trySetDateFromFilename(file.name);
  reader.onload = ()=>{
    const text = String(reader.result||'');
    let rows = detectFormatAndParse(text);

    // completed_at に日付があれば最も新しい日付をセット（後方互換）
    if(!targetDateEl.value){
      const execDates = rows
        .map(r=>r.completed_at)
        .filter(Boolean)
        .map(isoToLocalDateStr)
        .filter(Boolean);
      if(execDates.length){
        const mostRecent = execDates.sort().at(-1);
        if(mostRecent) targetDateEl.value = mostRecent;
      }
    }

    currentRows = sortRowsForDisplay(rows);
    renderRows(targetDateEl.value, currentRows);
    dateFromFilenameSet = false;
  };
  reader.readAsText(file, 'utf-8');
}

// === CSV出力（進捗CSVのみ／同名で保存提案） ===
async function exportCSV(){
  // 読み込んだファイル名を優先（同名で上書き提案）
  let filename = 'DailyCheck.csv';
  if (fileInput.files && fileInput.files.length > 0) {
    filename = fileInput.files[0].name;
  }

  // currentRows から正確に（DOMに依存しない）
  const header = 'checked,planned_time,completed_at,task,desc_url,url\n';
  const lines = currentRows.map(r=>[
    r.checked ? 1 : 0,
    r.planned_time || '',
    r.completed_at || '',
    (r.task || '').replace(/[\r\n]/g, ' ').trim(),
    r.desc_url || '',
    r.url || ''
  ].map(v=>String(v)).join(','));
  const blob = new Blob([header + lines.join('\n')], {type:'text/csv;charset=utf-8'});

  if('showSaveFilePicker' in window){
    try{
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'CSV', accept: {'text/csv':['.csv']} }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    }catch(e){
      // ユーザーキャンセル等は無視
    }
  }else{
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
    a.remove();
  }
}

// ==== イベントバインド ====
document.addEventListener('DOMContentLoaded', ()=>{
  // 初期ボタン表記を「実行→予定」に合わせる
  if (sortModeBtn) {
    sortModeBtn.textContent = (sortMode==='planned_then_exec') ? '予定→実行' : '実行→予定';
  }

  // ファイル読込
  fileInput.addEventListener('change', e=>{
    const f = e.target.files && e.target.files[0];
    if(f) handleFile(f);
  });

  // 共有（保存）ダイアログ
  shareBtn?.addEventListener('click', ()=>{
    shareDialog.showModal();
  });
  shareDialog?.addEventListener('close', ()=>{
    if(shareDialog.returnValue === 'ok'){
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

  toggleCompletedBtn?.addEventListener('click', ()=>{
    showCompleted = !showCompleted;
    toggleCompletedBtn.textContent = showCompleted ? '完了を隠す' : '完了も表示';
    renderRows(targetDateEl.value, currentRows);
  });

  sortModeBtn?.addEventListener('click', ()=>{
    sortMode = (sortMode==='planned_then_exec') ? 'exec_then_planned' : 'planned_then_exec';
    sortModeBtn.textContent = (sortMode==='planned_then_exec') ? '予定→実行' : '実行→予定';
    currentRows = sortRowsForDisplay(currentRows);
    renderRows(targetDateEl.value, currentRows);
  });
});
