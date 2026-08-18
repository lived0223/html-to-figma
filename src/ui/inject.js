/**
 * 注入到 iframe（srcdoc）内的探针/提取脚本。
 * 运行在被导入 HTML 的页面上下文里，负责：
 *  - 探测可用路由（读取全局 SITES/ARTICLES + 控制台子页）
 *  - 按路由渲染后提取可编辑节点树
 * 通过 window.postMessage 与父级 UI 通信（channel: 'html2figma'）。
 */
(function () {
  function wait(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }
  function isVisible(el) {
    try {
      var st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
      var r = el.getBoundingClientRect();
      return r.width > 0.5 && r.height > 0.5;
    } catch (e) {
      return false;
    }
  }
  function css(el, prop) {
    try {
      return getComputedStyle(el)[prop];
    } catch (e) {
      return '';
    }
  }
  function colorToHex(c) {
    var m;
    if (!c) return null;
    if (c[0] === '#') {
      var h = c.length === 4 ? c[1] + c[1] + c[2] + c[2] + c[3] + c[3] + 'ff' : c.length === 7 ? c.slice(1) + 'ff' : c.slice(1);
      return '#' + h;
    }
    m = c.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)/);
    if (!m) return null;
    var r = Math.round(Number(m[1])),
      g = Math.round(Number(m[2])),
      b = Math.round(Number(m[3]));
    var a = m[4] !== undefined ? Math.round(Number(m[4]) * 255) : 255;
    if (a === 0) return null;
    var hex = function (n) {
      var s = n.toString(16);
      return s.length === 1 ? '0' + s : s;
    };
    return '#' + hex(r) + hex(g) + hex(b) + hex(a);
  }
  /**
   * 文本叶节点判定。
   * 关键点：像 <a class="chip"><i></i>站点名</a> 这种「装饰性图标 + 直接文本」的混合内容，
   * 装饰用的 <i>/<svg>/空 <span>（无文字）不参与 inline 判定——否则 flex 容器会把 <i> blockify，
   * 导致整个元素被误判为容器，其直接文本子节点（站点名）就丢失了。
   */
  function isTextLeaf(el) {
    var tag = el.tagName;
    var children = [].slice.call(el.children);
    if (children.length === 0) return el.textContent.trim().length > 0;
    if (/^(P|H1|H2|H3|H4|H5|H6|A|SPAN|STRONG|EM|B|I|LI|LABEL|BUTTON)$/i.test(tag)) {
      var meaningful = children.filter(function (k) {
        // 无文字的装饰性图标不参与判定
        if (/^(I|SVG|SPAN)$/i.test(k.tagName) && !(k.innerText || '').trim()) return false;
        return true;
      });
      var allInline = meaningful.every(function (k) {
        var d = css(k, 'display');
        return d.indexOf('inline') >= 0 && d !== 'inline-block' && d !== 'inline-flex';
      });
      return allInline && el.innerText.trim().length > 0;
    }
    return false;
  }
  function parseNumber(v, dflt) {
    var n = parseFloat(v);
    return isFinite(n) ? n : dflt;
  }
  function fontFamily(el) {
    var f = css(el, 'fontFamily') || '';
    var first = f.split(',')[0].trim().replace(/^["']|["']$/g, '');
    return first;
  }
  function extractNode(el, root) {
    var er = el.getBoundingClientRect();
    var rr = root.getBoundingClientRect();
    var x = er.left - rr.left,
      y = er.top - rr.top;
    var w = er.width,
      h = er.height;
    var node = {
      kind: 'frame',
      tag: el.tagName.toLowerCase(),
      name: el.tagName.toLowerCase(),
      x: x,
      y: y,
      width: w,
      height: h,
      opacity: parseNumber(css(el, 'opacity'), 1),
    };
    var bg = colorToHex(css(el, 'backgroundColor'));
    if (bg) node.background = bg;
    var br = parseNumber(css(el, 'borderRadius'), 0);
    if (br > 0) node.cornerRadius = br;

    // 图片
    if (el.tagName === 'IMG') {
      node.kind = 'image';
      node.name = '图片';
      try {
        var cv = document.createElement('canvas');
        cv.width = el.naturalWidth || w;
        cv.height = el.naturalHeight || h;
        if (cv.width > 0 && cv.height > 0) {
          var ctx = cv.getContext('2d');
          if (ctx) {
            ctx.drawImage(el, 0, 0, cv.width, cv.height);
            node.imageDataUrl = cv.toDataURL('image/png');
          }
        }
      } catch (e) {}
      return node;
    }
    if (el.tagName === 'PICTURE') {
      var img = el.querySelector('img');
      if (img) return extractNode(img, root);
      node.kind = 'rect';
      node.background = '#E5E7EB';
      return node;
    }
    // SVG / CANVAS → 占位矩形
    if (el.tagName === 'SVG' || el.tagName === 'CANVAS') {
      node.kind = 'rect';
      node.name = '矢量占位';
      node.background = node.background || '#E5E7EB';
      return node;
    }
    // 表单输入 → 占位矩形
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      node.kind = 'rect';
      node.name = '输入框';
      node.background = node.background || '#FFFFFF';
      if (br > 0) node.cornerRadius = br;
      return node;
    }
    // 分割线
    if (el.tagName === 'HR') {
      node.kind = 'line';
      node.name = '分割线';
      node.background = node.background || '#000000';
      return node;
    }
    // 纯文本叶节点
    if (isTextLeaf(el)) {
      node.kind = 'text';
      node.name = '文本';
      node.chars = (el.innerText || '').replace(/\n\s*/g, '\n').trim();
      var fs = parseNumber(css(el, 'fontSize'), 14);
      node.fontSize = fs;
      node.fontFamily = fontFamily(el);
      node.fontWeight = parseNumber(css(el, 'fontWeight'), 400);
      var lh = parseNumber(css(el, 'lineHeight'), 0);
      if (lh > 0) {
        var ls = css(el, 'lineHeight');
        if (ls.indexOf('px') < 0 && ls.indexOf('normal') < 0) lh = lh * fs;
        node.lineHeight = lh;
      }
      var lsVal = parseNumber(css(el, 'letterSpacing'), 0);
      if (isFinite(lsVal) && Math.abs(lsVal) > 0.01) node.letterSpacing = lsVal;
      node.textAlign = css(el, 'textAlign') || 'left';
      var ai = css(el, 'alignItems');
      if (ai === 'center') node.textAlignVertical = 'middle';
      else if (ai === 'flex-end') node.textAlignVertical = 'bottom';
      else node.textAlignVertical = 'top';
      node.textColor = colorToHex(css(el, 'color')) || '#000000ff';
      return node;
    }
    // 容器：递归子元素
    node.children = [];
    [].slice.call(el.children).forEach(function (c) {
      if (isVisible(c)) {
        var cn = extractNode(c, root);
        if (cn) node.children.push(cn);
      }
    });
    return node;
  }
  function routeName(hash) {
    var h = (hash || '').replace(/^#\/?/, '') || 'home';
    var parts = h.split('/').filter(function (x) {
      return x.length;
    });
    return parts
      .map(function (p) {
        return p.charAt(0).toUpperCase() + p.slice(1);
      })
      .join('-');
  }

  /* ============================================================
     路由渲染等待：设置 hash 后，等 hashchange → render() 真正完成再继续。
     （此前是设置 hash 后同步读 DOM，读到的是上一个路由的旧内容 → 页面整体错位一位）
     ============================================================ */
  var lastRenderedHash = location.hash || '#/home';
  window.addEventListener('hashchange', function () {
    lastRenderedHash = location.hash;
  });

  /** 跳转到指定路由并等待其渲染完成（最多 3s），返回 Promise */
  function go(hash) {
    var normalized = hash.indexOf('#') === 0 ? hash : '#' + hash;
    var start = Date.now();
    return new Promise(function (resolve) {
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        // 渲染完成后稍等片刻，让布局/图片 settle
        setTimeout(resolve, 80);
      };
      if (location.hash !== normalized) location.hash = normalized;
      // 目标 hash 已就位（可能是重复提取同一路由，不触发 hashchange）→ 直接完成
      if (location.hash === normalized && lastRenderedHash === normalized) {
        finish();
        return;
      }
      (function poll() {
        if (location.hash === normalized && lastRenderedHash === normalized) {
          finish();
          return;
        }
        if (Date.now() - start > 3000) {
          finish();
          return;
        }
        setTimeout(poll, 40);
      })();
    });
  }

  function probeRoutes() {
    var out = [];
    var cand = [];
    cand.push('#/home');
    cand.push('#/write-for-us');
    try {
      if (window.SITES && window.SITES.length) {
        window.SITES.forEach(function (s) {
          cand.push('#/site/' + s.id);
        });
      }
      if (window.ARTICLES && window.ARTICLES.length) {
        cand.push('#/article/' + window.ARTICLES[0].id);
      }
    } catch (e) {}
    ['console', 'console/factory', 'console/publish-queue', 'console/submissions', 'console/sites', 'console/templates', 'console/seo', 'console/finance', 'console/settings'].forEach(function (r) {
      cand.push('#/' + r);
    });
    var chain = Promise.resolve();
    cand.forEach(function (h) {
      chain = chain.then(function () {
        return go(h).then(function () {
          var app = document.getElementById('app');
          if (app && app.innerHTML && app.innerHTML.trim().length > 0) out.push(h);
        });
      });
    });
    return chain.then(function () {
      return out;
    });
  }

  function extract(hash) {
    return go(hash).then(function () {
      var app = document.getElementById('app');
      if (!app) return null;
      var children = [];
      [].slice.call(app.children).forEach(function (c) {
        if (isVisible(c)) {
          var n = extractNode(c, app);
          if (n && (!n.children || n.children.length > 0 || n.kind !== 'frame' || n.background)) children.push(n);
        }
      });
      var w = Math.max(app.scrollWidth, document.documentElement.clientWidth, 1);
      var h = Math.max(app.scrollHeight, app.getBoundingClientRect().height, 1);
      var bodyBg = colorToHex(getComputedStyle(document.body).backgroundColor);
      return { name: routeName(hash), width: w, height: h, background: bodyBg || null, nodes: children };
    });
  }

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.channel !== 'html2figma') return;
    var reply = function (obj) {
      try {
        e.source.postMessage(obj, '*');
      } catch (err) {}
    };
    if (d.type === 'routes') {
      probeRoutes().then(
        function (routes) {
          reply({ channel: 'html2figma', type: 'routes', id: d.id, routes: routes });
        },
        function (err) {
          reply({ channel: 'html2figma', type: 'routes', id: d.id, routes: [], error: String(err) });
        }
      );
    } else if (d.type === 'extract') {
      extract(d.hash).then(
        function (r) {
          reply({ channel: 'html2figma', type: 'extract', id: d.id, result: r });
        },
        function (err) {
          reply({ channel: 'html2figma', type: 'extract', id: d.id, result: null, error: String(err) });
        }
      );
    }
  });
})();
