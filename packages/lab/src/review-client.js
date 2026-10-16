// review.html 里运行的小脚本：每行的 ✓ ✗ ? 按钮、筛选、统计、保存到浏览器、导出 JSON。
// 数据由 review.ts 生成时放在 window.REVIEW_DATA 里
(function () {
  var DATA = window.REVIEW_DATA;
  var storeKey = 'epubmerger-review:' + DATA.book;
  var local = {};
  try {
    local = JSON.parse(localStorage.getItem(storeKey) || '{}');
  } catch {
    local = {};
  }

  function save() {
    try {
      localStorage.setItem(storeKey, JSON.stringify(local));
    } catch {
      // 浏览器不让存时（隐私模式等），修改只在这次打开时有效，导出仍然可用
    }
  }

  /** 这一行现在的判断：你改过的优先，否则是 Claude 预先填的，都没有时为 null */
  function state(i) {
    var r = DATA.rows[i];
    return local[r.key] || r.init;
  }

  function rowEl(i) {
    return document.querySelector('tr[data-i="' + i + '"]');
  }

  function setState(i, patch) {
    var r = DATA.rows[i];
    var s = Object.assign({ ok: null, answer: '', note: '' }, state(i) || {}, patch, {
      by: 'human',
    });
    local[r.key] = s;
    save();
    render(i);
    stats();
    applyFilter();
  }

  function render(i) {
    var r = DATA.rows[i];
    var s = state(i);
    var tr = rowEl(i);
    var box = tr.querySelector('.verdict');
    tr.classList.remove('v-ok', 'v-bad', 'v-unsure', 'v-human');
    tr.classList.toggle('sample', !!r.sample);
    if (s) {
      tr.classList.add(s.ok === true ? 'v-ok' : s.ok === false ? 'v-bad' : 'v-unsure');
      if (s.by === 'human') tr.classList.add('v-human');
    }
    box.innerHTML = '';
    if (r.sample) {
      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = '抽查';
      box.appendChild(tag);
    }
    [
      ['✓', true, '对'],
      ['✗', false, '错'],
      ['?', null, '不确定'],
    ].forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b[0];
      btn.title = b[2];
      if (s && s.ok === b[1]) btn.className = 'on';
      btn.onclick = function () {
        setState(i, { ok: b[1] });
      };
      box.appendChild(btn);
    });
    if (s && s.ok === false) {
      var label = document.createElement('label');
      label.textContent = r.side === 'zh' ? '正确的英文 #' : '正确的中文 #';
      var input = document.createElement('input');
      input.value = s.answer || '';
      input.placeholder = '如 12+13，没有对应填 无';
      input.onchange = function () {
        setState(i, { answer: input.value.trim() });
      };
      label.appendChild(input);
      box.appendChild(label);
    }
    if (s && s.note) {
      var note = document.createElement('div');
      note.className = 'note';
      note.textContent = (s.by === 'human' ? '你：' : 'Claude：') + s.note;
      box.appendChild(note);
    }
    if (s && s.by === 'human') {
      var noteBtn = document.createElement('button');
      noteBtn.type = 'button';
      noteBtn.className = 'small';
      noteBtn.textContent = '写备注';
      noteBtn.onclick = function () {
        var text = window.prompt('备注', s.note || '');
        if (text !== null) setState(i, { note: text });
      };
      box.appendChild(noteBtn);
    }
  }

  /** Wilson 区间：样本里 k/m 是对的，真实比例 95% 落在这个范围（样本全对时也给得出合理的下限） */
  function wilson(k, m) {
    if (m === 0) return [0, 1];
    var z = 1.96;
    var p = k / m;
    var d = 1 + (z * z) / m;
    var c = (p + (z * z) / (2 * m)) / d;
    var h = (z * Math.sqrt((p * (1 - p)) / m + (z * z) / (4 * m * m))) / d;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }

  /**
   * 整本书的准确率估计：有判断的行（黄色行，以及其他判过的行）逐行计；
   * 抽查行用来估计"没检查的白色行"有多少是对的，再按白色行的数量放大。不确定的行不计
   */
  function stats() {
    var n = DATA.rows.length;
    var known = { ok: 0, bad: 0 };
    var sample = { ok: 0, bad: 0, done: 0, total: 0 };
    var unsure = 0;
    var unchecked = 0;
    var human = 0;
    for (var i = 0; i < n; i++) {
      var r = DATA.rows[i];
      var s = state(i);
      if (local[r.key]) human++;
      if (r.sample) sample.total++;
      if (!s) {
        // 还没抽查到的抽查行也是白色行，和其他没检查的一起按抽查的正确率估
        unchecked++;
        continue;
      }
      if (s.ok === null) {
        unsure++;
        continue;
      }
      var bucket = r.sample ? sample : known;
      if (s.ok) bucket.ok++;
      else bucket.bad++;
      if (r.sample) sample.done++;
    }
    var pct = function (x) {
      return (100 * x).toFixed(1) + '%';
    };
    var decided = known.ok + known.bad + sample.done + unchecked;
    var line2;
    if (sample.done === 0) {
      line2 = '抽查还没开始。在"显示"里选"要你检查的"，逐行判断后这里会给出整本书的估计';
    } else {
      // 没检查的白色行按抽查的正确率估
      var p = sample.ok / sample.done;
      var ci = wilson(sample.ok, sample.done);
      var est = function (q) {
        return (known.ok + sample.ok + unchecked * q) / Math.max(1, decided);
      };
      line2 =
        '整本书估计准确率：<b>' +
        pct(est(p)) +
        '</b>（95% 范围 ' +
        pct(est(ci[0])) +
        ' – ' +
        pct(est(ci[1])) +
        '）' +
        ' · 抽查的白色行对了 ' +
        sample.ok +
        '/' +
        sample.done;
    }
    document.getElementById('stats').innerHTML =
      '共 <b>' +
      n +
      '</b> 行 · 已判断对 ' +
      known.ok +
      ' · <span class="bad">错 ' +
      known.bad +
      '</span> · 不确定 ' +
      unsure +
      ' · 抽查进度 <b>' +
      sample.done +
      '/' +
      sample.total +
      '</b> · 你改过 ' +
      human +
      '<br>' +
      line2;
  }

  function applyFilter() {
    var mode = document.getElementById('filter').value;
    for (var i = 0; i < DATA.rows.length; i++) {
      var r = DATA.rows[i];
      var s = state(i);
      var show =
        mode === 'all' ||
        (mode === 'yellow' && r.yellow) ||
        (mode === 'bad' && s && s.ok === false) ||
        (mode === 'unsure' && s && s.ok === null) ||
        (mode === 'human' && local[r.key]) ||
        (mode === 'unchecked' && !s) ||
        (mode === 'sample' && r.sample);
      rowEl(i).hidden = !show;
    }
    // 整组都被筛掉时，把这一组的标题也藏起来
    document.querySelectorAll('section.group').forEach(function (sec) {
      sec.hidden = !sec.querySelector('tr[data-i]:not([hidden])');
    });
  }

  /** "12+13" → 这些段落的开头；"无" 或空 → 空数组（没有对应） */
  function answerOpenings(r, answer) {
    if (!answer || answer === '无') return [];
    var list = r.side === 'zh' ? DATA.en[r.group] : DATA.zh[r.group];
    return answer.split('+').map(function (x) {
      var o = list[Number(x.replace('#', ''))];
      return o === undefined ? '#' + x : o;
    });
  }

  function exportJson() {
    var verdicts = [];
    for (var i = 0; i < DATA.rows.length; i++) {
      var r = DATA.rows[i];
      var s = state(i);
      if (!s) continue;
      var v = { group: r.group };
      v[r.side] = r.opening;
      v.at = r.at;
      v.ok = s.ok;
      if (s.ok === false)
        v.answer =
          s.answerOpenings && !local[r.key] ? s.answerOpenings : answerOpenings(r, s.answer);
      if (s.note) v.note = s.note;
      v.by = s.by || 'claude';
      verdicts.push(v);
    }
    var blob = new Blob([JSON.stringify({ book: DATA.book, verdicts: verdicts }, null, 2)], {
      type: 'application/json',
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'verdicts-' + DATA.book + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  document.getElementById('filter').onchange = applyFilter;
  document.getElementById('export').onclick = exportJson;
  document.getElementById('reset').onclick = function () {
    if (window.confirm('清除你在这一页的所有修改？Claude 预先填的判断会保留。')) {
      local = {};
      save();
      for (var i = 0; i < DATA.rows.length; i++) render(i);
      stats();
      applyFilter();
    }
  };
  for (var i = 0; i < DATA.rows.length; i++) render(i);
  stats();
  applyFilter();
})();
